import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { STATUS_CODE } from "../../utils/constant";

export const generateBotToken = async (req: Request, res: Response) => {
  try {
    const serviceKey =
      (req.headers["x-service-key"] as string) ||
      (req.headers["x-api-key"] as string);

    const expectedServiceKey =
      process.env.CHATBOT_SERVICE_KEY ||
      process.env.CHATBOT_API_KEY

    if (!serviceKey || serviceKey.trim() !== expectedServiceKey) {
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        status: "error",
        success: false,
        message: "Unauthorized request",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        success: false,
        message: "Authentication service unavailable",
      });
    }

    const expiresIn = parseInt(process.env.CHATBOT_TOKEN_EXPIRES_IN || "900", 10);

    const accessToken = jwt.sign(
      {
        sub: "bot_server",
        role: "BOT_SERVER",
        type: "bot_session",
      },
      jwtSecret,
      {
        expiresIn: `${expiresIn}s`,
      },
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      token: accessToken,
      accessToken,
      expiresIn,
    });
  } catch (error: any) {
    console.error("[CHAT_BOT_TOKEN_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message:
        process.env.NODE_ENV === "production"
          ? "Failed to generate bot session token"
          : error.message,
    });
  }
};
