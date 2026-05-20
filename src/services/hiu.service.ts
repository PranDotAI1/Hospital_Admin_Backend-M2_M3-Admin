import axios from "axios";
import {
  HIURequestModel,
  HIURequestStatus,
  IHIURequest,
} from "../models/HIURequest";
import {
  ExternalHealthRecordModel,
  ExternalRecordStatus,
} from "../models/ExternalHealthRecord";
import { PatientModel } from "../models/Patient";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
} from "../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../models/PHRConsentArtefact";
import {
  generateKeyMaterial,
  decryptHealthData,
  ABDMKeyMaterial,
} from "../utils/prepareAndEncryptFhirPayload";
import {
  generateUID,
  X_CM_ID,
  X_HIU_ID,
  X_HIP_ID,
  facilityId,
  GET_URL,
} from "../utils/constant";
import { AbdmTokenService } from "./abdm.token.service";

const LOG_PREFIX = "[HIU_SERVICE]";
const HIU_DATA_PUSH_URL = `${process.env.ABDM_CALLBACK_URL || "https://admin.pran.ai"}/api/v3/hiu/health-information/transfer`;
const SKIP_OWN_FACILITY = false;

export const requestHealthInformation = async (
  consentArtefactId: string,
  dateRange: { from: Date; to: Date },
  options?: { storeAsExternalRecord?: boolean },
): Promise<{
  requestId: string;
  status: number;
  existingRecordCount: number;
}> => {
  try {
    let consent = await ConsentArtefactModel.findOne({
      artefactId: consentArtefactId,
    });
    if (!consent) {
      consent = await PHRConsentArtefactModel.findOne({
        artefactId: consentArtefactId,
      });
    }
    if (!consent) {
      throw new Error(`Consent artefact not found: ${consentArtefactId}`);
    }

    // How many external records we already have for this consent (so frontend can show "already available")
    const existingRecordCount = await ExternalHealthRecordModel.countDocuments({
      consentArtefactId,
    });

    // --- Date Range Validation & Clamping ---
    const consentRange = consent.permission.dateRange;
    const requestedFrom = new Date(dateRange.from);
    const requestedTo = new Date(dateRange.to);
    const consentFrom = new Date(consentRange.from);
    const consentTo = new Date(consentRange.to);

    // 1. Clamp 'From' date: cannot be earlier than consent start
    const finalFrom = requestedFrom < consentFrom ? consentFrom : requestedFrom;

    // 2. Clamp 'To' date: cannot be later than consent end
    const finalTo = requestedTo > consentTo ? consentTo : requestedTo;

    // 3. Validation: Check if range is valid after clamping
    if (finalFrom > finalTo) {
      throw new Error(
        `Requested date range (${dateRange.from.toISOString()} - ${dateRange.to.toISOString()}) is outside the approved consent range (${consentRange.from.toISOString()} - ${consentRange.to.toISOString()})`,
      );
    }

    console.log(
      `${LOG_PREFIX} Date Range Clamped: Requested [${requestedFrom.toISOString()} - ${requestedTo.toISOString()}] -> Final [${finalFrom.toISOString()} - ${finalTo.toISOString()}]`,
    );

    const finalDateRange = { from: finalFrom, to: finalTo };

    const keys = generateKeyMaterial();
    const requestId = generateUID();

    const storeAsExternalRecord = options?.storeAsExternalRecord === true;

    if (storeAsExternalRecord && consent.requestPurpose === "PHR") {
      throw new Error(
        `Consent ${consentArtefactId} has requestPurpose PHR (pull records). Cannot use for HIMS external records. Use a consent initiated with requestPurpose HIMS.`,
      );
    }

    await HIURequestModel.create({
      requestId,
      patientAbhaAddress: consent.patientAbhaAddress,
      consentArtefactId: consent.artefactId,
      dateRange: finalDateRange,
      keyMaterial: {
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        nonce: keys.nonce,
      },
      status: HIURequestStatus.INITIATED,
      storeAsExternalRecord,
    });

    console.log(
      `${LOG_PREFIX} Created HIU request ${requestId} for consent ${consentArtefactId}`,
    );

    const payload = {
      requestId,
      timestamp: new Date().toISOString(),
      hiRequest: {
        consent: {
          id: consentArtefactId,
        },
        dateRange: {
          from: finalDateRange.from.toISOString(),
          to: finalDateRange.to.toISOString(),
        },
        dataPushUrl: HIU_DATA_PUSH_URL,
        keyMaterial: {
          cryptoAlg: "ECDH",
          curve: "Curve25519",
          dhPublicKey: {
            expiry: new Date(
              Date.now() + 2 * 24 * 60 * 60 * 1000,
            ).toISOString(), // 2 days
            parameters: "Curve25519",
            keyValue: keys.publicKey, // 88 chars (Standard) or 412 chars (X509) - python output
          },
          nonce: keys.nonce,
        },
      },
    };

    const abdmToken = await AbdmTokenService.getToken();
    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/data-flow/v3/health-information/request`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIU-ID": X_HIU_ID,
          Authorization: abdmToken,
        },
      },
    );

    console.log(
      `${LOG_PREFIX} Sent request to ABDM. Status: ${response.status}`,
    );

    // Update status
    await HIURequestModel.updateOne(
      { requestId },
      {
        status: HIURequestStatus.REQUESTED,
        $push: {
          callbacks: {
            type: "request-sent",
            body: { status: response.status },
          },
        },
      },
    );

    return {
      requestId,
      status: response.status,
      existingRecordCount,
    };
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Request failed:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const handleHiuOnRequest = async (
  requestId: string,
  body: any,
): Promise<void> => {
  const { hiRequest, error } = body;

  const hiuRequest = await HIURequestModel.findOne({ requestId });
  if (!hiuRequest) {
    console.warn(
      `${LOG_PREFIX} Received on-request for unknown requestId: ${requestId}`,
    );
    return;
  }

  if (error) {
    console.error(`${LOG_PREFIX} Request ${requestId} failed at ABDM:`, error);
    await HIURequestModel.updateOne(
      { requestId },
      {
        status: HIURequestStatus.FAILED,
        error,
        $push: { callbacks: { type: "on-request-error", body } },
      },
    );
    return;
  }

  // TransactionId comes from the callback body (ABDM gateway), not from our DB
  const transactionId =
    body.hiRequest?.transactionId ??
    body.transactionId ??
    hiRequest?.transactionId;
  if (transactionId) {
    console.log(
      `${LOG_PREFIX} Request ${requestId} acknowledged. TransactionId: ${transactionId}`,
    );
    await HIURequestModel.updateOne(
      { requestId },
      {
        status: HIURequestStatus.ACKNOWLEDGED,
        transactionId,
        $push: { callbacks: { type: "on-request", body } },
      },
    );

    // Bridge transactionId → requestId in Redis for instant HIU transfer lookup.
    // This eliminates the retry loop when transfer arrives before on-request.
    try {
      const { bridgeTransactionId } = await import("./abdm.queue.service");
      await bridgeTransactionId(transactionId, requestId);
    } catch (_) {
      // Redis unavailable — transfer handler will fall back to MongoDB retry
    }
  } else {
    console.warn(
      `${LOG_PREFIX} On-request for ${requestId} had no transactionId in body. Keys: ${Object.keys(body).join(", ")}`,
    );
  }
};

export const handleHiuTransfer = async (
  transactionId: string,
  entries: any[],
  senderKeyMaterial: ABDMKeyMaterial,
  consentArtefactId?: string, // Optional: passed from transfer payload if available
): Promise<void> => {
  console.log(
    `${LOG_PREFIX} Received data transfer for transaction ${transactionId}, entries: ${entries.length}`,
  );

  // 0. Try Redis bridge first (instant, sub-ms) — populated by handleHiuOnRequest
  let hiuRequest: import("../models/HIURequest").IHIURequest | null = null;
  try {
    const { lookupTransactionBridge } = await import("./abdm.queue.service");
    const bridgedRequestId = await lookupTransactionBridge(transactionId);
    if (bridgedRequestId) {
      hiuRequest = await HIURequestModel.findOne({
        requestId: bridgedRequestId,
      });
      if (hiuRequest) {
        console.log(
          `${LOG_PREFIX} Found HIU request via Redis bridge: ${hiuRequest.requestId}`,
        );
      }
    }
  } catch (_) {
    // Redis unavailable — continue with MongoDB fallbacks
  }

  // 1. MongoDB lookup by transactionId
  if (!hiuRequest) {
    hiuRequest = await HIURequestModel.findOne({ transactionId });
    if (hiuRequest) {
      console.log(
        `${LOG_PREFIX} Found HIU request by transactionId: ${hiuRequest.requestId}, storeAsExternalRecord: ${hiuRequest.storeAsExternalRecord}`,
      );
    }
  }

  if (!hiuRequest && consentArtefactId) {
    console.log(
      `${LOG_PREFIX} TransactionId lookup failed, trying by consentArtefactId: ${consentArtefactId}`,
    );
    // Fallback: find the most recent HIU request for this consent
    hiuRequest = await HIURequestModel.findOne({
      consentArtefactId,
      status: {
        $in: [HIURequestStatus.INITIATED, HIURequestStatus.ACKNOWLEDGED],
      },
    }).sort({ createdAt: -1 });

    if (hiuRequest) {
      // Update the record with the transactionId for future lookups
      await HIURequestModel.updateOne(
        { _id: hiuRequest._id },
        { $set: { transactionId } },
      );
      console.log(
        `${LOG_PREFIX} Found HIU request by consent, updated transactionId: ${hiuRequest.requestId}`,
      );
    }
  }

  // 3rd fallback: Find most recent HIU request without a transactionId (within last 5 mins)
  // This handles the edge case where the same facility is both HIP and HIU
  if (!hiuRequest) {
    console.log(
      `${LOG_PREFIX} Trying fallback: recent HIU request without transactionId`,
    );
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Query for requests where transactionId is null, undefined, or doesn't exist
    hiuRequest = await HIURequestModel.findOne({
      $or: [
        { transactionId: { $exists: false } },
        { transactionId: null },
        { transactionId: "" },
      ],
      // Include REQUESTED status - this is what requests have after being sent to ABDM
      status: {
        $in: [
          HIURequestStatus.INITIATED,
          HIURequestStatus.REQUESTED,
          HIURequestStatus.ACKNOWLEDGED,
        ],
      },
      createdAt: { $gt: fiveMinutesAgo },
    }).sort({ createdAt: -1 });

    if (hiuRequest) {
      await HIURequestModel.updateOne(
        { _id: hiuRequest._id },
        { $set: { transactionId, status: HIURequestStatus.ACKNOWLEDGED } },
      );
      console.log(
        `${LOG_PREFIX} Found recent HIU request without transactionId: ${hiuRequest.requestId}`,
      );
    }
  }

  // --- RETRY WITH BACKOFF: Race condition fix ---
  // ABDM can push the /transfer callback BEFORE the /on-request callback
  // stores the transactionId on the HIURequest document.
  // Wait and retry to give on-request time to complete.
  // NOTE: This runs in the background (controller already sent 200), so retries don't add latency.
  if (!hiuRequest) {
    console.warn(
      `${LOG_PREFIX} No HIU request found for transactionId: ${transactionId}. Retrying (on-request may not have arrived yet)...`,
    );

    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // 1s, 2s, 3s (6s total max)

      // Retry: Direct transactionId lookup (on-request may have stored it by now)
      hiuRequest = await HIURequestModel.findOne({ transactionId });
      if (hiuRequest) {
        console.log(
          `${LOG_PREFIX} Found HIU request on retry #${attempt} by transactionId: ${hiuRequest.requestId}`,
        );
        break;
      }

      // Retry: Consent-based fallback
      if (consentArtefactId) {
        hiuRequest = await HIURequestModel.findOne({
          consentArtefactId,
          status: {
            $in: [
              HIURequestStatus.INITIATED,
              HIURequestStatus.REQUESTED,
              HIURequestStatus.ACKNOWLEDGED,
            ],
          },
        }).sort({ createdAt: -1 });
        if (hiuRequest) {
          await HIURequestModel.updateOne(
            { _id: hiuRequest._id },
            { $set: { transactionId } },
          );
          console.log(
            `${LOG_PREFIX} Found HIU request on retry #${attempt} by consent: ${hiuRequest.requestId}`,
          );
          break;
        }
      }

      // Retry: Recent request without transactionId
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      hiuRequest = await HIURequestModel.findOne({
        $or: [
          { transactionId: { $exists: false } },
          { transactionId: null },
          { transactionId: "" },
        ],
        status: {
          $in: [
            HIURequestStatus.INITIATED,
            HIURequestStatus.REQUESTED,
            HIURequestStatus.ACKNOWLEDGED,
          ],
        },
        createdAt: { $gt: tenMinutesAgo },
      }).sort({ createdAt: -1 });

      if (hiuRequest) {
        await HIURequestModel.updateOne(
          { _id: hiuRequest._id },
          { $set: { transactionId, status: HIURequestStatus.ACKNOWLEDGED } },
        );
        console.log(
          `${LOG_PREFIX} Found HIU request on retry #${attempt} (recent without txnId): ${hiuRequest.requestId}`,
        );
        break;
      }
    }
  }

  if (!hiuRequest) {
    console.error(
      `${LOG_PREFIX} No HIU request found after 3 retries for transactionId: ${transactionId} or consent: ${consentArtefactId}`,
    );
    throw new Error("Transaction not found"); // ABDM might retry
  }

  const { privateKey, nonce: myNonce } = hiuRequest.keyMaterial;
  const { dhPublicKey, nonce: senderNonce } = senderKeyMaterial;

  // --- PRE-FETCH CONSENT ARTEFACT FOR VALIDATION ---
  // Only store external records when consent artefact exists and is GRANTED (never under request-id or revoked/denied)
  let consentArtefact = await ConsentArtefactModel.findOne({
    artefactId: hiuRequest.consentArtefactId,
  }).lean();
  let artefactSource = "main";

  if (!consentArtefact) {
    consentArtefact = await PHRConsentArtefactModel.findOne({
      artefactId: hiuRequest.consentArtefactId,
    }).lean();
    artefactSource = "phr";
  }

  if (!consentArtefact) {
    console.warn(
      `${LOG_PREFIX} Consent artefact ${hiuRequest.consentArtefactId} not found. Skipping storage of external health records.`,
    );
    await HIURequestModel.updateOne(
      { transactionId },
      {
        status: HIURequestStatus.FAILED,
        $push: {
          callbacks: {
            type: "transfer",
            body: { error: "Consent artefact not found" },
          },
        },
      },
    );
    return;
  }

  if (consentArtefact.status !== ConsentArtefactStatus.GRANTED) {
    console.warn(
      `${LOG_PREFIX} Consent ${hiuRequest.consentArtefactId} is ${consentArtefact.status}. Skipping storage of external health records.`,
    );
    await HIURequestModel.updateOne(
      { transactionId },
      {
        status: HIURequestStatus.FAILED,
        $push: {
          callbacks: {
            type: "transfer",
            body: { error: `Consent not GRANTED (${consentArtefact.status})` },
          },
        },
      },
    );
    return;
  }

  // Reject self-referencing ghost artefacts (artefactId === consentRequestId)
  // AND unlinked artefacts (consentRequestId is null/empty).
  // These are artefacts that were created without a real ConsentRequest and break
  // the REVOKE cascade. Data must not be stored against them.
  const isGhostOrUnlinked =
    (consentArtefact.artefactId &&
      consentArtefact.consentRequestId &&
      consentArtefact.artefactId === consentArtefact.consentRequestId) ||
    !consentArtefact.consentRequestId;

  if (isGhostOrUnlinked) {
    const reason = !consentArtefact.consentRequestId
      ? "Unlinked artefact (no consentRequestId)"
      : "Self-referencing ghost artefact (artefactId === consentRequestId)";
    console.warn(
      `${LOG_PREFIX} [SECURITY] Consent ${hiuRequest.consentArtefactId}: ${reason}. Skipping storage.`,
    );
    await HIURequestModel.updateOne(
      { transactionId },
      {
        status: HIURequestStatus.FAILED,
        $push: {
          callbacks: {
            type: "transfer",
            body: {
              error: `${reason} — no valid consent link`,
            },
          },
        },
      },
    );
    return;
  }

  const allowedCareContexts = new Set(
    consentArtefact?.careContexts?.map((cc) => cc.careContextReference) || [],
  );

  console.log(
    `${LOG_PREFIX} Validating against ${allowedCareContexts.size} allowed care contexts for consent ${hiuRequest.consentArtefactId} (found in ${artefactSource} collection)`,
  );

  if (allowedCareContexts.size === 0) {
    console.warn(
      `${LOG_PREFIX} ⚠️ Artefact found but has 0 care contexts! Artefact source: ${artefactSource}, requestPurpose: ${(consentArtefact as any).requestPurpose || "unknown"}`,
    );
  }

  // 2. Process each entry (decryption)
  for (const entry of entries) {
    try {
      // --- VALIDATION: Check if this Care Context is allowed ---
      const ccRef = entry.careContextReference;

      if (allowedCareContexts.size > 0 && !allowedCareContexts.has(ccRef)) {
        console.warn(
          `${LOG_PREFIX} [SECURITY] Care Context ${ccRef} is NOT in allowed list for consent ${hiuRequest.consentArtefactId}. DROPPING RECORD.`,
        );
        continue;
      }

      if (
        allowedCareContexts.size === 0 &&
        hiuRequest.storeAsExternalRecord === true
      ) {
        console.warn(
          `${LOG_PREFIX} ⚠️ Artefact has 0 care contexts but storeAsExternalRecord=true. Allowing storage for ${ccRef} (ABDM sent it, so it's valid).`,
        );
      }

      if (entry.content) {
        // Decrypt
        // Note: entry.careContextReference tells us which record this is

        console.log(
          `${LOG_PREFIX} Decrypting entry for ${entry.careContextReference}...`,
        );

        // Debug: Log key material details
        console.log(`${LOG_PREFIX} Decryption params:`, {
          contentLength: entry.content?.length || 0,
          myPrivateKeyLength: privateKey?.length || 0,
          myNonceLength: myNonce?.length || 0,
          senderPubKeyLength: dhPublicKey?.keyValue?.length || 0,
          senderPubKeyPrefix: dhPublicKey?.keyValue?.substring(0, 20) || "N/A",
          senderNonceLength: senderNonce?.length || 0,
        });

        const { decryptedData } = decryptHealthData(
          entry.content,
          privateKey,
          myNonce,
          dhPublicKey.keyValue,
          senderNonce,
        );

        console.log(
          `${LOG_PREFIX} Decryption success for ${entry.careContextReference}`,
        );

        // Extract source HIP info from FHIR bundle
        const { hipId, hipName } = extractSourceHipInfo(decryptedData);

        // Check if this record is from our own facility
        const isOurFacility =
          !hipId ||
          hipId === facilityId ||
          hipId === X_HIP_ID ||
          (facilityId && hipId.includes(facilityId)) ||
          (X_HIP_ID && hipId.includes(X_HIP_ID));

        if (SKIP_OWN_FACILITY && isOurFacility) {
          console.log(
            `${LOG_PREFIX} Skipping ExternalHealthRecord for ${entry.careContextReference}: source HIP is our facility (${hipId}). SKIP_OWN_FACILITY is enabled.`,
          );
          continue;
        }

        if (isOurFacility) {
          console.log(
            `${LOG_PREFIX} Storing ExternalHealthRecord from our own facility (${hipId}). SKIP_OWN_FACILITY is disabled.`,
          );
        }

        // Only store in external_health_records when this fetch was for our HIMS (user-approved records we hold). Do NOT store when the request was "pull records" (patient updating his PHR) – consent was for his PHR view, not for us to store and show in HIMS (compliance risk).
        console.log(
          `${LOG_PREFIX} Checking storeAsExternalRecord for ${entry.careContextReference}: requestId=${hiuRequest.requestId}, storeAsExternalRecord=${hiuRequest.storeAsExternalRecord}`,
        );
        if (hiuRequest.storeAsExternalRecord !== true) {
          console.log(
            `${LOG_PREFIX} Skipping ExternalHealthRecord for ${entry.careContextReference}: storeAsExternalRecord is not set (e.g. PHR pull records). External records only for HIMS-use fetches.`,
          );
          continue;
        }
        console.log(
          `${LOG_PREFIX} ✓ storeAsExternalRecord=true, proceeding to store record for ${entry.careContextReference}`,
        );
        if (consentArtefact.requestPurpose === "PHR") {
          console.log(
            `${LOG_PREFIX} Skipping ExternalHealthRecord for ${entry.careContextReference}: consent requestPurpose is PHR. Not for HIMS.`,
          );
          continue;
        }

        // Link to local patient by ABHA address
        const localPatient = await PatientModel.findOne({
          $or: [
            { abhaaddress: hiuRequest.patientAbhaAddress },
            { ABHANumber: hiuRequest.patientAbhaAddress },
          ],
        })
          .select("_id")
          .lean();

        // --- UPSERT BY CONSENT ARTEFACT ID + CARE CONTEXT ---
        // This prevents duplicates when the same data is transferred multiple times (e.g. retries)
        await ExternalHealthRecordModel.findOneAndUpdate(
          {
            consentArtefactId: hiuRequest.consentArtefactId, // Key 1
            careContextReference: entry.careContextReference, // Key 2
          },
          {
            $set: {
              patientAbhaAddress: hiuRequest.patientAbhaAddress,
              patientId: localPatient?._id,

              // Ensure we update the transactionId to the latest one
              transactionId: transactionId,
              requestId: hiuRequest.requestId,

              sourceHipId: hipId,
              sourceHipName: hipName,

              fhirBundle: decryptedData,
              hiTypes: extractHiTypesFromBundle(decryptedData),

              // Ensure dateRange is stored as Date (consent-approved range for this fetch)
              dateRange: {
                from: new Date(hiuRequest.dateRange.from),
                to: new Date(hiuRequest.dateRange.to),
              },
              status: ExternalRecordStatus.STORED,

              encryptedDataSize: entry.content.length,
              decryptedDataSize: JSON.stringify(decryptedData).length,
              decryptedAt: new Date(),
              dataEraseAt: consentArtefact?.permission?.dataEraseAt,
            },
            $setOnInsert: {
              receivedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        console.log(
          `${LOG_PREFIX} Stored external record from ${hipName || hipId} for ${entry.careContextReference}`,
        );
      }
    } catch (err: any) {
      console.error(
        `${LOG_PREFIX} Error processing entry for ${entry.careContextReference}:`,
        err,
      );
    }
  }

  await HIURequestModel.updateOne(
    { transactionId },
    {
      status: HIURequestStatus.TRANSFERRED,
      $push: {
        callbacks: { type: "transfer", body: { entryCount: entries.length } },
      },
    },
  );
};

/**
 * Extract source HIP information from a FHIR bundle.
 * Looks for Organization resource or Composition.custodian reference.
 *
 * SAFE FHIR PARSING: validates bundle structure before iterating entries.
 * Wraps in try-catch to prevent malformed bundles from crashing the worker.
 */
const extractSourceHipInfo = (
  bundle: any,
): { hipId: string; hipName?: string } => {
  try {
    // Type guard: ensure bundle is a valid FHIR Bundle with entries
    if (!bundle || typeof bundle !== "object") {
      return { hipId: "UNKNOWN" };
    }
    if (bundle.resourceType && bundle.resourceType !== "Bundle") {
      console.warn(
        `${LOG_PREFIX} [FHIR] Expected Bundle but got ${bundle.resourceType}`,
      );
      return { hipId: "UNKNOWN" };
    }
    if (!Array.isArray(bundle.entry) || bundle.entry.length === 0) {
      return { hipId: "UNKNOWN" };
    }

    // Strategy 1: Find Organization resource directly
    for (const entry of bundle.entry) {
      if (!entry || typeof entry !== "object") continue;
      const resource = entry.resource;
      if (!resource || typeof resource !== "object") continue;

      if (resource.resourceType === "Organization") {
        const hipId =
          resource.identifier?.[0]?.value || resource.id || "UNKNOWN";
        const hipName = resource.name;
        return { hipId, hipName };
      }
    }

    // Strategy 2: Look at Composition.custodian
    for (const entry of bundle.entry) {
      if (!entry || typeof entry !== "object") continue;
      const resource = entry.resource;
      if (!resource || typeof resource !== "object") continue;

      if (resource.resourceType === "Composition" && resource.custodian) {
        const ref = resource.custodian.reference || "";
        const display = resource.custodian.display;
        if (ref.includes("Organization/")) {
          const hipId = ref.split("Organization/")[1];
          return { hipId, hipName: display };
        }
        if (ref.includes("urn:uuid:")) {
          return { hipId: ref.split("urn:uuid:")[1], hipName: display };
        }
      }
    }

    return { hipId: "UNKNOWN" };
  } catch (err: any) {
    console.error(
      `${LOG_PREFIX} [FHIR] extractSourceHipInfo failed:`,
      err.message,
    );
    return { hipId: "UNKNOWN" };
  }
};

/**
 * Extract HI types from a FHIR bundle by inspecting resource types and titles.
 *
 * SAFE FHIR PARSING: validates bundle structure, skips malformed entries,
 * and only looks at valid resource sections.
 */
const extractHiTypesFromBundle = (bundle: any): string[] => {
  try {
    const types = new Set<string>();

    // Type guard: ensure bundle is a valid FHIR Bundle with entries
    if (!bundle || typeof bundle !== "object") return [];
    if (bundle.resourceType && bundle.resourceType !== "Bundle") {
      console.warn(
        `${LOG_PREFIX} [FHIR] extractHiTypes: Expected Bundle but got ${bundle.resourceType}`,
      );
      return [];
    }
    if (!Array.isArray(bundle.entry) || bundle.entry.length === 0) return [];

    for (const entry of bundle.entry) {
      if (!entry || typeof entry !== "object") continue;
      const resource = entry.resource;
      if (!resource || typeof resource !== "object" || !resource.resourceType)
        continue;

      if (resource.resourceType === "Composition") {
        // 1. Check Composition title (for single-type bundles)
        const title =
          typeof resource.title === "string"
            ? resource.title.toLowerCase()
            : "";
        if (title.includes("prescription")) types.add("Prescription");
        if (title.includes("diagnostic") || title.includes("lab"))
          types.add("DiagnosticReport");
        if (title.includes("discharge")) types.add("DischargeSummary");
        if (title.includes("immunization")) types.add("ImmunizationRecord");
        if (title.includes("wellness")) types.add("WellnessRecord");
        if (title.includes("health document"))
          types.add("HealthDocumentRecord");

        // 2. Check Composition SECTIONS (for combined bundles)
        if (Array.isArray(resource.section)) {
          for (const section of resource.section) {
            if (!section || typeof section !== "object") continue;
            const secTitle =
              typeof section.title === "string"
                ? section.title.toLowerCase()
                : "";
            if (secTitle.includes("prescription")) types.add("Prescription");
            if (secTitle.includes("diagnostic") || secTitle.includes("lab"))
              types.add("DiagnosticReport");
            if (secTitle.includes("discharge")) types.add("DischargeSummary");
            if (secTitle.includes("immunization"))
              types.add("ImmunizationRecord");
            if (secTitle.includes("wellness")) types.add("WellnessRecord");
            if (secTitle.includes("health document"))
              types.add("HealthDocumentRecord");
            if (
              secTitle.includes("note") ||
              secTitle.includes("consultation") ||
              secTitle.includes("soap") ||
              secTitle.includes("visit information")
            )
              types.add("OPConsultation");
          }
        }
      }

      // 3. Check loose resources (legacy or split bundles)
      if (resource.resourceType === "MedicationRequest")
        types.add("Prescription");
      if (resource.resourceType === "DiagnosticReport")
        types.add("DiagnosticReport");
      if (resource.resourceType === "Immunization")
        types.add("ImmunizationRecord");
      if (resource.resourceType === "DocumentReference")
        types.add("HealthDocumentRecord");
    }

    return Array.from(types);
  } catch (err: any) {
    console.error(
      `${LOG_PREFIX} [FHIR] extractHiTypesFromBundle failed:`,
      err.message,
    );
    return [];
  }
};

// ============================================================================
// Retry Failed Consents
// ============================================================================

/**
 * Retry health information requests for consents that haven't successfully
 * received data. Useful after fixing bugs or when retrying after failures.
 */
export const retryFailedConsents = async (): Promise<{
  retried: number;
  results: Array<{ consentId: string; status: string; error?: string }>;
}> => {
  console.log(`${LOG_PREFIX} Starting retry of failed consents...`);

  // Find valid consent artefacts that:
  // 1. Status is GRANTED (still valid)
  // 2. Don't have a successful HIU request (TRANSFERRED status)
  const validConsents = await ConsentArtefactModel.find({
    status: { $in: ["GRANTED", "ACTIVE"] },
    expiryDate: { $gt: new Date() }, // Not expired
  })
    .select("artefactId consentRequestId patientAbhaAddress rawConsentDetail")
    .lean();

  console.log(
    `${LOG_PREFIX} Found ${validConsents.length} valid consent artefacts`,
  );

  const results: Array<{ consentId: string; status: string; error?: string }> =
    [];
  let retriedCount = 0;

  for (const consent of validConsents) {
    // Check if there's already a successful HIU request for this consent
    const existingSuccess = await HIURequestModel.findOne({
      consentArtefactId: consent.artefactId,
      status: HIURequestStatus.TRANSFERRED,
    });

    if (existingSuccess) {
      console.log(
        `${LOG_PREFIX} Consent ${consent.artefactId} already has successful transfer, skipping`,
      );
      results.push({
        consentId: consent.artefactId,
        status: "ALREADY_TRANSFERRED",
      });
      continue;
    }

    // Get date range from consent
    let dateRange: { from: Date; to: Date };
    if (consent.rawConsentDetail?.permission?.dateRange) {
      dateRange = {
        from: new Date(consent.rawConsentDetail.permission.dateRange.from),
        to: new Date(consent.rawConsentDetail.permission.dateRange.to),
      };
    } else {
      dateRange = {
        from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        to: new Date(),
      };
    }

    try {
      console.log(`${LOG_PREFIX} Retrying consent ${consent.artefactId}...`);
      // Skip self-referencing ghost artefacts
      if (consent.artefactId === (consent as any).consentRequestId) {
        console.warn(
          `${LOG_PREFIX} Skipping self-referencing ghost artefact ${consent.artefactId} during retry`,
        );
        results.push({
          consentId: consent.artefactId,
          status: "SKIPPED_GHOST",
        });
        continue;
      }
      await requestHealthInformation(consent.artefactId, dateRange, {
        storeAsExternalRecord: true,
      });
      retriedCount++;
      results.push({ consentId: consent.artefactId, status: "RETRIED" });
    } catch (error: any) {
      console.error(
        `${LOG_PREFIX} Failed to retry consent ${consent.artefactId}:`,
        error.message,
      );
      results.push({
        consentId: consent.artefactId,
        status: "FAILED",
        error: error.message,
      });
    }

    // Small delay between requests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(
    `${LOG_PREFIX} Retry complete. Retried ${retriedCount} consents.`,
  );
  return { retried: retriedCount, results };
};

// ============================================================================
// Step 0: Discovery (Search for Patient) - The missing piece
// ============================================================================

export const searchPatient = async (
  query: {
    name?: string;
    gender?: string;
    yearOfBirth?: number;
    verifiedIdentifiers?: Array<{ type: string; value: string }>;
  },
  requestId: string = generateUID(),
): Promise<string> => {
  try {
    const payload = {
      requestId,
      timestamp: new Date().toISOString(),
      patient: {
        name: query.name,
        gender: query.gender,
        yearOfBirth: query.yearOfBirth,
        verifiedIdentifiers: query.verifiedIdentifiers,
        unverifiedIdentifiers: [],
      },
    };

    console.log(
      `${LOG_PREFIX} Searching for patient:`,
      JSON.stringify(payload),
    );

    const abdmToken = await AbdmTokenService.getToken();
    await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/v3/care-contexts/discover`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIU-ID": X_HIU_ID || facilityId, // Acting as HIU here
          Authorization: abdmToken,
        },
      },
    );

    console.log(`${LOG_PREFIX} Search request sent. RequestId: ${requestId}`);
    return requestId;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Search failed:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};

// ============================================================================
// Step 1: Init (Send OTP)
// ============================================================================

export const initiateHipAuth = async (
  requestId: string,
  patientId: string,
  purpose: string = "LINK",
  requesterId: string = facilityId,
): Promise<string> => {
  try {
    const payload = {
      requestId,
      timestamp: new Date().toISOString(),
      query: {
        id: patientId, // ABHA Address
        purpose: purpose,
        authMode: "MOBILE_OTP",
        requester: {
          type: "HIP",
          id: requesterId,
        },
      },
    };

    console.log(`${LOG_PREFIX} Initiating HIP Auth:`, JSON.stringify(payload));

    const abdmToken = await AbdmTokenService.getToken();
    await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/user-initiated-linking/v3/auth/init`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": X_HIP_ID || facilityId,
          Authorization: abdmToken,
        },
      },
    );

    console.log(
      `${LOG_PREFIX} Auth Init request sent. RequestId: ${requestId}`,
    );
    return requestId;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Auth Init failed:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};

// ============================================================================
// Step 2: Confirm (Verify OTP)
// ============================================================================

export const confirmHipAuth = async (
  requestId: string,
  transactionId: string,
  authCode: string, // OTP
): Promise<string> => {
  try {
    const payload = {
      requestId,
      timestamp: new Date().toISOString(),
      transactionId,
      credential: {
        authCode,
      },
    };

    console.log(`${LOG_PREFIX} Confirming HIP Auth:`, JSON.stringify(payload));

    const abdmToken = await AbdmTokenService.getToken();
    await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/user-initiated-linking/v3/auth/confirm`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": X_HIP_ID || facilityId,
          Authorization: abdmToken,
        },
      },
    );

    console.log(
      `${LOG_PREFIX} Auth Confirm request sent. RequestId: ${requestId}`,
    );
    return requestId;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Auth Confirm failed:`,
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const HiuService = {
  searchPatient,
  initiateHipAuth,
  confirmHipAuth,
  requestHealthInformation,
  handleHiuOnRequest,
  handleHiuTransfer,
  retryFailedConsents,
};

export default HiuService;
