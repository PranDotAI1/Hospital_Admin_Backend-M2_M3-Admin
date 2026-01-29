import axios from "axios";
import { Request, Response } from "express";
import { DailyOpdQueueModel } from "../../models/DailyOpdQueue";
import { generateUID } from "../../utils/constant";

const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const handleRunningTokenStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    console.log(
      "Running token status request received:",
      JSON.stringify(req.body, null, 2),
    );
    // console.log("Headers:", req.headers);

    res.status(202).json({
      status: "Accepted",
      message: "Request received and processing",
    });
    const webhookBody = req.body;
    const context = webhookBody?.context;
    const hipId = webhookBody?.hipId;

    const incomingRequestId =
      (req.headers["request-id"] as string) ||
      (req.headers["REQUEST-ID"] as string) ||
      "";

    if (!context) {
      console.error(
        "Missing context in running token status request:",
        webhookBody,
      );
      return;
    }

    if (!hipId) {
      console.warn(
        "Missing hipId in running token status request:",
        webhookBody,
      );
    }

    if (!incomingRequestId) {
      console.warn(
        "Missing REQUEST-ID in headers. This may cause issues with callback response.",
      );
    }

    const todayDate = getTodayDateString();
    const queueDoc = await DailyOpdQueueModel.findOne({
      date: todayDate,
      counterId: context,
    });

    let currentServingToken = 0;
    let averageTokenServiceTimeInMinutes = 2;

    if (queueDoc) {
      currentServingToken = queueDoc.currentServingToken;
      averageTokenServiceTimeInMinutes = queueDoc.avgServiceTime || 2;
    } else {
      console.warn(
        `Queue not found for context: ${context}, date: ${todayDate}. Using default values.`,
      );
    }

    await sendRunningTokenStatusCallback(
      hipId,
      context,
      currentServingToken,
      averageTokenServiceTimeInMinutes,
      incomingRequestId,
      req,
    );
  } catch (error: any) {
    console.error("Handle Running Token Status error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
    });
  }
};

const sendRunningTokenStatusCallback = async (
  hipId: string | undefined,
  context: string,
  currentServingToken: number,
  averageTokenServiceTimeInMinutes: number,
  incomingRequestId: string,
  req: Request,
): Promise<void> => {
  try {
    const outgoingRequestId = generateUID();

    const authorization =
      req.headers["authorization"] || req.headers["Authorization"] || "";

    if (!authorization) {
      console.error(
        "Missing authorization token in request headers. Cannot send callback.",
      );
      return;
    }

    const runningTokenNumber = currentServingToken.toString().padStart(4, "0");

    const callbackPayload = {
      token: {
        hipId: hipId || "",
        context: context,
        runningTokenNumber: runningTokenNumber,
        averageTokenServiceTimeInMinutes: averageTokenServiceTimeInMinutes,
      },
      response: {
        requestId: incomingRequestId,
      },
    };

    const callbackResponse = await axios.post(
      "https://dev.abdm.gov.in/api/hiecm/patient-share/v3/running-token/on-status",
      callbackPayload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-CM-ID": "sbx",
          Authorization: authorization as string,
          "REQUEST-ID": outgoingRequestId,
          TIMESTAMP: new Date().toISOString(),
        },
        timeout: 10000,
      },
    );

    console.log(
      "ABDM running token status callback response:",
      callbackResponse.status,
      callbackResponse.data,
    );
  } catch (callbackError: any) {
    console.error("ABDM running token status callback failed:", {
      message: callbackError.message,
      response: callbackError.response?.data,
      status: callbackError.response?.status,
      context: context,
      hipId: hipId,
      incomingRequestId: incomingRequestId,
    });
  }
};
