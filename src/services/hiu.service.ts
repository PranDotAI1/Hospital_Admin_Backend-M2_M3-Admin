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
const HIU_DATA_PUSH_URL = `${process.env.ABDM_CALLBACK_URL || "https://bhims.pranamm.ai"}/api/v3/hiu/health-information/transfer`;
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
            keyValue: keys.x509PublicKey, // X509/SPKI format required by ABDM spec
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
      }
    }
  } catch (_) {
    // Redis unavailable — continue with MongoDB fallbacks
  }

  // 1. MongoDB lookup by transactionId
  if (!hiuRequest) {
    hiuRequest = await HIURequestModel.findOne({ transactionId });
    if (hiuRequest) {
    }
  }



  // NOTE: "Recent request without transactionId" fallback REMOVED.
  // It was matching the WRONG HIURequest when multiple consents were active simultaneously,
  // causing data to be stored against incorrect consents.

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
        break;
      }


      // NOTE: "Recent request without transactionId" retry fallback REMOVED.
      // It was matching the WRONG HIURequest when multiple consents were active.
    }
  }

  if (!hiuRequest) {
    console.error(
      `${LOG_PREFIX} No HIU request found after 3 retries for transactionId: ${transactionId} or consent: ${consentArtefactId}`,
    );
    try {
      const { UnmatchedEventModel } = await import("../models/UnmatchedEvent");
      await UnmatchedEventModel.create({
        eventType: "HIU_TRANSFER",
        transactionId,
        payload: { entries, senderKeyMaterial, consentArtefactId },
        receivedAt: new Date(),
        retryCount: 0,
        status: "PENDING",
        error: "HIU request not found after retries",
      });
      console.warn(`${LOG_PREFIX} Saved unmatched HIU transfer to UnmatchedEvent for manual replay`);
    } catch (saveErr: any) {
      console.error(`${LOG_PREFIX} Failed to save unmatched event:`, saveErr.message);
    }
    throw new Error("Transaction not found"); // ABDM might retry
  }

  const { privateKey, nonce: myNonce } = hiuRequest.keyMaterial;
  const decryptedPrivateKey = (hiuRequest as any).keyMaterial?.decryptedPrivateKey || privateKey;
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
        // Debug: Log key material details
        const { decryptedData } = decryptHealthData(
          entry.content,
          privateKey,
          myNonce,
          dhPublicKey.keyValue,
          senderNonce,
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
          continue;
        }

        if (isOurFacility) {
        }

        // Only store in external_health_records when this fetch was for our HIMS (user-approved records we hold). Do NOT store when the request was "pull records" (patient updating his PHR) – consent was for his PHR view, not for us to store and show in HIMS (compliance risk).
        if (hiuRequest.storeAsExternalRecord !== true) {
          continue;
        }
        if (consentArtefact.requestPurpose === "PHR") {
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

        // --- UPSERT BY CONSENT + CARE CONTEXT ---
        // One record per consent per care context. Different consents for the
        // same patient store separate records (they have independent erase dates,
        // date ranges, etc.). Retries within the same consent update in place.
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
              hiTypes: resolveHiTypeForExternalRecord(
                entry,
                decryptedData,
                consentArtefact,
                entry.careContextReference,
              ),

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
 * PRIORITY-BASED hiType resolver for ExternalHealthRecord (HIU side).
 *
 * Priority:
 *  1. entry.hiType from the ABDM transfer payload — the sending HIP declared
 *     the type. This is the authoritative source per ABDM v3 spec.
 *  2. FHIR Composition.type.coding — structured FHIR code, not keyword-sniffing.
 *  3. consentArtefact.hiTypes when there is exactly one — consent-scoped
 *     and unambiguous (patient approved exactly one type for this consent).
 *  4. extractHiTypesFromBundle() keyword-sniff — last-resort fallback only.
 *
 * Always returns a single-element array to match ABDM's "one CC = one hiType"
 * contract. If nothing resolves, returns ["OPConsultation"] as the ABDM default.
 */

/** ABDM FHIR Composition type code → hiType mapping (ABDM NDHM FHIR IG). */
const COMPOSITION_TYPE_CODE_MAP: Record<string, string> = {
  // LOINC codes used by ABDM
  "11503-0": "OPConsultation", // Medical records
  "57133-1": "OPConsultation", // Referral note
  "34133-9": "OPConsultation", // Summarization of episode note
  "18842-5": "DischargeSummary", // Discharge summary
  "56445-0": "Prescription",    // Medication summary
  "52040-3": "DiagnosticReport", // DXA Bone density
  "11502-2": "DiagnosticReport", // Lab report
  "18748-4": "DiagnosticReport", // Diagnostic imaging study
  "11369-6": "ImmunizationRecord", // Immunization history
  "51845-0": "OPConsultation", // Outpatient consultation
  // ABDM / NDHM custom codes (as used by Indian HIPs)
  "425173008": "OPConsultation",
  "408443003": "OPConsultation",
  "440545006": "Prescription",
  "721981007": "DiagnosticReport",
  "373942005": "DischargeSummary",
  "41000179103": "ImmunizationRecord",
  "371525003": "OPConsultation", // Clinical procedure report
};

/** Map ABDM hiType strings the sending HIP might use (handles minor casing/alias variants). */
const NORMALISE_ABDM_HITYPE: Record<string, string> = {
  opconsultation: "OPConsultation",
  prescription: "Prescription",
  diagnosticreport: "DiagnosticReport",
  dischargesummary: "DischargeSummary",
  immunizationrecord: "ImmunizationRecord",
  healthdocumentrecord: "HealthDocumentRecord",
  wellnessrecord: "WellnessRecord",
};

const VALID_HI_TYPES = new Set([
  "OPConsultation",
  "Prescription",
  "DiagnosticReport",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
]);

/**
 * Extract FHIR Composition.type.coding based hiType.
 * Uses the official ABDM FHIR IG code map — no keyword sniffing.
 */
const extractHiTypeFromCompositionCode = (bundle: any): string | null => {
  if (!bundle || !Array.isArray(bundle.entry)) return null;
  for (const e of bundle.entry) {
    const resource = e?.resource;
    if (resource?.resourceType !== "Composition") continue;
    const codings: any[] = resource.type?.coding || [];
    for (const coding of codings) {
      const code = String(coding?.code || "").trim();
      if (COMPOSITION_TYPE_CODE_MAP[code]) {
        return COMPOSITION_TYPE_CODE_MAP[code];
      }
    }
    // Also check .text as last resort within this strategy
    const text = (resource.type?.text || "").toLowerCase().trim();
    if (text.includes("prescription")) return "Prescription";
    if (text.includes("discharge")) return "DischargeSummary";
    if (text.includes("diagnostic") || text.includes("lab")) return "DiagnosticReport";
    if (text.includes("immunization")) return "ImmunizationRecord";
    if (text.includes("wellness")) return "WellnessRecord";
    if (text.includes("health document")) return "HealthDocumentRecord";
  }
  return null;
};

const resolveHiTypeForExternalRecord = (
  entry: any,
  bundle: any,
  consentArtefact: any,
  ccRef: string,
): string[] => {
  // Priority 1: entry.hiType from the ABDM transfer payload.
  // Per ABDM v3 data-flow spec, each entry in the transfer SHOULD carry
  // the hiType the sending HIP used. This is the most authoritative source.
  const entryHiTypeRaw = entry?.hiType || entry?.hi_type || entry?.hitype;
  if (entryHiTypeRaw) {
    const normalised =
      NORMALISE_ABDM_HITYPE[String(entryHiTypeRaw).toLowerCase().trim()] ||
      (VALID_HI_TYPES.has(String(entryHiTypeRaw).trim())
        ? String(entryHiTypeRaw).trim()
        : null);
    if (normalised) {
      // console.log(
      //   `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P1(entry.hiType)=${normalised}`,
      // );
      return [normalised];
    }
  }

  // Priority 2: FHIR Composition.type.coding — structured code, not keyword sniffing.
  const compositionCode = extractHiTypeFromCompositionCode(bundle);
  if (compositionCode) {
    // console.log(
    //   `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P2(Composition.type.coding)=${compositionCode}`,
    // );
    return [compositionCode];
  }

  // Priority 3: consentArtefact.hiTypes — if the consent was granted for exactly
  // one type, we know this entry must belong to that type.
  const artefactTypes: string[] = consentArtefact?.hiTypes || [];
  const validArtefactTypes = artefactTypes.filter((t) => VALID_HI_TYPES.has(t));
  if (validArtefactTypes.length === 1) {
    // console.log(
    //   `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P3(single consentArtefact.hiType)=${validArtefactTypes[0]}`,
    // );
    return [validArtefactTypes[0]];
  }

  // Priority 4: keyword-sniff as last resort (existing logic).
  const sniffed = extractHiTypesFromBundle(bundle);
  if (sniffed.length > 0) {
    // If sniffed returns multiple, use consent artefact to narrow it down.
    if (sniffed.length > 1 && validArtefactTypes.length > 0) {
      const intersection = sniffed.filter((t) => validArtefactTypes.includes(t));
      if (intersection.length === 1) {
        // console.log(
        //   `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P4(sniff∩consent)=${intersection[0]}`,
        // );
        return [intersection[0]];
      }
      // If still multiple, prefer the most specific (non-OPConsultation).
      const specific = intersection.find((t) => t !== "OPConsultation") ||
        sniffed.find((t) => t !== "OPConsultation");
      if (specific) {
        console.warn(
          `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P4(sniff-specific)=${specific} (from multiple sniffed=${JSON.stringify(sniffed)})`,
        );
        return [specific];
      }
    }
    // Single sniffed result or prefer first.
    // console.log(
    //   `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} P4(sniff)=${sniffed[0]}`,
    // );
    return [sniffed[0]];
  }

  // Ultimate fallback: ABDM default.
  console.warn(
    `[HITYPE-DEBUG] resolveHiTypeForExternalRecord: cc=${ccRef} FALLBACK→OPConsultation (no source resolved)`,
  );
  return ["OPConsultation"];
};


/** Extract HI types from a FHIR bundle by inspecting resource types and titles (last-resort fallback). */
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
  // Find valid consent artefacts that:
  // 1. Status is GRANTED (still valid)
  // 2. Don't have a successful HIU request (TRANSFERRED status)
  const validConsents = await ConsentArtefactModel.find({
    status: { $in: ["GRANTED", "ACTIVE"] },
    expiryDate: { $gt: new Date() }, // Not expired
  })
    .select("artefactId consentRequestId patientAbhaAddress rawConsentDetail")
    .lean();
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
