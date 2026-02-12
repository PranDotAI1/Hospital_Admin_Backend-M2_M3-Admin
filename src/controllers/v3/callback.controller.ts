import { ConsentService } from "../../services/consent.service";

const LOG_PREFIX = "[CONSENT_CALLBACK]";

export const getConsentRequestStatus = async (req: any, res: any) => {
  try {
    console.log(`${LOG_PREFIX} getConsentRequestStatus: request received`, req.body);
    const input = req.body;

    const consentReqId = input.consentRequest?.id || input.consentRequestId;
    if (!consentReqId) {
      return res.status(400).json({
        status: "error",
        message: "Missing consent request ID. Provide consentRequest.id or consentRequestId.",
      });
    }

    console.log(`${LOG_PREFIX} Checking status for consent: ${consentReqId}`);

    const result = await ConsentService.checkConsentStatus(consentReqId);

    return res.status(200).json({
      status: "success",
      message: "Consent status check initiated",
      data: result.data,
    });
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Error in getConsentRequestStatus:`,
      error.response?.data || error.message,
    );
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res.status(503).json({ error: "Service unavailable" });
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
};
