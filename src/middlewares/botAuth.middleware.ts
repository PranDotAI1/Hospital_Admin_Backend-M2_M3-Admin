import { Request, Response, NextFunction } from "express";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import { STATUS_CODE } from "../utils/constant";

export interface BotJwtPayload {
  sub: string;
  role: string;
  type: string;
  iat?: number;
  exp?: number;
}

export const requireBotToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader =
    req.headers.authorization ||
    (req.headers["x-bot-token"] as string) ||
    (req.headers["x-api-key"] as string);

  if (!authHeader) {
    return res.status(STATUS_CODE.UNAUTHORIZED).json({
      status: "error",
      success: false,
      code: "AUTH_HEADER_MISSING",
      message: "Authorization bearer token is required",
    });
  }

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!token) {
    return res.status(STATUS_CODE.UNAUTHORIZED).json({
      status: "error",
      success: false,
      code: "TOKEN_MISSING",
      message: "Bearer token string is empty",
    });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: "Authentication service misconfigured",
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as BotJwtPayload;

    if (decoded.role !== "BOT_SERVER" || decoded.type !== "bot_session") {
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        success: false,
        code: "INVALID_TOKEN_ROLE",
        message: "Token is not authorized for bot operations",
      });
    }

    (req as any).bot = decoded;
    next();
  } catch (error: any) {
    if (error instanceof TokenExpiredError) {
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        status: "error",
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Bot session token has expired. Please refresh.",
      });
    }

    return res.status(STATUS_CODE.UNAUTHORIZED).json({
      status: "error",
      success: false,
      code: "TOKEN_INVALID",
      message: "Invalid bot session token",
    });
  }
};
