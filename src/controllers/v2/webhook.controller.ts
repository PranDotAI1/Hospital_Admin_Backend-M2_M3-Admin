import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { STATUS_CODE, facilityId, generateUID } from "../../utils/constant";
import { MSG } from "../../utils/msgs";

export const linkTokenGeneration = async (req: any, res: any) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    console.log("[LINK_TOKEN] Legacy link token generation start");
    console.log("[LINK_TOKEN] URL:", baseUrl);

    let postData = req.body;
    console.log("[LINK_TOKEN] Request:", JSON.stringify(postData));

    const latestRecord = await HealthRecordModel.findOne({
      hid_address: postData.abhaAddress,
    })
      .sort({ updatedAt: -1 })
      .limit(1);

    if (latestRecord) {
      console.log("[LINK_TOKEN] Found HealthRecord, updating token");
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
      console.log(
        "[LINK_TOKEN] No HealthRecord found for:",
        postData.abhaAddress,
      );
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
  console.log("[CARECONTEXT_LEGACY] careContext api start");
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

    console.log(
      "[CARECONTEXT_LEGACY] on_carecontext callback:",
      JSON.stringify(request),
    );

    let response = await HealthRecordModel.updateOne(
      { hid_address: request.abhaAddress },
      {
        $set: {
          "version_m2.last_request_id": request.response.requestId,
        },
      },
    );

    console.log("[CARECONTEXT_LEGACY] on_carecontext update result:", response);
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
    console.log(
      "[HEALTH_INFO] Received health-information/request:",
      JSON.stringify(req.body),
    );

    const input = req.body;
    const requestId =
      req.headers["request-id"] || req.headers["REQUEST-ID"] || generateUID();

    if (!input?.hiRequest?.consent?.id || !input?.transactionId) {
      console.error(
        "[HEALTH_INFO] Missing required fields: consent.id or transactionId",
      );
      return res.status(400).json({
        status: "error",
        message: "Missing consent ID or transaction ID",
      });
    }

    res.status(200).json({
      status: "Success",
      message: "Health information request acknowledged and processing",
    });

    const { HealthInformationService } =
      await import("../../services/health-information.service");

    const callbackAuth =
      req.headers["authorization"] || req.headers["Authorization"] || "";

    await HealthInformationService.processHealthInfoRequest(
      input,
      requestId,
      callbackAuth,
    );
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
