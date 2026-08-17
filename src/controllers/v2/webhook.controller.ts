import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { STATUS_CODE, facilityId, generateUID } from "../../utils/constant";
import { MSG } from "../../utils/msgs";
import { HealthInformationRequestSchema } from "../../schemas/abdm.webhook.schemas";
import { AbdmLogger } from "../../utils/abdm.logger";
export const linkTokenGeneration = async (req: any, res: any) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    let postData = req.body;
    AbdmLogger.logPayloadDebug("[LINK_TOKEN] Request:", postData);

    const latestRecord = await HealthRecordModel.findOne({
      hid_address: postData.abhaAddress,
    })
      .sort({ updatedAt: -1 })
      .limit(1);

    if (latestRecord) {
      await HealthRecordModel.updateOne(
        { _id: latestRecord._id },
        {
          $set: {
            "version_m2.token_link": postData.linkToken,
            "version_m2.last_request_id": postData.response.requestId,
            "version_m2.updatedAt": new Date(),
          },
        },
      );
    } else {
    }

    await carecontext(req, res, postData.linkToken, latestRecord);
  } catch (error: any) {
    console.error("[LINK_TOKEN] Error:", error.message);
    if (error.response) {
    } else if (error.request) {
      return res.status(503).json({ error: "Service unavailable" });
    } else {
      return res.status(500).json({ error: error.message });
    }
  }
};

export const carecontext = async (
  req: any,
  res: any,
  linkToken: any,
  latestRecord: any,
) => {
  try {
    let postData = {
      abhaNumber: latestRecord.hidn_number,
      abhaAddress: latestRecord.hid_address,
      patient: [
        {
          referenceNumber: latestRecord.hid_address,
          display: latestRecord.abha_details.name,
          careContexts: [
            {
              referenceNumber: latestRecord.hidn_number,
              display: latestRecord.abha_details.name,
            },
          ],
          hiType: "Prescription",
          count: 1,
        },
      ],
    };

    let random32String = generateUID();

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/hip/v3/link/carecontext`,
      postData,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": random32String,
          TIMESTAMP: new Date().toISOString(),
          "X-HIP-ID": facilityId,
          "X-CM-ID": "sbx",
          "X-LINK-TOKEN": linkToken,
          Authorization: req.headers["authorization"],
        },
      },
    );

    if (
      response.status == STATUS_CODE.ACCEPTED ||
      response.status == STATUS_CODE.SUCCESS
    ) {
      return res
        .status(STATUS_CODE.SUCCESS)
        .json({ status: "Pending", message: MSG.DATA_PROCESSING });
    } else {
      return res
        .status(response.status)
        .json({ status: response.status, error: MSG.API_ERROR + response });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }
  }
};

export const onCarecontext = async (req: any, res: any) => {
  try {
    let request = req.body;
    let response = await HealthRecordModel.updateOne(
      { hid_address: request.abhaAddress },
      {
        $set: {
          "version_m2.last_request_id": request.response.requestId,
        },
      },
    );
    return res.status(STATUS_CODE.SUCCESS).json({ status: "success" });
  } catch (error: any) {
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

export const healthInformation = async (req: any, res: any) => {
  try {
    // Log only metadata — never log full body (contains PHI: keyMaterial, patient data)
    // Validate payload against Zod schema
    const parseResult = HealthInformationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorSummary = parseResult.error.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");
      console.warn(`[HEALTH_INFO] Payload validation failed: ${errorSummary}`);
      AbdmLogger.logRejected({
        requestId: req.body?.requestId,
        consentId: req.body?.hiRequest?.consent?.id,
        reason: `INVALID_PAYLOAD: ${errorSummary}`,
        routePath: req.originalUrl,
      });
      return res.status(200).json({
        status: "Acknowledged",
        message: "Payload validation failed",
      });
    }

    const input = req.body;
    const requestId =
      input.requestId || req.headers["request-id"] || generateUID();
    if (!input?.hiRequest?.consent?.id || !input?.transactionId) {
      console.error(
        "[HEALTH_INFO] Missing required fields: consent.id or transactionId",
      );
      return res.status(400).json({
        status: "error",
        message: "Missing consent ID or transaction ID",
      });
    }

    // Respond to ABDM immediately — processing happens in the background
    res.status(200).json({
      status: "Success",
      message: "Health information request acknowledged and processing",
    });

    const callbackAuth =
      req.headers["authorization"] || req.headers["Authorization"] || "";

    // Process directly in the background (no queue) as per user preference
    const { HealthInformationService } = await import(
      "../../services/health-information.service"
    );
    HealthInformationService.processHealthInfoRequest(
      input,
      requestId,
      callbackAuth,
    ).catch(e => {
      console.error("[HEALTH_INFO] Background processing failed:", e);
    });
  } catch (error: any) {
    console.error("[HEALTH_INFO] Handler error:", error.message);
    if (!res.headersSent) {
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
  }
};
