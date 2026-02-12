import { ConsentRequestModel } from "../../models/ConsentRequest";
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
    const paramRequestId = req.params.requestid;

    console.log(
      `${LOG_PREFIX} on-fetch callback received for request: ${paramRequestId}`,
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
      const artefact = await ConsentService.storeArtefactDetails(
        consentDetail,
        consentStatus,
        resolvedConsentRequestId,
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

      const updateResult = await ConsentRequestModel.updateOne(
        {
          $or: [
            { consentRequestId: body.consentRequest.id },
            { requestId: body.response?.requestId },
          ],
        },
        { $set: statusUpdate },
      );

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
