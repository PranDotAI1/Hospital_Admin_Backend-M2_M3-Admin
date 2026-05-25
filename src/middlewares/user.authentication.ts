import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { MSG } from "../utils/msgs";
import { UserModel } from "../models/User";
import { AuthPayload } from "../types/express";
import {
  validateSessionForUser,
  updateSessionActivity,
} from "../services/session.service";
import { extractClientIp } from "../services/geoip.service";

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) return null;
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
};

export const checkToken = (
  req: Request,
  res: Response,
  next: NextFunction,
): Response | void => {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token || !verifyToken(token)) {
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        message: MSG.TOKEN_EXPIRED,
        code: STATUS_CODE.UNAUTHORIZED,
      });
    }

    return next();
  } catch {
    return res.status(STATUS_CODE.ERROR).json({
      message: MSG.SERVICE_UNAVAILABLE,
      code: STATUS_CODE.ERROR,
    });
  }
};

export const auth = (bindUser = true) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const token = extractBearerToken(req.headers.authorization);

      if (!token) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message: MSG.TOKEN_EXPIRED,
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      const decoded = verifyToken(token) as AuthPayload | null;

      if (!decoded) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message: MSG.TOKEN_EXPIRED,
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      if (decoded.sessionId) {
        const session = await validateSessionForUser(decoded.sessionId, decoded.sub);

        if (!session) {
          return res.status(STATUS_CODE.UNAUTHORIZED).json({
            message: "Session expired or revoked",
            code: STATUS_CODE.UNAUTHORIZED,
          });
        }

        const ip = extractClientIp(req);
        updateSessionActivity(decoded.sessionId, ip).catch((err) => {
          console.warn("Failed to update session activity:", err);
        });
      }

      req.auth = decoded;

      if (bindUser) {
        const user = await UserModel.findById(decoded.sub).select(
          "-password -previous_passwords -reset_otp",
        );

        if (!user) {
          return res.status(STATUS_CODE.UNAUTHORIZED).json({
            message: MSG.INVALID_EMAIL_PASSWORD,
            code: STATUS_CODE.UNAUTHORIZED,
          });
        }

        req.user = user;
      }

      return next();
    } catch (error) {
      console.error("Auth middleware error:", error);
      return res.status(STATUS_CODE.ERROR).json({
        message: MSG.SERVICE_UNAVAILABLE,
        code: STATUS_CODE.ERROR,
      });
    }
  };
};

export const strictAuth = () => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> => {
    try {
      const token = extractBearerToken(req.headers.authorization);

      if (!token) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message: MSG.TOKEN_EXPIRED,
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      const decoded = verifyToken(token) as AuthPayload | null;

      if (!decoded || !decoded.sessionId) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message: "Invalid or missing session",
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      const session = await validateSessionForUser(decoded.sessionId, decoded.sub);

      if (!session) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message: "Session expired or revoked",
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      const ip = extractClientIp(req);
      await updateSessionActivity(decoded.sessionId, ip);

      req.auth = decoded;

      return next();
    } catch (error) {
      console.error("Strict auth middleware error:", error);
      return res.status(STATUS_CODE.ERROR).json({
        message: MSG.SERVICE_UNAVAILABLE,
        code: STATUS_CODE.ERROR,
      });
    }
  };
};

export const requireRole = (...allowedRoles: number[]) => {
  return (req: any, res: any, next: any) => {
    const userRoleId = req.user?.role_id;
    if (userRoleId === undefined || !allowedRoles.includes(userRoleId)) {
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: You do not have permission to perform this action",
        code: STATUS_CODE.FORBIDDEN,
      });
    }
    return next();
  };
};