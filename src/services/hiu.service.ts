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
import { ConsentArtefactModel } from "../models/ConsentArtefact";
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

export const requestHealthInformation = async (
  consentArtefactId: string,
  dateRange: { from: Date; to: Date },
): Promise<{ requestId: string; status: number }> => {
  try {
    const consent = await ConsentArtefactModel.findOne({
      artefactId: consentArtefactId,
    });
    if (!consent) {
      throw new Error(`Consent artefact not found: ${consentArtefactId}`);
    }

    const keys = generateKeyMaterial();
    const requestId = generateUID();

    await HIURequestModel.create({
      requestId,
      patientAbhaAddress: consent.patientAbhaAddress,
      consentArtefactId: consent.artefactId,
      dateRange,
      keyMaterial: {
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        nonce: keys.nonce,
      },
      status: HIURequestStatus.INITIATED,
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
          from: dateRange.from.toISOString(),
          to: dateRange.to.toISOString(),
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

    return { requestId, status: response.status };
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

  if (hiRequest && hiRequest.transactionId) {
    console.log(
      `${LOG_PREFIX} Request ${requestId} acknowledged. TransactionId: ${hiRequest.transactionId}`,
    );

    await HIURequestModel.updateOne(
      { requestId },
      {
        status: HIURequestStatus.ACKNOWLEDGED,
        transactionId: hiRequest.transactionId,
        $push: { callbacks: { type: "on-request", body } },
      },
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

  // 1. Find HIU request - try transactionId first, then fallback to recent request by consent
  let hiuRequest = await HIURequestModel.findOne({ transactionId });

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

    // Debug: Log all recent HIU requests to see what's in the DB
    const allRecentRequests = await HIURequestModel.find({
      createdAt: { $gt: fiveMinutesAgo },
    })
      .select("requestId transactionId status createdAt")
      .lean();
    console.log(
      `${LOG_PREFIX} Recent HIU requests in DB:`,
      JSON.stringify(allRecentRequests, null, 2),
    );

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

  if (!hiuRequest) {
    console.error(
      `${LOG_PREFIX} No HIU request found for transactionId: ${transactionId} or consent: ${consentArtefactId}`,
    );
    throw new Error("Transaction not found"); // ABDM might retry
  }

  const { privateKey, nonce: myNonce } = hiuRequest.keyMaterial;
  const { dhPublicKey, nonce: senderNonce } = senderKeyMaterial;

  // 2. Process each entry (decryption)
  for (const entry of entries) {
    try {
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

        // Link to local patient by ABHA address
        const localPatient = await PatientModel.findOne({
          $or: [
            { abhaaddress: hiuRequest.patientAbhaAddress },
            { ABHANumber: hiuRequest.patientAbhaAddress },
          ],
        })
          .select("_id")
          .lean();

        await ExternalHealthRecordModel.findOneAndUpdate(
          {
            transactionId: transactionId,
            careContextReference: entry.careContextReference,
          },
          {
            $set: {
              patientAbhaAddress: hiuRequest.patientAbhaAddress,
              patientId: localPatient?._id,
              consentArtefactId: hiuRequest.consentArtefactId,
              requestId: hiuRequest.requestId,

              sourceHipId: hipId,
              sourceHipName: hipName,

              fhirBundle: decryptedData,
              hiTypes: extractHiTypesFromBundle(decryptedData),

              dateRange: hiuRequest.dateRange,
              status: ExternalRecordStatus.STORED,

              encryptedDataSize: entry.content.length,
              decryptedDataSize: JSON.stringify(decryptedData).length,
              decryptedAt: new Date(),
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
 */
const extractSourceHipInfo = (
  bundle: any,
): { hipId: string; hipName?: string } => {
  if (!bundle || !bundle.entry) {
    return { hipId: "UNKNOWN" };
  }

  // Strategy 1: Find Organization resource directly
  for (const entry of bundle.entry) {
    const resource = entry.resource;
    if (resource?.resourceType === "Organization") {
      const hipId = resource.identifier?.[0]?.value || resource.id || "UNKNOWN";
      const hipName = resource.name;
      return { hipId, hipName };
    }
  }

  // Strategy 2: Look at Composition.custodian
  for (const entry of bundle.entry) {
    const resource = entry.resource;
    if (resource?.resourceType === "Composition" && resource.custodian) {
      // custodian is a reference like "Organization/xyz" or "urn:uuid:xyz"
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
};

// Use simple logic to extract hiTypes from bundle
const extractHiTypesFromBundle = (bundle: any): string[] => {
  const types = new Set<string>();
  if (!bundle || !bundle.entry) return [];

  for (const entry of bundle.entry) {
    const resource = entry.resource;
    if (!resource) continue;

    if (resource.resourceType === "Composition") {
      // 1. Check Composition title (for single-type bundles)
      const title = resource.title?.toLowerCase() || "";
      if (title.includes("prescription")) types.add("Prescription");
      if (title.includes("diagnostic") || title.includes("lab"))
        types.add("DiagnosticReport");
      if (title.includes("discharge")) types.add("DischargeSummary");
      if (title.includes("immunization")) types.add("ImmunizationRecord");
      if (title.includes("wellness")) types.add("WellnessRecord");
      if (title.includes("health document")) types.add("HealthDocumentRecord");

      // 2. Check Composition SECTIONS (for combined bundles)
      if (resource.section && Array.isArray(resource.section)) {
        for (const section of resource.section) {
          const secTitle = section.title?.toLowerCase() || "";
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
    .select("artefactId patientAbhaAddress rawConsentDetail")
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
      await requestHealthInformation(consent.artefactId, dateRange);
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
