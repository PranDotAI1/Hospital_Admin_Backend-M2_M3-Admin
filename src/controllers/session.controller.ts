import { Request, Response } from "express";
import { STATUS_CODE } from "../utils/constant";
import { apiResponse } from "../utils/common";
import { MSG } from "../utils/msgs";
import {
  getUserActiveSessions,
  invalidateSessionForUser,
  invalidateAllUserSessions,
  trustSessionForUser,
} from "../services/session.service";

export const getSessions = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const userId = req.auth?.sub;
    const currentSessionId = req.auth?.sessionId;

    if (!userId) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.UNAUTHORIZED,
        MSG.TOKEN_EXPIRED,
      );
    }

    const sessions = await getUserActiveSessions(userId, currentSessionId);

    return apiResponse(
      res,
      {
        sessions,
        count: sessions.length,
      },
      STATUS_CODE.SUCCESS,
    );
  } catch (error) {
    console.error("Get sessions error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};

export const revokeSession = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const userId = req.auth?.sub;
    const sessionId = req.params.sessionId as string;
    const currentSessionId = req.auth?.sessionId;

    if (!userId) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.UNAUTHORIZED,
        MSG.TOKEN_EXPIRED,
      );
    }

    if (sessionId === currentSessionId) {
      return apiResponse(
        res,
        { error: "Cannot revoke current session. Use logout instead." },
        STATUS_CODE.BAD_REQUEST,
        "Use logout to end your current session",
      );
    }

    const success = await invalidateSessionForUser(
      sessionId,
      userId,
      "user_revoked",
    );

    if (!success) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.NOT_FOUND,
        "Session not found, already revoked, or not owned by user",
      );
    }

    return apiResponse(
      res,
      { message: "Session revoked successfully" },
      STATUS_CODE.SUCCESS,
    );
  } catch (error) {
    console.error("Revoke session error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};

export const logoutAllDevices = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const userId = req.auth?.sub;
    const currentSessionId = req.auth?.sessionId;

    if (!userId) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.UNAUTHORIZED,
        MSG.TOKEN_EXPIRED,
      );
    }

    const revokedCount = await invalidateAllUserSessions(
      userId,
      currentSessionId,
      "logout_all_devices",
    );

    return apiResponse(
      res,
      {
        message: `Successfully logged out from ${revokedCount} device(s)`,
        revokedCount,
      },
      STATUS_CODE.SUCCESS,
    );
  } catch (error) {
    console.error("Logout all devices error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};

export const markSessionTrusted = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const userId = req.auth?.sub;
    const sessionId = req.params.sessionId as string;

    if (!userId) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.UNAUTHORIZED,
        MSG.TOKEN_EXPIRED,
      );
    }

    const success = await trustSessionForUser(sessionId, userId);

    if (!success) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.NOT_FOUND,
        "Session not found or not owned by user",
      );
    }

    return apiResponse(
      res,
      { message: "Session marked as trusted" },
      STATUS_CODE.SUCCESS,
    );
  } catch (error) {
    console.error("Trust session error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};
