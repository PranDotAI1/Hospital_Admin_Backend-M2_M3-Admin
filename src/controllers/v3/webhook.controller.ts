import { ConsentRequestModel } from "../../models/ConsentRequest";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
} from "../../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../../models/PHRConsentArtefact";
import { ExternalHealthRecordModel } from "../../models/ExternalHealthRecord";
import { ConsentService } from "../../services/consent.service";
import { generateUID } from "../../utils/constant";
import { AbdmLogger } from "../../utils/abdm.logger";

const LOG_PREFIX = "[CONSENT_WEBHOOK]";

export const handleConsentOnInit = async (req: any, res: any) => {
  try {
    const postData = req.body;
    AbdmLogger.logPayloadDebug(`${LOG_PREFIX} on-init callback received:`, postData);

    // Handle error case
    if (postData.error) {
      AbdmLogger.logPayloadDebug(`${LOG_PREFIX} Consent init error from ABDM:`, postData.error);

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
      if (updateResult.matchedCount === 0) {
        // Race condition: ABDM's on-init callback arrived before the DB write
        // for the consent request completed. Retry asynchronously after a short delay.
        // We respond to ABDM immediately to prevent timeout.
        console.warn(
          `${LOG_PREFIX} No consent request found with requestId=${postData.response.requestId}. Will retry in background...`,
        );
        const retryRequestId = postData.response.requestId;
        const retryConsentRequestId = postData.consentRequest.id;
        setTimeout(async () => {
          try {
            const retryResult = await ConsentRequestModel.updateOne(
              { requestId: retryRequestId },
              {
                $set: {
                  consentRequestId: retryConsentRequestId,
                  status: "REQUESTED",
                },
              },
            );
            if (retryResult.matchedCount === 0) {
              console.error(
                `${LOG_PREFIX} Retry failed: still no consent request found with requestId=${retryRequestId}. Request may be stuck in INITIATED.`,
              );
            } else {
              console.log(
                `${LOG_PREFIX} Retry succeeded: updated consent request with requestId=${retryRequestId}`,
              );
            }
          } catch (err: any) {
            console.error(`${LOG_PREFIX} Retry error for requestId=${retryRequestId}:`, err.message);
          }
        }, 2000);
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

    AbdmLogger.logPayloadDebug(`${LOG_PREFIX} HIP notify callback on ${route}:`, postData);

    const notification = postData.notification;
    if (!notification) {
      console.error(`${LOG_PREFIX} HIP notify missing notification object`);
      return res.status(400).json({ error: "Missing notification object" });
    }

    // Respond immediately -- processing happens in BullMQ worker
    res.status(200).json({ status: "success" });

    const callbackAuth =
      req.headers["authorization"] || req.headers["Authorization"];

    // Try BullMQ queue first; fall back to direct processing if Redis is down
    try {
      const { enqueueConsentNotify } = await import(
        "../../services/abdm.webhook.queue"
      );
      const jobId = await enqueueConsentNotify({
        notification,
        requestId,
        callbackAuth,
      });
      if (jobId) {
        return;
      }
    } catch (queueErr: any) {
      console.warn(
        `${LOG_PREFIX} BullMQ unavailable (${queueErr.message}), falling back to direct processing`,
      );
    }

    // Fallback: process directly
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
    if (body.error) {
      console.error(
        `${LOG_PREFIX} Consent fetch error from ABDM: code=${body.error?.code}, message=${body.error?.message}`,
      );
      return res.status(200).json({ status: "Error handled" });
    }

    // Respond immediately — processing in BullMQ worker
    res.status(200).json({ status: "success" });

    // Try BullMQ queue first
    try {
      const { enqueueConsentOnFetch } = await import(
        "../../services/abdm.webhook.queue"
      );
      const jobId = await enqueueConsentOnFetch({
        body,
        paramRequestId,
      });
      if (jobId) {
        return;
      }
    } catch (queueErr: any) {
      console.warn(
        `${LOG_PREFIX} BullMQ unavailable (${queueErr.message}), falling back to direct processing`,
      );
    }

    // Fallback: process directly using shared function
    try {
      const { processConsentOnFetchCallback } = await import(
        "../../services/consent.service"
      );
      await processConsentOnFetchCallback(body, paramRequestId);
    } catch (fallbackErr: any) {
      console.error(
        `${LOG_PREFIX} Fallback processing failed:`,
        fallbackErr.message,
      );
    }
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in handleConsentOnFetch:`,
      error.message,
    );
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
};

export const handleConsentOnStatus = async (req: any, res: any) => {
  try {
    const body = req.body;
    AbdmLogger.logPayloadDebug(`${LOG_PREFIX} on-status callback received:`, body);

    if (body.error) {
      console.error(
        `${LOG_PREFIX} Consent status error from ABDM: code=${body.error?.code}, message=${body.error?.message}`,
      );
      return res.status(200).json({ status: "Error handled" });
    }

    // Respond immediately — processing in BullMQ worker
    res.status(200).json({ status: "success" });

    // Try BullMQ queue first
    try {
      const { enqueueConsentOnStatus } = await import(
        "../../services/abdm.webhook.queue"
      );
      const jobId = await enqueueConsentOnStatus({ body });
      if (jobId) {
        return;
      }
    } catch (queueErr: any) {
      console.warn(
        `${LOG_PREFIX} BullMQ unavailable (${queueErr.message}), falling back to direct processing`,
      );
    }

    // Fallback: process directly (same logic as before)
    if (body.consentRequest?.id) {
      const statusUpdate: any = {
        status: body.consentRequest.status || "UNKNOWN",
        lastCheckedAt: new Date(),
      };

      if (body.consentRequest.status === "GRANTED" && !statusUpdate.grantedAt) {
        statusUpdate.grantedAt = body.timestamp
          ? new Date(body.timestamp)
          : new Date();
      }

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
        const revokedIds = await ConsentArtefactModel.distinct("artefactId", broadQuery);
        if (revokedIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({ consentArtefactId: { $in: revokedIds } });
        }
      }

      if (body.consentRequest.status === "EXPIRED") {
        await ConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.EXPIRED },
        });
        await PHRConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.EXPIRED },
        });
        const expiredIds = await ConsentArtefactModel.distinct("artefactId", broadQuery);
        if (expiredIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({ consentArtefactId: { $in: expiredIds } });
        }
      }

      if (body.consentRequest.status === "DENIED") {
        statusUpdate.deniedAt = eventTs;
        await ConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.DENIED, deniedAt: eventTs },
        });
        await PHRConsentArtefactModel.updateMany(broadQuery, {
          $set: { status: ConsentArtefactStatus.DENIED, deniedAt: eventTs },
        });
        const deniedIds = await ConsentArtefactModel.distinct("artefactId", broadQuery);
        if (deniedIds.length > 0) {
          await ExternalHealthRecordModel.deleteMany({ consentArtefactId: { $in: deniedIds } });
        }
      }

      const updateResult = await ConsentRequestModel.updateOne(
        {
          $or: [
            { consentRequestId: body.consentRequest.id },
            { requestId: body.response?.requestId },
          ],
        },
        { $set: statusUpdate },
      );

      if (
        body.consentRequest.status === "GRANTED" &&
        body.consentRequest.consentArtefacts &&
        body.consentRequest.consentArtefacts.length > 0 &&
        updateResult.matchedCount > 0
      ) {
        // AUTO-TRIGGER removed from on-status fallback path.
        // triggerHiuDataFetchAsync is called ONLY from handleHipNotify.
        const artefactIds = body.consentRequest.consentArtefacts.map((a: any) => a.id);
      } else if (
        body.consentRequest.status === "GRANTED" &&
        updateResult.matchedCount === 0
      ) {
        console.warn(
          `${LOG_PREFIX} on-status GRANTED but no local ConsentRequest matched for ${body.consentRequest.id}. Skipping auto-trigger.`,
        );
      }
    }
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in handleConsentOnStatus:`,
      error.message,
    );
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
  }
};
