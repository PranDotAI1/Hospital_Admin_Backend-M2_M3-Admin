import { ConsentRequestModel } from "../../models/ConsentRequest";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
} from "../../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../../models/PHRConsentArtefact";
import { ExternalHealthRecordModel } from "../../models/ExternalHealthRecord";
import { ConsentService } from "../../services/consent.service";
import { generateUID } from "../../utils/constant";

const LOG_PREFIX = "[CONSENT_WEBHOOK]";

export const handleConsentOnInit = async (req: any, res: any) => {
  try {
    const postData = req.body;
    console.log(
      `${LOG_PREFIX} on-init callback received:`,
      JSON.stringify(postData),
    );

    // Handle error case
    if (postData.error) {
      console.error(
        `${LOG_PREFIX} Consent init error from ABDM:`,
        JSON.stringify(postData.error),
      );

      if (postData.response?.requestId) {
        await ConsentRequestModel.updateOne(
          { requestId: postData.response.requestId },
          {
            $set: {
              status: "DENIED",
              error: postData.error,
            },
          },
        );
        console.log(
          `${LOG_PREFIX} Marked consent request ${postData.response.requestId} as DENIED`,
        );
      }

      return res.status(200).json({ status: "Error handled" });
    }

    // Handle success case
    if (postData.consentRequest?.id && postData.response?.requestId) {
      const updateResult = await ConsentRequestModel.updateOne(
        { requestId: postData.response.requestId },
        {
          $set: {
            consentRequestId: postData.consentRequest.id,
            status: "REQUESTED",
          },
        },
      );

      console.log(
        `${LOG_PREFIX} Consent request updated: consentRequestId=${postData.consentRequest.id}, matched=${updateResult.matchedCount}`,
      );

      if (updateResult.matchedCount === 0) {
        console.warn(
          `${LOG_PREFIX} No consent request found with requestId=${postData.response.requestId}. Callback may have arrived before DB write completed.`,
        );
      }
    } else {
      console.warn(
        `${LOG_PREFIX} on-init callback missing consentRequest.id or response.requestId`,
      );
    }

    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    console.error(`${LOG_PREFIX} Error in handleConsentOnInit:`, error.message);
    return res.status(500).json({ error: error.message });
  }
};

export const handleConsentHipNotify = async (req: any, res: any) => {
  try {
    const postData = req.body;
    const requestId =
      req.headers["request-id"] || req.headers["REQUEST-ID"] || generateUID();
    const route = req.originalUrl || req.path;

    console.log(
      `${LOG_PREFIX} HIP notify callback on ${route}:`,
      JSON.stringify(postData),
    );

    const notification = postData.notification;
    if (!notification) {
      console.error(`${LOG_PREFIX} HIP notify missing notification object`);
      return res.status(400).json({ error: "Missing notification object" });
    }

    // Respond immediately -- processing happens below
    res.status(200).json({ status: "success" });

    const callbackAuth =
      req.headers["authorization"] || req.headers["Authorization"];

    // Delegate to ConsentService for full processing + ACK
    await ConsentService.handleHipNotify(notification, requestId, callbackAuth);
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in handleConsentHipNotify:`,
      error.message,
    );
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
};

export const handleConsentOnFetch = async (req: any, res: any) => {
  try {
    const body = req.body;
    const paramRequestId = req.params.requestid || body.response?.requestId;

    console.log(
      `${LOG_PREFIX} on-fetch callback received for request: ${paramRequestId || "unknown"}`,
    );

    if (body.error) {
      console.error(
        `${LOG_PREFIX} Consent fetch error from ABDM:`,
        JSON.stringify(body.error),
      );
      return res.status(200).json({ status: "Error handled" });
    }

    if (body.consent?.consentDetail) {
      const consentDetail = body.consent.consentDetail;
      const consentStatus = body.consent.status || "GRANTED";
      const signature = body.consent.signature;

      // Add signature to the detail for storage
      if (signature) {
        consentDetail.signature = signature;
      }

      const resolvedConsentRequestId =
        consentDetail.consentRequestId || paramRequestId;

      const isPHRPull = consentDetail.purpose?.code === "PATRQT";

      let usePHRCollection = isPHRPull;
      if (!isPHRPull) {
        const consentReq = resolvedConsentRequestId
          ? await ConsentRequestModel.findOne({
              $or: [
                { consentRequestId: resolvedConsentRequestId },
                { requestId: resolvedConsentRequestId },
              ],
            })
              .select("requestPurpose")
              .lean()
          : null;
        usePHRCollection = consentReq?.requestPurpose === "PHR";
      }

      if (isPHRPull) {
        console.log(
          `${LOG_PREFIX} Detected PHR pull record (purpose.code=PATRQT). Using PHR collection.`,
        );
      }

      const artefactId = consentDetail.consentId || body.consent.id;

      const artefact = await ConsentService.storeArtefactDetails(
        consentDetail,
        consentStatus,
        resolvedConsentRequestId,
        usePHRCollection,
      );

      if (artefact) {
        // Also update the ConsentRequest status
        const consentId = consentDetail.consentId || body.consent.id;

        if (consentId) {
          await ConsentRequestModel.updateOne(
            {
              $or: [
                { consentArtefacts: consentId },
                { consentRequestId: consentId },
              ],
            },
            {
              $set: {
                status: consentStatus,
              },
            },
          );
        }

        console.log(
          `${LOG_PREFIX} Artefact details stored for ${artefact.artefactId}`,
        );

        // AUTO-TRIGGER: Fetch health data immediately after the artefact details are stored.
        // Only trigger if artefact is properly linked to a ConsentRequest (not self-referencing/unlinked).
        if (consentStatus === "GRANTED" && !usePHRCollection) {
          if (
            artefact.consentRequestId &&
            artefact.consentRequestId !== artefact.artefactId
          ) {
            console.log(
              `${LOG_PREFIX} [AUTO-TRIGGER] Consent GRANTED, initiating HIU data fetch for ${artefact.artefactId}`,
            );
            ConsentService.triggerHiuDataFetchAsync([artefact.artefactId]);
          } else {
            console.warn(
              `${LOG_PREFIX} [AUTO-TRIGGER] Skipping for ${artefact.artefactId}: artefact has no valid consentRequestId link (self-ref or null). Will not auto-fetch.`,
            );
          }
        }
      }
    } else {
      console.warn(
        `${LOG_PREFIX} on-fetch callback has no consent.consentDetail`,
      );
    }

    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in handleConsentOnFetch:`,
      error.message,
    );
    return res.status(500).json({ error: error.message });
  }
};

export const handleConsentOnStatus = async (req: any, res: any) => {
  try {
    const body = req.body;
    console.log(
      `${LOG_PREFIX} on-status callback received:`,
      JSON.stringify(body),
    );

    if (body.error) {
      console.error(
        `${LOG_PREFIX} Consent status error from ABDM:`,
        JSON.stringify(body.error),
      );
      return res.status(200).json({ status: "Error handled" });
    }

    if (body.consentRequest?.id) {
      const statusUpdate: any = {
        status: body.consentRequest.status || "UNKNOWN",
        lastCheckedAt: new Date(),
      };

      // Capture ABDM-provided event timestamp when consent transitions to GRANTED
      if (body.consentRequest.status === "GRANTED" && !statusUpdate.grantedAt) {
        statusUpdate.grantedAt = body.timestamp
          ? new Date(body.timestamp)
          : new Date();
      }

      // Safety net: handle REVOKED/EXPIRED/DENIED reported via on-status
      // (primary handling is in on-notify; this covers cases where on-notify was missed)
      // Use $or to match both by consentRequestId AND by artefactId (handles self-referencing ghost artefacts)
      const reqId = body.consentRequest.id;
      const eventTs = body.timestamp ? new Date(body.timestamp) : new Date();
      const broadQuery = {
        $or: [{ consentRequestId: reqId }, { artefactId: reqId }],
      };

      if (body.consentRequest.status === "REVOKED") {
        statusUpdate.revokedAt = eventTs;
        await ConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.REVOKED, revokedAt: eventTs },
        });
        await PHRConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.REVOKED, revokedAt: eventTs },
        });
        const revokedIds = await ConsentArtefactModel.distinct(
          "artefactId",
          broadQuery,
        );
        if (revokedIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({
            consentArtefactId: { $in: revokedIds },
          });
        }
        console.log(
          `${LOG_PREFIX} on-status REVOKED safety net: updated artefacts and removed external records for ${reqId}`,
        );
      }

      if (body.consentRequest.status === "EXPIRED") {
        await ConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.EXPIRED },
        });
        await PHRConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.EXPIRED },
        });
        const expiredIds = await ConsentArtefactModel.distinct(
          "artefactId",
          broadQuery,
        );
        if (expiredIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({
            consentArtefactId: { $in: expiredIds },
          });
        }
        console.log(
          `${LOG_PREFIX} on-status EXPIRED safety net: updated artefacts and removed external records for ${reqId}`,
        );
      }

      if (body.consentRequest.status === "DENIED") {
        statusUpdate.deniedAt = eventTs;
        await ConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.DENIED, deniedAt: eventTs },
        });
        await PHRConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.DENIED, deniedAt: eventTs },
        });
        const deniedIds = await ConsentArtefactModel.distinct(
          "artefactId",
          broadQuery,
        );
        if (deniedIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({
            consentArtefactId: { $in: deniedIds },
          });
        }
        console.log(
          `${LOG_PREFIX} on-status DENIED safety net: updated artefacts and cleaned external records for ${reqId}`,
        );
      }

      // Write statusUpdate (with any grantedAt/revokedAt/deniedAt fields) to ConsentRequest
      const updateResult = await ConsentRequestModel.updateOne(
        {
          $or: [
            { consentRequestId: body.consentRequest.id },
            { requestId: body.response?.requestId },
          ],
        },
        { $set: statusUpdate },
      );

      // Auto-trigger for GRANTED on-status: only if a local ConsentRequest exists
      // (prevents triggering data fetch for unknown/external consent IDs)
      if (
        body.consentRequest.status === "GRANTED" &&
        body.consentRequest.consentArtefacts &&
        body.consentRequest.consentArtefacts.length > 0 &&
        updateResult.matchedCount > 0
      ) {
        const artefactIds = body.consentRequest.consentArtefacts.map(
          (a: any) => a.id,
        );
        console.log(
          `${LOG_PREFIX} Consent status is GRANTED via on-status callback (local request matched). Triggering data fetch for artefacts: ${artefactIds.join(", ")}`,
        );
        ConsentService.triggerHiuDataFetchAsync(artefactIds);
      } else if (
        body.consentRequest.status === "GRANTED" &&
        updateResult.matchedCount === 0
      ) {
        console.warn(
          `${LOG_PREFIX} on-status GRANTED but no local ConsentRequest matched for ${body.consentRequest.id}. Skipping auto-trigger to prevent ghost artefacts.`,
        );
      }

      console.log(
        `${LOG_PREFIX} Consent status updated: id=${body.consentRequest.id}, status=${statusUpdate.status}, matched=${updateResult.matchedCount}`,
      );
    } else {
      console.warn(
        `${LOG_PREFIX} on-status callback missing consentRequest.id`,
      );
    }

    return res.status(200).json({ status: "success" });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in handleConsentOnStatus:`,
      error.message,
    );
    return res.status(500).json({ error: error.message });
  }
};
