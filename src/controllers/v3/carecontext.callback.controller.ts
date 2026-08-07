import { Request, Response } from "express";
import { CareContextService } from "../../services/carecontext.service";
import { AbdmTokenService } from "../../services/abdm.token.service";
import { STATUS_CODE } from "../../utils/constant";

export const onGenerateToken = async (req: Request, res: Response) => {
  try {
    const postData = req.body;
    const { abhaAddress, linkToken } = postData;

    if (!abhaAddress || !linkToken) {
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
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged but patient not found",
      });
    }
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
    const postData = req.body;
    const { abhaAddress, error } = postData;
    const requestId = postData.response?.requestId;
    if (!requestId) {
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
