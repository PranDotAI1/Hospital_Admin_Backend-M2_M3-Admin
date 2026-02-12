import axios from "axios";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
  IConsentArtefact,
} from "../models/ConsentArtefact";
import { ConsentRequestModel, IConsentRequest } from "../models/ConsentRequest";
import { PatientModel } from "../models/Patient";
import { AbdmTokenService } from "./abdm.token.service";
import { ENDPOINTS } from "../utils/endpoints";
import {
  generateUID,
  X_CM_ID,
  X_HIP_ID,
  facilityId,
  facilityName,
  GET_URL,
} from "../utils/constant";
import { HiuService } from "./hiu.service";

const LOG_PREFIX = "[CONSENT]";

// ============================================================================
// 1. Handle HIP Notify (ABDM -> HIP)
// ============================================================================

/**
 * Process a consent notification from ABDM to this HIP.
 *
 * ABDM may send either:
 * - consentArtefacts: [{ id }] (legacy)
 * - consentDetail: { full consent object } (inline, no separate fetch needed)
 *
 * We must:
 * 1. Update ConsentRequest status
 * 2. For GRANTED: store artefact (from consentDetail inline or stubs + fetch)
 * 3. For REVOKED: mark artefacts as REVOKED
 * 4. Always send on-notify ACK back to ABDM (use callbackAuthToken when provided to avoid 403)
 */
export const handleHipNotify = async (
  notification: any,
  requestId: string,
  callbackAuthToken?: string,
): Promise<void> => {
  const status = notification.status;

  // Extract IDs: consentRequestId is the parent request; consentId/artefact IDs
  // are the actual consent artefact IDs that ABDM expects in on-notify ACK.
  const consentRequestId = notification.consentRequestId;
  const notificationConsentId = notification.consentId; // artefact-level ID

  // Determine the artefact IDs for this notification
  let artefactIds: string[] = [];
  if (
    notification.consentArtefacts &&
    Array.isArray(notification.consentArtefacts)
  ) {
    artefactIds = notification.consentArtefacts.map((a: any) => a.id);
  }
  if (notificationConsentId) {
    artefactIds.push(notificationConsentId);
  }
  // Deduplicate
  artefactIds = [...new Set(artefactIds)];

  // The on-notify ACK must use a consent ARTEFACT ID, never the consentRequestId.
  // If we have artefact IDs, use the first. Otherwise fall back to notificationConsentId.
  const ackConsentId =
    artefactIds[0] || notificationConsentId || consentRequestId;

  // Use consentRequestId for DB lookups; fall back to consentId for single-artefact payloads
  const dbLookupId = consentRequestId || notificationConsentId;

  console.log(
    `${LOG_PREFIX} HIP notify: consentRequestId=${consentRequestId}, consentId=${notificationConsentId}, status=${status}, artefactIds=${JSON.stringify(artefactIds)}, ackId=${ackConsentId}`,
  );

  if (!status) {
    console.error(`${LOG_PREFIX} HIP notify missing status`);
    return;
  }

  // --- Deduplication: if all artefact IDs are already stored and GRANTED, skip ---
  if (status === "GRANTED" && artefactIds.length > 0) {
    const existing = await ConsentArtefactModel.find({
      artefactId: { $in: artefactIds },
      status: ConsentArtefactStatus.GRANTED,
    });
    if (existing.length === artefactIds.length) {
      console.log(
        `${LOG_PREFIX} All ${artefactIds.length} artefacts already stored and GRANTED. Sending ACK only.`,
      );
      await sendHipOnNotifyAck(
        ackConsentId,
        requestId,
        "OK",
        callbackAuthToken,
      );
      return;
    }
  }

  try {
    const updateData: any = { status };

    if (status === "GRANTED") {
      // For list UI: "Consent granted on" / "Consent expiry on"
      updateData.grantedAt = new Date();

      // ABDM sends EITHER:
      //  a) consentDetail inline (HIP notify with full object)
      //  b) consentArtefacts[] array (just IDs, need separate fetch)
      //  c) consentId only (single artefact)

      if (notification.consentDetail) {
        // (a) Inline consent detail: store immediately
        const detail = notification.consentDetail;
        const detailArtefactId = detail.consentId || notificationConsentId;
        if (detailArtefactId) {
          updateData.consentArtefacts = [detailArtefactId];
          const artefact = await storeArtefactDetails(
            detail,
            status,
            consentRequestId || detailArtefactId,
          );
          if (artefact?.expiryDate) {
            updateData.consentExpiryOn = artefact.expiryDate;
          } else if (detail.permission?.dataEraseAt) {
            updateData.consentExpiryOn = new Date(
              detail.permission.dataEraseAt,
            );
          } else if (detail.permission?.dateRange?.to) {
            updateData.consentExpiryOn = new Date(
              detail.permission.dateRange.to,
            );
          }
          console.log(
            `${LOG_PREFIX} Stored inline consentDetail for artefact ${detailArtefactId}`,
          );
        }
      } else if (artefactIds.length > 0) {
        // (b)/(c) Artefact IDs without inline detail
        updateData.consentArtefacts = artefactIds;
        for (const aid of artefactIds) {
          // Only create stub if not already stored
          const exists = await ConsentArtefactModel.findOne({
            artefactId: aid,
          });
          if (!exists) {
            await createArtefactStub(aid, consentRequestId || aid);
          }
        }
        console.log(
          `${LOG_PREFIX} Ensured ${artefactIds.length} artefact stubs for consent`,
        );
        // Fetch details only for artefacts we don't already have full detail for
        const idsNeedingFetch: string[] = [];
        for (const aid of artefactIds) {
          const existing = await ConsentArtefactModel.findOne({
            artefactId: aid,
          });
          if (!existing?.rawConsentDetail) {
            idsNeedingFetch.push(aid);
          }
        }
        if (idsNeedingFetch.length > 0) {
          fetchArtefactDetailsAsync(
            idsNeedingFetch.map((id) => ({ id })),
            callbackAuthToken,
          );
        }
      }

      // ======== AUTO-TRIGGER: Fetch health data from other HIPs ========
      // When patient grants consent, automatically request their health data
      if (artefactIds.length > 0) {
        triggerHiuDataFetchAsync(artefactIds);
      }
    }

    if (status === "REVOKED") {
      const query = consentRequestId
        ? { consentRequestId }
        : { artefactId: { $in: artefactIds } };
      const result = await ConsentArtefactModel.updateMany(query, {
        $set: { status: ConsentArtefactStatus.REVOKED, revokedAt: new Date() },
      });
      console.log(`${LOG_PREFIX} Revoked ${result.modifiedCount} artefacts`);
    }

    if (status === "EXPIRED") {
      const query = consentRequestId
        ? { consentRequestId }
        : { artefactId: { $in: artefactIds } };
      await ConsentArtefactModel.updateMany(query, {
        $set: { status: ConsentArtefactStatus.EXPIRED },
      });
    }

    if (status === "DENIED") {
      const query = consentRequestId
        ? { consentRequestId }
        : { artefactId: { $in: artefactIds } };
      await ConsentArtefactModel.updateMany(query, {
        $set: { status: ConsentArtefactStatus.DENIED },
      });
    }

    // Update the ConsentRequest record
    if (dbLookupId) {
      await ConsentRequestModel.updateOne(
        {
          $or: [
            { consentRequestId: dbLookupId },
            { consentArtefacts: dbLookupId },
          ],
        },
        { $set: updateData },
      );
    }

    // Send on-notify ACK with the ARTEFACT ID (not consentRequestId)
    await sendHipOnNotifyAck(ackConsentId, requestId, "OK", callbackAuthToken);
  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error processing HIP notify:`, error.message);
    try {
      await sendHipOnNotifyAck(
        ackConsentId,
        requestId,
        "OK",
        callbackAuthToken,
      );
    } catch (ackError: any) {
      console.error(
        `${LOG_PREFIX} Failed to send on-notify ACK after error:`,
        ackError.message,
      );
    }
  }
};

/**
 * Auto-trigger HIU data fetch for each consent artefact.
 * Runs asynchronously (fire-and-forget) to not block the main consent flow.
 * Includes deduplication to prevent duplicate requests.
 */
const triggerHiuDataFetchAsync = (artefactIds: string[]): void => {
  if (!artefactIds || artefactIds.length === 0) return;

  // Import models for deduplication and date range lookup
  const { HIURequestModel } = require("../models/HIURequest");

  // Run async without blocking
  (async () => {
    for (const artefactId of artefactIds) {
      try {
        // DEDUPLICATION: Check if we already have a request for this artefact
        const existingRequest = await HIURequestModel.findOne({
          consentArtefactId: artefactId,
          createdAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }, // Within last 5 mins
        });

        if (existingRequest) {
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - request already exists (requestId: ${existingRequest.requestId})`,
          );
          continue;
        }

        // Get consent's date range from the stored artefact
        const artefact = await ConsentArtefactModel.findOne({ artefactId });

        let dateRange: { from: Date; to: Date };

        if (artefact?.rawConsentDetail?.permission?.dateRange) {
          // Use the consent's date range
          const consentDateRange =
            artefact.rawConsentDetail.permission.dateRange;
          dateRange = {
            from: new Date(consentDateRange.from),
            to: new Date(consentDateRange.to),
          };
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Using consent's date range: ${dateRange.from.toISOString()} to ${dateRange.to.toISOString()}`,
          );
        } else {
          // Fallback: use 90 days range if consent dateRange not available
          dateRange = {
            from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
            to: new Date(),
          };
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Using fallback date range: ${dateRange.from.toISOString()} to ${dateRange.to.toISOString()}`,
          );
        }

        console.log(
          `${LOG_PREFIX} [AUTO-TRIGGER] Initiating HIU data fetch for artefact: ${artefactId}`,
        );

        const result = await HiuService.requestHealthInformation(
          artefactId,
          dateRange,
        );
        console.log(
          `${LOG_PREFIX} [AUTO-TRIGGER] HIU request sent for ${artefactId}, requestId: ${result.requestId}`,
        );

        // Small delay between requests to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error: any) {
        console.error(
          `${LOG_PREFIX} [AUTO-TRIGGER] Failed for ${artefactId}:`,
          error.message,
        );
        // Continue with other artefacts even if one fails
      }
    }
  })();
};

/**
 * Create a stub artefact record before we fetch full details.
 */
const createArtefactStub = async (
  artefactId: string,
  consentRequestId: string,
): Promise<void> => {
  try {
    // Look up the consent request to get patient info
    const consentReq = await ConsentRequestModel.findOne({ consentRequestId });

    await ConsentArtefactModel.findOneAndUpdate(
      { artefactId },
      {
        $setOnInsert: {
          artefactId,
          consentRequestId,
          status: ConsentArtefactStatus.GRANTED,
          patientAbhaAddress: consentReq?.patientAbhaId || "",
          hipId: consentReq?.hiuId || facilityId,
          hiTypes: consentReq?.hiTypes || [],
          permission: consentReq?.permission || {
            accessMode: "VIEW",
            dateRange: { from: new Date(), to: new Date() },
            dataEraseAt: new Date(),
            frequency: { unit: "HOUR", value: 0, repeats: 0 },
          },
          grantedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  } catch (error: any) {
    // Ignore duplicate key errors (artefact already exists)
    if (error.code !== 11000) {
      console.error(
        `${LOG_PREFIX} Error creating artefact stub ${artefactId}:`,
        error.message,
      );
    }
  }
};

// ============================================================================
// 2. Send HIP on-notify ACK
// ============================================================================

/**
 * Acknowledge consent notification back to ABDM.
 * POST /hiecm/consent/v3/request/hip/on-notify
 *
 * This is REQUIRED by the ABDM spec -- without it, ABDM considers the
 * notification undelivered.
 *
 * When ABDM calls our webhook, it often sends an Authorization header. Use
 * callbackAuthToken when provided to avoid 403 from our own token refresh
 * (e.g. rate limit or credential issues).
 */
export const sendHipOnNotifyAck = async (
  consentId: string,
  originalRequestId: string,
  ackStatus: string = "OK",
  callbackAuthToken?: string,
): Promise<boolean> => {
  try {
    let abdmToken: string;
    if (callbackAuthToken && callbackAuthToken.trim()) {
      abdmToken = callbackAuthToken.trim();
      if (!abdmToken.toLowerCase().startsWith("bearer ")) {
        abdmToken = `Bearer ${abdmToken}`;
      }
      console.log(
        `${LOG_PREFIX} Using callback request token for on-notify ACK`,
      );
    } else {
      abdmToken = await AbdmTokenService.getToken();
    }
    const requestId = generateUID();

    const payload = {
      acknowledgement: {
        status: ackStatus,
        consentId,
      },
      response: {
        requestId: originalRequestId,
      },
    };

    console.log(`${LOG_PREFIX} Sending on-notify ACK for consent ${consentId}`);

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}${ENDPOINTS.CONSENT_HIP_ON_NOTIFY}`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": facilityId,
          Authorization: abdmToken,
        },
      },
    );

    console.log(`${LOG_PREFIX} on-notify ACK sent, status: ${response.status}`);
    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Failed to send on-notify ACK:`,
      error.response?.data || error.message,
    );
    return false;
  }
};

// ============================================================================
// 3. Fetch Consent Artefact Details
// ============================================================================

/**
 * Fetch full artefact details from ABDM.
 * POST /hiecm/consent/v3/fetch
 *
 * This retrieves the full consent detail including care contexts,
 * HIU info, permission details, and digital signature.
 */
export const fetchConsentArtefact = async (
  artefactId: string,
  callbackAuthToken?: string,
): Promise<IConsentArtefact | null> => {
  try {
    let abdmToken: string;
    if (callbackAuthToken && callbackAuthToken.trim()) {
      abdmToken = callbackAuthToken.trim();
      if (!abdmToken.toLowerCase().startsWith("bearer ")) {
        abdmToken = `Bearer ${abdmToken}`;
      }
    } else {
      abdmToken = await AbdmTokenService.getToken();
    }
    const requestId = generateUID();

    const payload = {
      consentId: artefactId,
    };

    console.log(`${LOG_PREFIX} Fetching artefact details for ${artefactId}`);

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}${ENDPOINTS.CONSENT_FETCH}`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": facilityId,
          Authorization: abdmToken,
        },
      },
    );

    if (response.status === 200 || response.status === 202) {
      console.log(
        `${LOG_PREFIX} Artefact fetch initiated for ${artefactId}, waiting for callback`,
      );
      // NOTE: ABDM responds asynchronously via the on-fetch callback
      // The actual artefact details arrive at POST /:requestid/api/v3/hiu/consent/on-fetch
      return null;
    }

    return null;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Failed to fetch artefact ${artefactId}:`,
      error.response?.data || error.message,
    );
    return null;
  }
};

/**
 * Store the full artefact details (from on-fetch callback or inline in HIP notify).
 * When consentRequestId is provided (e.g. from inline notify), it is set so upsert succeeds.
 */
export const storeArtefactDetails = async (
  consentDetail: any,
  consentStatus: string,
  consentRequestId?: string,
): Promise<IConsentArtefact | null> => {
  try {
    const artefactId = consentDetail.consentId || consentDetail.id;

    if (!artefactId) {
      console.error(`${LOG_PREFIX} No artefact ID in consent detail`);
      return null;
    }

    const updateData: any = {
      artefactId,
      consentRequestId: consentRequestId || artefactId,
      lastFetchedAt: new Date(),
      rawConsentDetail: consentDetail,
      grantedAt: new Date(),
    };

    // Extract patient ABHA address
    if (consentDetail.patient?.id) {
      updateData.patientAbhaAddress = consentDetail.patient.id;
    }

    // Extract HIP/HIU IDs
    if (consentDetail.hip?.id) {
      updateData.hipId = consentDetail.hip.id;
    }
    if (consentDetail.hiu?.id) {
      updateData.hiuId = consentDetail.hiu.id;
    }

    // Extract care contexts
    if (
      consentDetail.careContexts &&
      Array.isArray(consentDetail.careContexts)
    ) {
      updateData.careContexts = consentDetail.careContexts.map((cc: any) => ({
        patientReference: cc.patientReference,
        careContextReference: cc.careContextReference,
      }));
    }

    // Extract hiTypes
    if (consentDetail.hiTypes) {
      updateData.hiTypes = consentDetail.hiTypes;
    }

    // Extract permission
    if (consentDetail.permission) {
      updateData.permission = {
        accessMode: consentDetail.permission.accessMode || "VIEW",
        dateRange: {
          from: consentDetail.permission.dateRange?.from
            ? new Date(consentDetail.permission.dateRange.from)
            : new Date(),
          to: consentDetail.permission.dateRange?.to
            ? new Date(consentDetail.permission.dateRange.to)
            : new Date(),
        },
        dataEraseAt: consentDetail.permission.dataEraseAt
          ? new Date(consentDetail.permission.dataEraseAt)
          : new Date(),
        frequency: consentDetail.permission.frequency || {
          unit: "HOUR",
          value: 0,
          repeats: 0,
        },
      };

      // Set expiry date from dataEraseAt or permission end date
      updateData.expiryDate = consentDetail.permission.dataEraseAt
        ? new Date(consentDetail.permission.dataEraseAt)
        : consentDetail.permission.dateRange?.to
          ? new Date(consentDetail.permission.dateRange.to)
          : undefined;
    }

    // Extract purpose
    if (consentDetail.purpose) {
      updateData.purpose = consentDetail.purpose;
    }

    // Extract requester
    if (consentDetail.requester) {
      updateData.requester = consentDetail.requester;
    }

    // Extract consent manager's signature
    if (consentDetail.signature) {
      updateData.signature = consentDetail.signature;
    }

    // Update status from the fetch response
    if (consentStatus) {
      updateData.status = consentStatus;
    }

    const artefact = await ConsentArtefactModel.findOneAndUpdate(
      { artefactId },
      { $set: updateData },
      { upsert: true, new: true },
    );

    console.log(
      `${LOG_PREFIX} Stored artefact details for ${artefactId}, careContexts: ${updateData.careContexts?.length || 0}`,
    );

    // Keep ConsentRequest in sync for list UI (grantedAt, consentExpiryOn)
    const reqId = consentRequestId || artefact?.consentRequestId;
    if (reqId && artefact) {
      const crUpdate: any = {};
      if (artefact.grantedAt) crUpdate.grantedAt = artefact.grantedAt;
      if (artefact.expiryDate) crUpdate.consentExpiryOn = artefact.expiryDate;
      if (Object.keys(crUpdate).length > 0) {
        await ConsentRequestModel.updateOne(
          {
            $or: [
              { consentRequestId: reqId },
              { consentArtefacts: artefactId },
            ],
          },
          { $set: crUpdate },
        );
      }
    }

    return artefact;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error storing artefact details:`,
      error.message,
    );
    return null;
  }
};

/**
 * Asynchronously fetch full details for each artefact.
 * Non-blocking -- errors are logged but don't propagate.
 */
const fetchArtefactDetailsAsync = (
  artefacts: Array<{ id: string }>,
  callbackAuthToken?: string,
) => {
  if (!artefacts || artefacts.length === 0) return;
  // Run asynchronously without awaiting
  (async () => {
    for (const art of artefacts) {
      try {
        await fetchConsentArtefact(art.id, callbackAuthToken);
        // Small delay between fetches to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(
          `${LOG_PREFIX} Async fetch failed for artefact ${art.id}:`,
          error.message,
        );
      }
    }
  })();
};

// ============================================================================
// 4. Validate Consent for Data Push
// ============================================================================

/**
 * Validate that a consent artefact is still valid for data transfer.
 * Called before pushing health data to ensure:
 * 1. Artefact exists
 * 2. Status is GRANTED
 * 3. Not expired (expiryDate > now)
 *
 * Returns the artefact if valid, null otherwise.
 */
export const validateConsentForDataPush = async (
  consentId: string,
): Promise<IConsentArtefact | null> => {
  try {
    // Find artefact by ID
    const artefact = await ConsentArtefactModel.findOne({
      artefactId: consentId,
    });

    if (!artefact) {
      console.warn(`${LOG_PREFIX} No artefact found for consent ${consentId}`);
      // Don't block data push if artefact doesn't exist yet
      // (ABDM may send health-info request before on-fetch callback arrives)
      return null;
    }

    if (artefact.status !== ConsentArtefactStatus.GRANTED) {
      console.error(
        `${LOG_PREFIX} Consent ${consentId} is not GRANTED (status: ${artefact.status}). Blocking data push.`,
      );
      return null;
    }

    if (artefact.expiryDate && new Date(artefact.expiryDate) < new Date()) {
      console.error(
        `${LOG_PREFIX} Consent ${consentId} has expired (expiryDate: ${artefact.expiryDate}). Blocking data push.`,
      );

      // Auto-update status to EXPIRED
      await ConsentArtefactModel.updateOne(
        { artefactId: consentId },
        { $set: { status: ConsentArtefactStatus.EXPIRED } },
      );

      return null;
    }

    console.log(`${LOG_PREFIX} Consent ${consentId} validated for data push`);
    return artefact;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error validating consent ${consentId}:`,
      error.message,
    );
    return null;
  }
};

// ============================================================================
// 5. Initiate Consent Request (HIU flow)
// ============================================================================

export interface ConsentInitParams {
  abhaId: string;
  hiuId: string;
  hiTypes: string[];
  dateFrom: string;
  dateTo: string;
  dataEraseAt: string;
  requesterName?: string;
  purposeCode?: string;
  purposeText?: string;
}

/**
 * Initiate a consent request to ABDM.
 * POST /hiecm/consent/v3/request/init
 *
 * Uses AbdmTokenService for authentication (no more standalone getSessionToken).
 */
export const initiateConsentRequest = async (
  params: ConsentInitParams,
): Promise<{ requestId: string; status: number; data: any }> => {
  const abdmToken = await AbdmTokenService.getToken();
  const requestId = generateUID();

  const payload = {
    consent: {
      purpose: {
        text: params.purposeText || "Care Management",
        code: params.purposeCode || "CAREMGT",
        refUri: GET_URL,
      },
      patient: {
        id: params.abhaId,
      },
      hiu: {
        id: params.hiuId,
      },
      hip: null,
      careContexts: null,
      requester: {
        name: params.requesterName || facilityName,
        identifier: {
          type: "REGNO",
          value: facilityId,
          system: GET_URL,
        },
      },
      hiTypes: params.hiTypes,
      permission: {
        accessMode: "VIEW",
        dateRange: {
          from: params.dateFrom,
          to: params.dateTo,
        },
        dataEraseAt: params.dataEraseAt,
        frequency: {
          unit: "HOUR",
          value: 0,
          repeats: 0,
        },
      },
    },
  };

  console.log(
    `${LOG_PREFIX} Initiating consent request for patient ${params.abhaId}`,
  );

  const response = await axios.post(
    `${process.env.ABDM_BASE_URL}${ENDPOINTS.REQ_INIT}`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        "REQUEST-ID": requestId,
        TIMESTAMP: new Date().toISOString(),
        "X-CM-ID": X_CM_ID,
        "X-HIP-ID": facilityId,
        Authorization: abdmToken,
      },
    },
  );

  console.log(`${LOG_PREFIX} Consent init response: status=${response.status}`);

  // Save the consent request to DB
  const patientDetails = await lookupPatientDetails(params.abhaId);

  await ConsentRequestModel.create({
    requestId,
    status: "INITIATED",
    patientAbhaId: params.abhaId,
    ...patientDetails,
    facilityName,
    hiuId: params.hiuId,
    requester: {
      name: params.requesterName || facilityName,
      identifier: {
        type: "REGNO",
        value: facilityId,
        system: GET_URL,
      },
    },
    purpose: {
      code: params.purposeCode || "CAREMGT",
      text: params.purposeText || "Care Management",
      refUri: GET_URL,
    },
    hiTypes: params.hiTypes,
    permission: {
      accessMode: "VIEW",
      dateRange: {
        from: new Date(params.dateFrom),
        to: new Date(params.dateTo),
      },
      dataEraseAt: new Date(params.dataEraseAt),
      frequency: { unit: "HOUR", value: 0, repeats: 0 },
    },
  });

  return { requestId, status: response.status, data: response.data };
};

/**
 * Look up local patient details for a consent request record.
 */
const lookupPatientDetails = async (
  abhaId: string,
): Promise<Record<string, any>> => {
  try {
    const cleanInput = abhaId.replace(/-/g, "");
    const formattedInput =
      cleanInput.length === 14
        ? `${cleanInput.slice(0, 2)}-${cleanInput.slice(2, 6)}-${cleanInput.slice(6, 10)}-${cleanInput.slice(10, 14)}`
        : abhaId;

    const patient = await PatientModel.findOne({
      $or: [
        { abhaaddress: abhaId },
        { uhid: abhaId },
        { ABHANumber: cleanInput },
        { ABHANumber: formattedInput },
      ],
    });

    if (!patient) return {};

    return {
      patientName:
        patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim(),
      abhaAddress: patient.abhaaddress,
      abhaNumber: patient.ABHANumber,
      gender: patient.gender,
      dob: patient.dob,
    };
  } catch {
    return {};
  }
};

// ============================================================================
// 6. Check Consent Status
// ============================================================================

/**
 * Query ABDM for the current status of a consent request.
 * POST /hiecm/consent/v3/request/status
 */
export const checkConsentStatus = async (
  consentRequestId: string,
): Promise<{ status: number; data: any }> => {
  const abdmToken = await AbdmTokenService.getToken();
  const requestId = generateUID();

  console.log(`${LOG_PREFIX} Checking consent status for ${consentRequestId}`);

  const response = await axios.post(
    `${process.env.ABDM_BASE_URL}${ENDPOINTS.GET_REQ_STATUS}`,
    { consentRequestId },
    {
      headers: {
        "Content-Type": "application/json",
        "REQUEST-ID": requestId,
        TIMESTAMP: new Date().toISOString(),
        "X-CM-ID": X_CM_ID,
        "X-HIP-ID": facilityId,
        Authorization: abdmToken,
      },
    },
  );

  console.log(`${LOG_PREFIX} Consent status response: ${response.status}`);

  // Update local record with last checked time
  await ConsentRequestModel.updateOne(
    { consentRequestId },
    { $set: { lastCheckedAt: new Date() } },
  );

  return { status: response.status, data: response.data };
};

// ============================================================================
// 7. Query helpers
// ============================================================================

/**
 * Get all artefacts for a given consent request.
 */
export const getArtefactsByConsentRequest = async (
  consentRequestId: string,
): Promise<IConsentArtefact[]> => {
  return ConsentArtefactModel.find({ consentRequestId }).sort({
    createdAt: -1,
  });
};

/**
 * Get all active (GRANTED) artefacts for a patient.
 */
export const getActiveArtefactsForPatient = async (
  abhaAddress: string,
): Promise<IConsentArtefact[]> => {
  return ConsentArtefactModel.find({
    patientAbhaAddress: abhaAddress,
    status: ConsentArtefactStatus.GRANTED,
    $or: [
      { expiryDate: { $exists: false } },
      { expiryDate: null },
      { expiryDate: { $gt: new Date() } },
    ],
  }).sort({ createdAt: -1 });
};

/**
 * Find care context references authorized by a specific consent artefact.
 */
export const getCareContextRefsForArtefact = async (
  artefactId: string,
): Promise<
  Array<{ patientReference: string; careContextReference: string }>
> => {
  const artefact = await ConsentArtefactModel.findOne({ artefactId });
  if (!artefact || !artefact.careContexts) return [];
  return artefact.careContexts;
};

// ============================================================================
// Export as service object
// ============================================================================

export const ConsentService = {
  handleHipNotify,
  sendHipOnNotifyAck,
  fetchConsentArtefact,
  storeArtefactDetails,
  validateConsentForDataPush,
  initiateConsentRequest,
  checkConsentStatus,
  getArtefactsByConsentRequest,
  getActiveArtefactsForPatient,
  getCareContextRefsForArtefact,
};

export default ConsentService;
