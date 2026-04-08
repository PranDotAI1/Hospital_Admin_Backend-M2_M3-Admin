import axios from "axios";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
  IConsentArtefact,
} from "../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../models/PHRConsentArtefact";
import { ConsentRequestModel, IConsentRequest } from "../models/ConsentRequest";
import { PatientModel } from "../models/Patient";
import { AbdmTokenService } from "./abdm.token.service";
import { ENDPOINTS } from "../utils/endpoints";
import {
  generateUID,
  X_CM_ID,
  X_HIP_ID,
  X_HIU_ID,
  facilityId,
  facilityName,
  GET_URL,
} from "../utils/constant";
import { HiuService } from "./hiu.service";
import { ExternalHealthRecordModel } from "../models/ExternalHealthRecord";

const LOG_PREFIX = "[CONSENT]";

// ============================================================================
// Helper: Build a query that catches artefacts by consentRequestId AND by
// artefactId directly. Self-referencing ghost artefacts (artefactId ===
// consentRequestId) are only reachable by artefactId, so we need $or.
// ============================================================================
const buildBroadArtefactQuery = (
  consentRequestId: string | undefined,
  artefactIds: string[],
): any => {
  const conditions: any[] = [];
  if (consentRequestId) {
    conditions.push({ consentRequestId });
  }
  if (artefactIds.length > 0) {
    conditions.push({ artefactId: { $in: artefactIds } });
  }
  if (conditions.length === 0) {
    // Fallback: should never happen, but return an impossible match
    return { artefactId: "__impossible__" };
  }
  return conditions.length === 1 ? conditions[0] : { $or: conditions };
};

/**
 * Resolve all artefact IDs that match a query, merging with any explicitly
 * provided artefactIds. Deduplicates the result.
 */
const resolveArtefactIds = async (
  query: any,
  explicitIds: string[],
): Promise<string[]> => {
  const fromMain = await ConsentArtefactModel.find(query)
    .select("artefactId")
    .lean();
  const fromPHR = await PHRConsentArtefactModel.find(query)
    .select("artefactId")
    .lean();
  return [
    ...new Set([
      ...explicitIds,
      ...fromMain.map((a: any) => a.artefactId),
      ...fromPHR.map((a: any) => a.artefactId),
    ]),
  ];
};

// ============================================================================
// 1. Handle HIP Notify (ABDM -> HIP)
// ============================================================================

/**
 * Process a consent notification from ABDM to this HIP.
 *
 * ABDM standards (aligned with our handling):
 * - Consent REQUEST id: assigned at consent init; identifies the request (used for DENIED/status).
 * - Consent ARTEFACT id: generated only when patient APPROVES; one per granted consent (may cover
 *   multiple care contexts). Used for on-notify ACK and for HIU data fetch. We must never store
 *   consent request id as an artefact id.
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

  // Determine the artefact IDs for this notification.
  // CRITICAL: consentRequestId is the REQUEST id (from init); artefact IDs are only returned when user GRANTS.
  // Never treat consentRequestId as an artefact ID — otherwise we create fake ConsentArtefact records per request.
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
  // Deduplicate and exclude consentRequestId (must never create ConsentArtefact with request id)
  artefactIds = [...new Set(artefactIds)].filter(
    (id) => id && id !== consentRequestId,
  );
  if (
    consentRequestId &&
    (notificationConsentId === consentRequestId || artefactIds.length === 0)
  ) {
    console.log(
      `${LOG_PREFIX} Excluded consentRequestId from artefact IDs (request id must not be stored as artefact)`,
    );
  }

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
      updateData.grantedAt = notification.timestamp
        ? new Date(notification.timestamp)
        : new Date();

      let usePHRCollection = false;

      if (notification.consentDetail?.purpose?.code === "PATRQT") {
        usePHRCollection = true;
        console.log(
          `${LOG_PREFIX} Detected PHR pull record (purpose.code=PATRQT). Using PHR collection.`,
        );
      } else {
        const consentReq = consentRequestId
          ? await ConsentRequestModel.findOne({
              $or: [{ consentRequestId }, { requestId: consentRequestId }],
            })
              .select("requestPurpose")
              .lean()
          : null;
        if (consentReq?.requestPurpose === "PHR") {
          usePHRCollection = true;
          console.log(
            `${LOG_PREFIX} Using PHR collection based on ConsentRequest.requestPurpose=PHR.`,
          );
        }
      }

      if (usePHRCollection) {
        console.log(
          `${LOG_PREFIX} Storing artefact(s) in phr_consent_artefacts (PHR pull record).`,
        );
      }

      // ABDM sends EITHER:
      //  a) consentDetail inline (HIP notify with full object)
      //  b) consentArtefacts[] array (just IDs, need separate fetch)
      //  c) consentId only (single artefact)

      if (notification.consentDetail) {
        // (a) Inline consent detail: store immediately (only if consentId is a real artefact id, not consentRequestId)
        const detail = notification.consentDetail;
        const detailArtefactId = detail.consentId || notificationConsentId;
        if (detailArtefactId) {
          const isPHRPull = detail.purpose?.code === "PATRQT";
          const finalUsePHRCollection = isPHRPull || usePHRCollection;

          if (isPHRPull && !usePHRCollection) {
            console.log(
              `${LOG_PREFIX} Detected PHR pull record from purpose.code=PATRQT for artefact ${detailArtefactId}. Using PHR collection.`,
            );
          }

          const artefact = await storeArtefactDetails(
            detail,
            status,
            consentRequestId || undefined, // Never pass detailArtefactId as fallback — storeArtefactDetails resolves it
            finalUsePHRCollection,
            updateData.grantedAt, // pass notification timestamp for accurate audit trail
          );
          if (artefact) {
            updateData.consentArtefacts = [detailArtefactId];
            if (artefact.expiryDate) {
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
            if (detail.hiTypes) {
              updateData.approvedHiTypes = detail.hiTypes;
            }
            if (detail.permission?.dateRange) {
              updateData.approvedDateRange = {
                from: new Date(detail.permission.dateRange.from),
                to: new Date(detail.permission.dateRange.to),
              };
            }

            // Build consolidated approved object
            const approved: any = {};
            if (detail.permission?.dateRange) {
              approved.dateRange = {
                from: new Date(detail.permission.dateRange.from),
                to: new Date(detail.permission.dateRange.to),
              };
            }
            if (detail.hiTypes) approved.hiTypes = detail.hiTypes;
            if (detail.permission?.accessMode)
              approved.accessMode = detail.permission.accessMode;
            if (detail.permission?.dataEraseAt)
              approved.dataEraseAt = new Date(detail.permission.dataEraseAt);
            approved.expiryDate = updateData.consentExpiryOn || null;
            updateData.approved = approved;

            console.log(
              `${LOG_PREFIX} Stored inline consentDetail for artefact ${detailArtefactId}`,
            );

            const hasCareContexts =
              (detail.careContexts &&
                Array.isArray(detail.careContexts) &&
                detail.careContexts.length > 0) ||
              (detail.consentDetail?.careContexts &&
                Array.isArray(detail.consentDetail.careContexts) &&
                detail.consentDetail.careContexts.length > 0);

            if (
              !hasCareContexts &&
              artefact.careContexts?.length === 0 &&
              !usePHRCollection
            ) {
              console.warn(
                `${LOG_PREFIX} Inline consentDetail for ${detailArtefactId} has no care contexts. Triggering fetch to get full detail from ABDM.`,
              );
              fetchArtefactDetailsAsync(
                [{ id: detailArtefactId }],
                callbackAuthToken,
              );
            }
          }
        }
      } else if (artefactIds.length > 0) {
        // (b)/(c) Artefact IDs without inline detail
        let finalUsePHRCollection = usePHRCollection;
        for (const aid of artefactIds) {
          const existingPHR = await PHRConsentArtefactModel.findOne({
            artefactId: aid,
          });
          if (existingPHR) {
            finalUsePHRCollection = true;
            console.warn(
              `${LOG_PREFIX} Artefact ${aid} already exists in PHR collection. Using PHR collection for all artefacts.`,
            );
            break;
          }
        }

        const ArtefactModel = finalUsePHRCollection
          ? PHRConsentArtefactModel
          : ConsentArtefactModel;
        updateData.consentArtefacts = artefactIds;
        for (const aid of artefactIds) {
          const exists = await ArtefactModel.findOne({ artefactId: aid });
          if (!exists) {
            await createArtefactStub(
              aid,
              consentRequestId || aid,
              finalUsePHRCollection,
            );
          }
        }
        console.log(
          `${LOG_PREFIX} Ensured ${artefactIds.length} artefact stubs for consent${finalUsePHRCollection ? " (PHR collection)" : ""}`,
        );
        const idsNeedingFetch: string[] = [];
        for (const aid of artefactIds) {
          const existing = await ArtefactModel.findOne({ artefactId: aid });
          if (!existing?.rawConsentDetail) {
            idsNeedingFetch.push(aid);
          }
        }
        if (idsNeedingFetch.length > 0 && !finalUsePHRCollection) {
          fetchArtefactDetailsAsync(
            idsNeedingFetch.map((id) => ({ id })),
            callbackAuthToken,
          );
        }

        usePHRCollection = finalUsePHRCollection;
      }

      // ======== AUTO-TRIGGER: Fetch health data (only for HIMS consents; PHR app calls fetch itself) ========
      // Only auto-trigger if we have a local ConsentRequest — this prevents triggering data fetch
      // for external/unknown consents that arrive via HIP notify but were initiated elsewhere.
      if (artefactIds.length > 0 && !usePHRCollection) {
        const localConsentRequest = consentRequestId
          ? await ConsentRequestModel.findOne({
              $or: [
                { consentRequestId },
                { consentArtefacts: { $in: artefactIds } },
              ],
            })
              .select("_id")
              .lean()
          : null;

        if (!localConsentRequest) {
          console.log(
            `${LOG_PREFIX} Skipping AUTO-TRIGGER: no local ConsentRequest found for request ${consentRequestId}. Artefact may be from an external consent.`,
          );
        } else {
          const anyInPHR = await PHRConsentArtefactModel.findOne({
            artefactId: { $in: artefactIds },
          });
          if (!anyInPHR) {
            triggerHiuDataFetchAsync(artefactIds);
          } else {
            console.log(
              `${LOG_PREFIX} Skipping AUTO-TRIGGER: At least one artefact exists in PHR collection.`,
            );
          }
        }
      }
    }

    if (status === "REVOKED") {
      // Build a broad query that catches artefacts by consentRequestId AND by artefactId directly.
      // Ghost/self-referencing artefacts (artefactId === consentRequestId) are only reachable by artefactId.
      const revokedAt = notification.timestamp
        ? new Date(notification.timestamp)
        : new Date();

      const broadQuery = buildBroadArtefactQuery(consentRequestId, artefactIds);
      const idsToRevoke = await resolveArtefactIds(broadQuery, artefactIds);

      const result = await ConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.REVOKED, revokedAt },
      });
      const phrResult = await PHRConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.REVOKED, revokedAt },
      });
      if (dbLookupId) {
        await ConsentRequestModel.updateOne(
          {
            $or: [
              { consentRequestId: dbLookupId },
              { consentArtefacts: dbLookupId },
            ],
          },
          { $set: { status: "REVOKED", revokedAt } },
        );
      }
      // Delete external health records for ALL resolved artefacts
      if (idsToRevoke.length > 0) {
        const deleteResult = await ExternalHealthRecordModel.deleteMany({
          consentArtefactId: { $in: idsToRevoke },
        });
        console.log(
          `${LOG_PREFIX} Revoked artefacts (main: ${result.modifiedCount}, PHR: ${phrResult.modifiedCount}); removed ${deleteResult.deletedCount} external health records for ${idsToRevoke.length} artefact(s)`,
        );
      } else {
        console.log(
          `${LOG_PREFIX} Revoked artefacts (main: ${result.modifiedCount}, PHR: ${phrResult.modifiedCount})`,
        );
      }
    }

    if (status === "EXPIRED") {
      const broadQuery = buildBroadArtefactQuery(consentRequestId, artefactIds);
      const idsToExpire = await resolveArtefactIds(broadQuery, artefactIds);

      await ConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.EXPIRED },
      });
      await PHRConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.EXPIRED },
      });
      if (idsToExpire.length > 0) {
        const expiredResult = await ExternalHealthRecordModel.deleteMany({
          consentArtefactId: { $in: idsToExpire },
        });
        console.log(
          `${LOG_PREFIX} Expired artefacts; removed ${expiredResult.deletedCount} external health records for ${idsToExpire.length} artefact(s)`,
        );
      }
    }

    if (status === "DENIED") {
      const deniedAt = notification.timestamp
        ? new Date(notification.timestamp)
        : new Date();

      const broadQuery = buildBroadArtefactQuery(consentRequestId, artefactIds);
      const idsToDeny = await resolveArtefactIds(broadQuery, artefactIds);

      await ConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.DENIED, deniedAt },
      });
      await PHRConsentArtefactModel.updateMany(broadQuery, {
        $set: { status: ConsentArtefactStatus.DENIED, deniedAt },
      });
      if (idsToDeny.length > 0) {
        const deleteResult = await ExternalHealthRecordModel.deleteMany({
          consentArtefactId: { $in: idsToDeny },
        });
        if (deleteResult.deletedCount > 0) {
          console.log(
            `${LOG_PREFIX} DENIED: removed ${deleteResult.deletedCount} external health records for ${idsToDeny.length} artefact(s)`,
          );
        }
      }
      if (dbLookupId) {
        await ConsentRequestModel.updateOne(
          {
            $or: [
              { consentRequestId: dbLookupId },
              { consentArtefacts: dbLookupId },
            ],
          },
          { $set: { status: "DENIED", deniedAt } },
        );
      }
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
export const triggerHiuDataFetchAsync = (artefactIds: string[]): void => {
  if (!artefactIds || artefactIds.length === 0) return;

  // Import models for deduplication and date range lookup
  const { HIURequestModel } = require("../models/HIURequest");

  // Run async without blocking
  (async () => {
    for (const artefactId of artefactIds) {
      try {
        // DEDUPLICATION: Check if we already have a request for this artefact
        // We check for ANY request in the last 1 HOUR to prevent rapid loops
        // OR any successfully TRANSFERRED request ever (don't re-fetch if we have data)
        const recentOrSuccessfulRequest = await HIURequestModel.findOne({
          consentArtefactId: artefactId,
          $or: [
            {
              // Recent active request (last 1 hour)
              createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) },
              status: { $ne: "FAILED" },
            },
            {
              // OR any successful transfer ever
              status: "TRANSFERRED",
            },
          ],
        });

        if (recentOrSuccessfulRequest) {
          if (recentOrSuccessfulRequest.storeAsExternalRecord !== true) {
            console.log(
              `${LOG_PREFIX} [AUTO-TRIGGER] Previous request ${recentOrSuccessfulRequest.requestId} didn't have storeAsExternalRecord=true. Allowing re-fetch for ${artefactId}.`,
            );
          } else {
            console.log(
              `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - valid request exists (requestId: ${recentOrSuccessfulRequest.requestId}, status: ${recentOrSuccessfulRequest.status})`,
            );
            continue;
          }
        }

        // This prevents PHR consents from triggering HIMS data fetch
        let artefact = await PHRConsentArtefactModel.findOne({ artefactId });
        if (artefact) {
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Artefact ${artefactId} found in PHR collection. Skipping AUTO-TRIGGER (PHR consents don't use AUTO-TRIGGER).`,
          );
          continue;
        }

        artefact = await ConsentArtefactModel.findOne({ artefactId });
        if (!artefact) {
          console.warn(
            `${LOG_PREFIX} [AUTO-TRIGGER] Artefact ${artefactId} not found in either collection. Skipping.`,
          );
          continue;
        }

        if (artefact.status !== ConsentArtefactStatus.GRANTED) {
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - Status is ${artefact.status} (not GRANTED)`,
          );
          continue;
        }

        const now = new Date();
        const expiryDate =
          artefact.expiryDate || artefact.permission?.dataEraseAt;
        if (expiryDate && new Date(expiryDate) < now) {
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - Consent has expired (expiry: ${new Date(expiryDate).toISOString()})`,
          );
          // Update status to EXPIRED if we just found out
          if (artefact.status === ConsentArtefactStatus.GRANTED) {
            await ConsentArtefactModel.updateOne(
              { artefactId },
              { $set: { status: ConsentArtefactStatus.EXPIRED } },
            );
          }
          continue;
        }

        const purposeCode = artefact.rawConsentDetail?.purpose?.code;
        const isPHRPull = purposeCode === "PATRQT";

        if (isPHRPull) {
          console.log(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - PHR pull record (purpose.code=PATRQT). PHR consents don't use AUTO-TRIGGER.`,
          );
          continue;
        }

        // Skip self-referencing ghost artefacts (artefactId === consentRequestId)
        // AND unlinked artefacts (consentRequestId is null/empty — no known consent request).
        // These were created without a real consent request and will cause an
        // infinite fetch loop (fetch → new ghost artefact → fetch → …).
        if (artefact.artefactId === artefact.consentRequestId) {
          console.warn(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - Self-referencing ghost artefact (artefactId === consentRequestId). No real consent request.`,
          );
          continue;
        }
        if (!artefact.consentRequestId) {
          console.warn(
            `${LOG_PREFIX} [AUTO-TRIGGER] Skipping ${artefactId} - Unlinked artefact (consentRequestId is null). No real consent request.`,
          );
          continue;
        }

        const isHIMS = true; // If not PHR, it's HIMS

        console.log(
          `${LOG_PREFIX} [AUTO-TRIGGER] Artefact ${artefactId} is HIMS (purpose.code=${purposeCode || "not PATRQT"}). Proceeding with AUTO-TRIGGER.`,
        );

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
          `${LOG_PREFIX} [AUTO-TRIGGER] Initiating HIU data fetch for artefact: ${artefactId} (HIMS: ${isHIMS})`,
        );

        const result = await HiuService.requestHealthInformation(
          artefactId,
          dateRange,
          { storeAsExternalRecord: isHIMS }, // Only store for HIMS consents, not PHR
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
 * Must never create a stub with artefactId === consentRequestId (request id is not an artefact id).
 */
const createArtefactStub = async (
  artefactId: string,
  consentRequestId: string,
  usePHRCollection?: boolean,
): Promise<void> => {
  // PHR consents are legitimately self-referencing (no local ConsentRequest).
  // Only reject self-ref stubs for the main collection.
  if (!usePHRCollection && (!artefactId || artefactId === consentRequestId)) {
    console.warn(
      `${LOG_PREFIX} Skipping stub creation: artefactId must not equal consentRequestId (${artefactId})`,
    );
    return;
  }
  try {
    const consentReq = await ConsentRequestModel.findOne({ consentRequestId });
    const ArtefactModel = usePHRCollection
      ? PHRConsentArtefactModel
      : ConsentArtefactModel;

    await ArtefactModel.findOneAndUpdate(
      { artefactId },
      {
        $setOnInsert: {
          artefactId,
          consentRequestId,
          status: ConsentArtefactStatus.GRANTED,
          patientAbhaAddress: consentReq?.patientAbhaId || "",
          hipId: facilityId,
          hiuId: consentReq?.hiuId || "",
          hiTypes: consentReq?.hiTypes || [],
          ...(consentReq?.requestPurpose && {
            requestPurpose: consentReq.requestPurpose,
          }),
          permission: (() => {
            const p = consentReq?.permission;
            if (p?.dateRange?.from != null && p?.dateRange?.to != null) {
              return {
                ...p,
                dateRange: {
                  from: new Date(p.dateRange.from),
                  to: new Date(p.dateRange.to),
                },
                dataEraseAt: p.dataEraseAt
                  ? new Date(p.dataEraseAt)
                  : new Date(),
              };
            }
            const now = new Date();
            return {
              accessMode: "VIEW",
              dateRange: { from: now, to: now },
              dataEraseAt: now,
              frequency: { unit: "HOUR", value: 0, repeats: 0 },
            };
          })(),
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

    // When fetching consent artefacts, we act as HIU (Health Information User)
    // So we should use X-HIU-ID header instead of X-HIP-ID
    const headers: any = {
      "Content-Type": "application/json",
      "REQUEST-ID": requestId,
      TIMESTAMP: new Date().toISOString(),
      "X-CM-ID": X_CM_ID,
      Authorization: abdmToken,
    };
    // Use X-HIU-ID if available, otherwise fallback to X-HIP-ID
    if (X_HIU_ID) {
      headers["X-HIU-ID"] = X_HIU_ID;
    } else {
      headers["X-HIP-ID"] = facilityId;
    }

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}${ENDPOINTS.CONSENT_FETCH}`,
      payload,
      { headers },
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
    const errorDetails = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
    };
    console.error(
      `${LOG_PREFIX} Failed to fetch artefact ${artefactId}:`,
      JSON.stringify(errorDetails, null, 2),
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
  usePHRCollection?: boolean,
  eventTimestamp?: Date,
): Promise<IConsentArtefact | null> => {
  try {
    const artefactId = consentDetail.consentId || consentDetail.id;
    const detailRequestId = consentDetail.consentRequestId || consentRequestId;

    if (!artefactId) {
      console.error(`${LOG_PREFIX} No artefact ID in consent detail`);
      return null;
    }

    const purposeCode = consentDetail.purpose?.code;
    if (purposeCode === "PATRQT") {
      usePHRCollection = true;
      console.log(
        `${LOG_PREFIX} Overriding collection decision: purpose.code=PATRQT detected. Using PHR collection for artefact ${artefactId}.`,
      );
    } else if (purposeCode && usePHRCollection) {
      // If purpose.code is NOT PATRQT but usePHRCollection is true, log warning
      console.warn(
        `${LOG_PREFIX} Warning: usePHRCollection=true but purpose.code=${purposeCode} (not PATRQT). This might be incorrect.`,
      );
    }

    // Never store when we only have a request id and no real consent payload.
    // When ABDM sends single-artefact grant, consentId can equal request id but we get full consentDetail
    // (careContexts, permission, etc.) — in that case do store so HIP/HIU flow can find the artefact.
    const hasRealConsentPayload =
      consentDetail.careContexts?.length > 0 || consentDetail.permission;
    if (
      detailRequestId &&
      artefactId === detailRequestId &&
      !hasRealConsentPayload
    ) {
      console.warn(
        `${LOG_PREFIX} Rejecting store: consentId equals consentRequestId (${artefactId}) and no consent payload. Not storing.`,
      );
      return null;
    }

    // Resolve the consentRequestId to link this artefact to.
    // For PHR consents (usePHRCollection=true), self-referencing is EXPECTED and CORRECT —
    // they're initiated by the patient's PHR app, so no local ConsentRequest exists.
    // Only resolve for the MAIN collection where self-referencing breaks REVOKE/DENY cascading.
    let resolvedConsentRequestId = consentRequestId;
    if (usePHRCollection) {
      // PHR consents: keep self-referencing consentRequestId as-is
      resolvedConsentRequestId = detailRequestId || artefactId;
      console.log(
        `${LOG_PREFIX} PHR consent: keeping consentRequestId=${resolvedConsentRequestId} (self-ref is expected for patient-initiated consents).`,
      );
    } else if (
      !resolvedConsentRequestId ||
      resolvedConsentRequestId === artefactId
    ) {
      const patientAbha = consentDetail.patient?.id;
      if (patientAbha) {
        const originalReq = await ConsentRequestModel.findOne({
          patientAbhaId: patientAbha,
          status: { $in: ["GRANTED", "REQUESTED", "APPROVED"] },
        })
          .sort({ createdAt: -1 })
          .select("consentRequestId")
          .lean();
        if (originalReq?.consentRequestId) {
          resolvedConsentRequestId = originalReq.consentRequestId;
          console.log(
            `${LOG_PREFIX} Resolved consentRequestId from patient ${patientAbha}: ${resolvedConsentRequestId} (was self-ref ${artefactId})`,
          );
        } else {
          // No matching consent request found — do NOT self-reference.
          // Store with null consentRequestId; broadQuery ($or by artefactId) still catches it for REVOKE.
          resolvedConsentRequestId = undefined;
          console.warn(
            `${LOG_PREFIX} No ConsentRequest found for patient ${patientAbha}. Setting consentRequestId to null (refusing self-ref).`,
          );
        }
      } else {
        resolvedConsentRequestId = undefined;
      }
    }

    const updateData: any = {
      artefactId,
      consentRequestId: resolvedConsentRequestId,
      lastFetchedAt: new Date(),
      rawConsentDetail: consentDetail,
      grantedAt: eventTimestamp || new Date(),
    };

    const consentReq = detailRequestId
      ? await ConsentRequestModel.findOne({ consentRequestId: detailRequestId })
          .select("requestPurpose")
          .lean()
      : null;
    if (consentReq?.requestPurpose) {
      updateData.requestPurpose = consentReq.requestPurpose;
    }

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

    // Extract care contexts - support multiple shapes (careContextReference, reference) and MERGE with existing
    // so we never lose care contexts (ABDM may send in batches or we may get multiple callbacks).
    const normalizeCareContext = (
      cc: any,
    ): { patientReference: string; careContextReference: string } | null => {
      const careContextRef =
        cc.careContextReference ??
        cc.reference ??
        cc.careContextReferenceNumber;
      const patientRef =
        cc.patientReference ?? cc.patientId ?? cc.patient?.id ?? "";
      if (!careContextRef || typeof careContextRef !== "string") return null;
      return {
        patientReference: patientRef || "",
        careContextReference: String(careContextRef).trim(),
      };
    };

    const incomingCareContexts: Array<{
      patientReference: string;
      careContextReference: string;
    }> = [];
    if (
      consentDetail.careContexts &&
      Array.isArray(consentDetail.careContexts)
    ) {
      console.log(
        `${LOG_PREFIX} Found ${consentDetail.careContexts.length} care contexts in consentDetail.careContexts`,
      );
      consentDetail.careContexts.forEach((cc: any) => {
        const normalized = normalizeCareContext(cc);
        if (normalized) {
          incomingCareContexts.push(normalized);
        } else {
          console.warn(
            `${LOG_PREFIX} Failed to normalize care context:`,
            JSON.stringify(cc),
          );
        }
      });
    }
    // Also check nested consentDetail (e.g. consentDetail.consentDetail.careContexts)
    const nested = consentDetail.consentDetail?.careContexts;
    if (nested && Array.isArray(nested)) {
      console.log(
        `${LOG_PREFIX} Found ${nested.length} care contexts in nested consentDetail.consentDetail.careContexts`,
      );
      nested.forEach((cc: any) => {
        const normalized = normalizeCareContext(cc);
        if (normalized) {
          incomingCareContexts.push(normalized);
        } else {
          console.warn(
            `${LOG_PREFIX} Failed to normalize nested care context:`,
            JSON.stringify(cc),
          );
        }
      });
    }

    console.log(
      `${LOG_PREFIX} Total normalized incoming care contexts: ${incomingCareContexts.length}`,
    );
    if (incomingCareContexts.length > 0) {
      console.log(
        `${LOG_PREFIX} Incoming care contexts:`,
        JSON.stringify(incomingCareContexts),
      );
    } else {
      console.warn(
        `${LOG_PREFIX} ⚠️ No care contexts extracted from consent detail for artefact ${artefactId}`,
      );
      console.warn(
        `${LOG_PREFIX} Raw consentDetail structure:`,
        JSON.stringify({
          hasCareContexts: !!consentDetail.careContexts,
          careContextsType: Array.isArray(consentDetail.careContexts)
            ? "array"
            : typeof consentDetail.careContexts,
          careContextsLength: Array.isArray(consentDetail.careContexts)
            ? consentDetail.careContexts.length
            : "N/A",
          hasNested: !!consentDetail.consentDetail?.careContexts,
          nestedType: Array.isArray(consentDetail.consentDetail?.careContexts)
            ? "array"
            : typeof consentDetail.consentDetail?.careContexts,
        }),
      );
    }

    if (incomingCareContexts.length > 0) {
      const ArtefactModelForMerge = usePHRCollection
        ? PHRConsentArtefactModel
        : ConsentArtefactModel;
      const existing = await ArtefactModelForMerge.findOne(
        { artefactId },
        { careContexts: 1 },
      ).lean();
      const existingList = existing?.careContexts || [];
      const byRef = new Map<
        string,
        { patientReference: string; careContextReference: string }
      >();
      existingList.forEach((ec: any) => {
        const ref = ec.careContextReference?.trim();
        if (ref)
          byRef.set(ref, {
            patientReference: ec.patientReference || "",
            careContextReference: ref,
          });
      });
      incomingCareContexts.forEach((ic) => {
        if (ic.careContextReference) byRef.set(ic.careContextReference, ic);
      });
      updateData.careContexts = Array.from(byRef.values());
    }

    // Extract hiTypes
    if (consentDetail.hiTypes) {
      updateData.hiTypes = consentDetail.hiTypes;
    }

    // Extract permission (ABDM: dateRange = consented period for health info access)
    if (consentDetail.permission) {
      const perm = consentDetail.permission;
      const fromVal = perm.dateRange?.from;
      const toVal = perm.dateRange?.to;
      const dataEraseVal = perm.dataEraseAt;
      // Prefer ABDM dateRange when both from and to are present; else fallback so HIU date clamping still works
      let dateRange: { from: Date; to: Date };
      if (fromVal != null && toVal != null) {
        dateRange = { from: new Date(fromVal), to: new Date(toVal) };
      } else {
        const now = new Date();
        const erase =
          dataEraseVal != null
            ? new Date(dataEraseVal)
            : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        dateRange = { from: now, to: erase };
      }

      updateData.permission = {
        accessMode: perm.accessMode || "VIEW",
        dateRange,
        dataEraseAt: dataEraseVal != null ? new Date(dataEraseVal) : new Date(),
        frequency: perm.frequency || {
          unit: "HOUR",
          value: 0,
          repeats: 0,
        },
      };

      // Set expiry date from dataEraseAt or permission end date
      updateData.expiryDate =
        dataEraseVal != null
          ? new Date(dataEraseVal)
          : toVal != null
            ? new Date(toVal)
            : dateRange.to;
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

    const ArtefactModel = usePHRCollection
      ? PHRConsentArtefactModel
      : ConsentArtefactModel;

    // FINAL GUARD: Never persist self-referencing consentRequestId for MAIN collection.
    // PHR consents (usePHRCollection=true) are legitimately self-referencing — skip this guard.
    if (
      !usePHRCollection &&
      updateData.consentRequestId &&
      updateData.consentRequestId === artefactId
    ) {
      console.warn(
        `${LOG_PREFIX} [GUARD] Caught self-referencing consentRequestId=${artefactId} before upsert. Setting to null.`,
      );
      updateData.consentRequestId = null;
    }

    const artefact = await ArtefactModel.findOneAndUpdate(
      { artefactId },
      { $set: updateData },
      { upsert: true, new: true },
    );

    console.log(
      `${LOG_PREFIX} Stored artefact details for ${artefactId}, careContexts: ${updateData.careContexts?.length || 0}${usePHRCollection ? " (PHR)" : ""}`,
    );

    // Keep ConsentRequest in sync for list UI (grantedAt, consentExpiryOn)
    const reqId = consentRequestId || artefact?.consentRequestId;
    if (reqId && artefact) {
      const crUpdate: any = {};
      if (artefact.grantedAt) crUpdate.grantedAt = artefact.grantedAt;
      if (artefact.expiryDate) crUpdate.consentExpiryOn = artefact.expiryDate;
      if (artefact.hiTypes) crUpdate.approvedHiTypes = artefact.hiTypes;
      if (
        artefact.permission &&
        artefact.permission.dateRange &&
        artefact.permission.dateRange.from &&
        artefact.permission.dateRange.to
      ) {
        crUpdate.approvedDateRange = {
          from: artefact.permission.dateRange.from,
          to: artefact.permission.dateRange.to,
        };
      }

      // Populate consolidated `approved` object
      const approved: any = {};
      if (
        artefact.permission?.dateRange?.from &&
        artefact.permission?.dateRange?.to
      ) {
        approved.dateRange = {
          from: artefact.permission.dateRange.from,
          to: artefact.permission.dateRange.to,
        };
      }
      if (artefact.hiTypes && artefact.hiTypes.length > 0) {
        approved.hiTypes = artefact.hiTypes;
      }
      if (artefact.permission?.accessMode) {
        approved.accessMode = artefact.permission.accessMode;
      }
      if (artefact.permission?.dataEraseAt) {
        approved.dataEraseAt = artefact.permission.dataEraseAt;
      }
      if (artefact.expiryDate) {
        approved.expiryDate = artefact.expiryDate;
      }
      if (Object.keys(approved).length > 0) {
        crUpdate.approved = approved;
      }

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
    let artefact = await ConsentArtefactModel.findOne({
      artefactId: consentId,
    });
    if (!artefact) {
      artefact = await PHRConsentArtefactModel.findOne({
        artefactId: consentId,
      });
    }

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

      // Auto-update status to EXPIRED in both collections
      await ConsentArtefactModel.updateOne(
        { artefactId: consentId },
        { $set: { status: ConsentArtefactStatus.EXPIRED } },
      );
      await PHRConsentArtefactModel.updateOne(
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
  /** HIMS = for our hospital to fetch and hold in external records; PHR = for patient's PHR (pull records). Default HIMS. */
  requestPurpose?: "HIMS" | "PHR";
  /** Complete patient data payload from ABHA profile search API */
  patientData?: any;
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

  // --- Validate & Clamp dataEraseAt BEFORE building the ABDM payload ---
  // so ABDM and our DB always have the same dates.
  const MAX_EXPIRY_YEARS = 5;
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + MAX_EXPIRY_YEARS);

  let finalDataEraseAt = new Date(params.dataEraseAt);
  if (isNaN(finalDataEraseAt.getTime())) {
    finalDataEraseAt = maxDate; // default to max if unparseable
  } else if (finalDataEraseAt > maxDate) {
    console.warn(
      `${LOG_PREFIX} Requested dataEraseAt (${finalDataEraseAt.toISOString()}) exceeds ${MAX_EXPIRY_YEARS} years. Clamping to ${maxDate.toISOString()}.`,
    );
    finalDataEraseAt = maxDate;
  }

  // Normalize date strings to full ISO 8601 datetime (ABDM requires time component)
  const toISODateTime = (v: string): string => {
    const d = new Date(v);
    if (isNaN(d.getTime())) throw new Error(`Invalid date value: ${v}`);
    return d.toISOString();
  };
  const isoDateFrom = toISODateTime(params.dateFrom);
  const isoDateTo = toISODateTime(params.dateTo);
  const isoDataEraseAt = finalDataEraseAt.toISOString();

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
          from: isoDateFrom,
          to: isoDateTo,
        },
        dataEraseAt: isoDataEraseAt,
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

  // Sync Patient Profile Data
  if (params.patientData) {
    try {
      const data = params.patientData;
      const cleanAbhaNumber = data.healthIdNumber
        ? data.healthIdNumber.replace(/-/g, "")
        : undefined;
      const formattedAbhaNumber =
        cleanAbhaNumber && cleanAbhaNumber.length === 14
          ? `${cleanAbhaNumber.slice(0, 2)}-${cleanAbhaNumber.slice(2, 6)}-${cleanAbhaNumber.slice(6, 10)}-${cleanAbhaNumber.slice(10, 14)}`
          : undefined;

      const filter = [];
      if (formattedAbhaNumber) filter.push({ ABHANumber: formattedAbhaNumber });
      if (cleanAbhaNumber) filter.push({ ABHANumber: cleanAbhaNumber });
      if (data.abhaAddress) filter.push({ abhaaddress: data.abhaAddress });
      if (params.abhaId)
        filter.push({ abhaaddress: params.abhaId }, { uhid: params.abhaId });

      let patientName = data.fullName;
      let f_name = patientName;
      let l_name = "";
      if (patientName && patientName.includes(" ")) {
        const parts = patientName.split(" ");
        l_name = parts.pop() || "";
        f_name = parts.join(" ");
      }

      if (filter.length > 0) {
        let existingPatient = await PatientModel.findOne({
          $or: filter,
          isMerged: { $ne: true },
          status: { $ne: "merged" },
        });

        let updatePayload: any = {};
        if (data.fullName) updatePayload.name = data.fullName;
        if (f_name) updatePayload.f_name = f_name;
        if (l_name) updatePayload.l_name = l_name;
        if (data.mobile) updatePayload.mobile = data.mobile;
        if (formattedAbhaNumber) updatePayload.ABHANumber = formattedAbhaNumber;
        if (data.abhaAddress) updatePayload.abhaaddress = data.abhaAddress;
        if (data.status) updatePayload.status = data.status;

        if (existingPatient) {
          await PatientModel.updateOne(
            { _id: existingPatient._id },
            { $set: updatePayload },
          );
          console.log(
            `${LOG_PREFIX} Updated existing patient profile for ABHA ID: ${params.abhaId}`,
          );
        } else {
          await PatientModel.create({
            ...updatePayload,
            gender: "Unknown", // Default as ABDM profile may not provide this in this step
          });
          console.log(
            `${LOG_PREFIX} Created new patient profile for ABHA ID: ${params.abhaId}`,
          );
        }
      }
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Error syncing patient data:`, err.message);
    }
  }

  const response = await axios.post(
    `${process.env.ABDM_BASE_URL}${ENDPOINTS.REQ_INIT}`,
    payload,
    {
      headers: {
        "Content-Type": "application/json",
        "REQUEST-ID": requestId,
        TIMESTAMP: new Date().toISOString(),
        "X-CM-ID": X_CM_ID,
        ...(X_HIU_ID ? { "X-HIU-ID": X_HIU_ID } : { "X-HIP-ID": facilityId }),
        Authorization: abdmToken,
      },
    },
  );

  console.log(`${LOG_PREFIX} Consent init response: status=${response.status}`);

  // Save the consent request to DB
  const patientDetails = await lookupPatientDetails(params.abhaId);

  // Merge provided patientData with lookup Details for ConsentRequest
  let finalPatientDetails: Record<string, any> = { ...patientDetails };
  let authMethods: string[] | undefined = undefined;

  if (params.patientData) {
    if (params.patientData.fullName)
      finalPatientDetails.patientName = params.patientData.fullName;
    if (params.patientData.healthIdNumber)
      finalPatientDetails.abhaNumber = params.patientData.healthIdNumber;
    if (params.patientData.abhaAddress)
      finalPatientDetails.abhaAddress = params.patientData.abhaAddress;
    if (params.patientData.mobile)
      finalPatientDetails.mobile = params.patientData.mobile;
    if (params.patientData.authMethods)
      authMethods = params.patientData.authMethods;
  }
  // finalDataEraseAt, isoDateFrom, isoDateTo are already computed above (before API call)

  await ConsentRequestModel.create({
    requestId,
    consentRequestId: requestId,
    status: "INITIATED",
    patientAbhaId: params.abhaId,
    ...finalPatientDetails,
    authMethods,
    facilityName,
    hiuId: params.hiuId,
    requestPurpose: params.requestPurpose || "HIMS",
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
        from: new Date(isoDateFrom),
        to: new Date(isoDateTo),
      },
      dataEraseAt: finalDataEraseAt,
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
        { ABHANumber: formattedInput },
        { ABHANumber: cleanInput },
        { abhaaddress: abhaId },
        { uhid: abhaId },
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
        ...(X_HIU_ID ? { "X-HIU-ID": X_HIU_ID } : { "X-HIP-ID": facilityId }),
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
  triggerHiuDataFetchAsync,
};

export default ConsentService;
