import { Request, Response } from "express";
import { CareContextService } from "../../services/carecontext.service";
import { AbdmTokenService } from "../../services/abdm.token.service";
import { STATUS_CODE } from "../../utils/constant";

export const onGenerateToken = async (req: Request, res: Response) => {
  try {
    console.log(
      "CareContext Callback: on-generate-token received",
      "abhaAddress:", req.body?.abhaAddress ? "[REDACTED]" : "missing",
      "hasLinkToken:", !!req.body?.linkToken,
    );

    const postData = req.body;
    const { abhaAddress, linkToken } = postData;

    if (!abhaAddress || !linkToken) {
      console.log("CareContext Callback: Missing abhaAddress or linkToken");
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged but missing required fields",
      });
    }

    const patient = await CareContextService.storeLinkTokenByAbhaAddress(
      abhaAddress,
      linkToken,
    );

    if (!patient) {
      console.log(
        "CareContext Callback: No patient found for abhaAddress",
        abhaAddress,
      );
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged but patient not found",
      });
    }

    console.log(
      "CareContext Callback: LinkToken stored for patient",
      patient.uhid ?? patient._id?.toString() ?? abhaAddress,
    );

    try {
      let abdmToken: string | undefined;
      try {
        abdmToken = await AbdmTokenService.getToken();
      } catch (tokenErr: any) {
        console.warn(
          "CareContext Callback: AbdmTokenService.getToken() failed, falling back to callback auth header:",
          tokenErr.message,
        );
        const callbackAuth =
          req.headers["authorization"] || req.headers["Authorization"];
        if (callbackAuth) {
          abdmToken =
            typeof callbackAuth === "string"
              ? callbackAuth
              : String(callbackAuth);
          if (!abdmToken.toLowerCase().startsWith("bearer ")) {
            abdmToken = `Bearer ${abdmToken}`;
          }
        }
      }

      if (!abdmToken) {
        console.error(
          "CareContext Callback: No ABDM token available. Pending contexts will not be linked now.",
        );
      } else {
        const linkedCount = await CareContextService.linkPendingCareContexts(
          patient._id,
          abdmToken,
        );
        console.log(
          "CareContext Callback: Linked",
          linkedCount,
          "pending contexts",
        );
      }
    } catch (linkError) {
      console.error(
        "CareContext Callback: Error linking pending contexts",
        linkError,
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "LinkToken stored and pending contexts being linked",
    });
  } catch (error: any) {
    console.error("CareContext Callback: on-generate-token error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};

export const onCareContext = async (req: Request, res: Response) => {
  try {
    console.log(
      "CareContext Callback: on-carecontext received",
      "requestId:", req.body?.response?.requestId,
      "hasError:", !!req.body?.error,
    );

    const postData = req.body;
    const { abhaAddress, error } = postData;
    const requestId = postData.response?.requestId;

    console.log(
      "CareContext Callback: on_carecontext requestId:",
      requestId,
      "success:",
      !error,
      "error:",
      error || "none",
    );

    if (!requestId) {
      console.log(
        "CareContext Callback: Missing requestId in body. Expected postData.response.requestId (same as REQUEST-ID header sent in link/carecontext).",
      );
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged but missing requestId",
      });
    }

    const success = !error;

    await CareContextService.handleLinkCallback(
      abhaAddress || "",
      requestId,
      success,
      error,
    );

    console.log(
      "CareContext Callback: Processed",
      requestId,
      success ? "SUCCESS" : "FAILED",
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Callback processed",
    });
  } catch (error: any) {
    console.error("CareContext Callback: on-carecontext error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};

export const onContextNotify = async (req: Request, res: Response) => {
  try {
    console.log(
      "CareContext Callback: on-context-notify received",
      "requestId:", req.body?.response?.requestId,
      "status:", req.body?.acknowledgement?.status,
    );

    const postData = req.body;
    const requestId = postData?.response?.requestId;
    const error = postData?.error;
    const success = !error && postData?.acknowledgement?.status === "OK";

    if (requestId) {
      await CareContextService.handleContextNotifyCallback(
        requestId,
        success,
        error,
      );
    } else {
      console.warn(
        "CareContext Callback: on-context-notify missing response.requestId",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Acknowledged",
    });
  } catch (error: any) {
    console.error("CareContext Callback: on-context-notify error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};
