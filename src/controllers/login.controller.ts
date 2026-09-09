import crypto from "crypto";
import { STATUS_CODE, USER_ENUM } from "../utils/constant";
import { UserModel } from "../models/User";
import {
  comparePassword,
  apiResponse,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  blacklistToken,
  expiredToken,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_SECONDS,
} from "../utils/common";
import {
  createSession,
  rotateSessionToken,
  revokeSession,
  getUserActiveSessions,
  revokeAllUserSessions,
} from "../services/session.service";
import { MSG } from "../utils/msgs";

/**
 * Normalise the COOKIE_SAMESITE env var to a value the cookie package accepts.
 * Express/cookie only recognises the exact strings "strict", "lax", and "none" (all lowercase).
 */
const normaliseSameSite = (): "strict" | "lax" | "none" => {
  const raw = (process.env.COOKIE_SAMESITE || "").trim().toLowerCase();
  if (raw === "strict" || raw === "lax" || raw === "none") return raw;
  return "lax"; // safe default
};

/**
 * Determines if the current request is over a secure (HTTPS) connection.
 * Accurately detects SSL/TLS even when behind reverse proxies, ALBs, or Cloudflare,
 * while ensuring localhost/HTTP dev connections are correctly identified as non-secure.
 */
export const isRequestSecure = (req?: any): boolean => {
  if (!req) {
    return process.env.COOKIE_SECURE === "true";
  }

  // 1. Explicit HTTPS check on Express request
  if (req.secure || req.protocol === "https") {
    return true;
  }

  // 2. Reverse proxy / load balancer forwarded headers
  const forwardedProto =
    req.headers?.["x-forwarded-proto"] || req.headers?.["x-forwarded-protocol"];
  if (forwardedProto) {
    const protoStr = (
      typeof forwardedProto === "string" ? forwardedProto : forwardedProto[0]
    ).toLowerCase();
    if (protoStr.includes("https")) {
      return true;
    }
  }

  // 3. Local development detection (localhost, 127.0.0.1, ::1)
  const host = (req.headers?.host || req.hostname || "").toLowerCase();
  const origin = (
    (req.headers?.origin as string) ||
    (req.headers?.referer as string) ||
    ""
  ).toLowerCase();

  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("::1") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    origin.includes("::1");

  if (isLocal) {
    // Plain HTTP on localhost MUST NOT set secure: true,
    // otherwise Safari and other browsers reject the cookie!
    return false;
  }

  // 4. Fallback to explicit env overrides
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;

  return process.env.NODE_ENV === "production";
};

export const resolveCookieDomain = (req?: any): string | undefined => {
  const host = (req?.headers?.host || req?.hostname || "").toLowerCase().split(":")[0];
  const origin = (
    (req?.headers?.origin as string) ||
    (req?.headers?.referer as string) ||
    ""
  ).toLowerCase();

  // Local development or direct IP must never have a domain attribute
  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("::1") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    origin.includes("::1") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host);

  if (isLocal) {
    return undefined;
  }

  // Explicit env override (use only when you KNOW frontend & API share the same registrable domain)
  if (process.env.COOKIE_DOMAIN) {
    return process.env.COOKIE_DOMAIN;
  }

  // When COOKIE_DOMAIN is not set, return undefined so the browser defaults
  // the cookie domain to the exact host that set it (the API server).
  // DO NOT auto-detect from Origin header — in cross-origin setups
  // (e.g. frontend on pran.ai, API on pranamm.ai) the Origin belongs to
  // a different registrable domain and would cause a domain mismatch.
  return undefined;
};

/**
 * Cookie options helper adhering to security requirements.
 * Automatically adapts secure & sameSite flags based on whether connection is HTTPS or HTTP.
 */
const getCookieOptions = (req: any, maxAgeMs: number) => {
  const secure = isRequestSecure(req);
  let sameSite = normaliseSameSite();

  // Browsers strictly reject SameSite=None if Secure is false.
  // When running without TLS (e.g. localhost HTTP), fallback to "lax".
  if (!secure && sameSite === "none") {
    sameSite = "lax";
  }

  const cookieDomain = resolveCookieDomain(req);

  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: maxAgeMs,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
};

const getClearCookieOptions = (req?: any) => {
  const secure = isRequestSecure(req);
  let sameSite = normaliseSameSite();
  if (!secure && sameSite === "none") {
    sameSite = "lax";
  }

  const cookieDomain = resolveCookieDomain(req);

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
};

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
// Pre-computed bcrypt hash (work factor 12) for constant-time comparison on non-existent users (timing attack mitigation)
const DUMMY_BCRYPT_HASH =
  "$2b$12$e8Yh9YI5jT9R3dY8zE2UWeJqBvM.G3u0uU2SgX8lI6i3wQe1rE7.K";

/**
 * POST /login
 * Authenticates user, creates server-side session (max 3 per user),
 * and issues short-lived access token (15m) + long-lived refresh token (7d).
 */
export const login = async (req: any, res: any) => {
  try {
    const input = req.body;
    const user: any = await UserModel.findOne({
      email: input.email?.toLowerCase().trim(),
      status: USER_ENUM.ACTIVE,
    });

    if (!user) {
      // Mitigate timing attacks by executing a constant-time bcrypt comparison
      await comparePassword(input.password || "", DUMMY_BCRYPT_HASH);
      return apiResponse(
        res,
        MSG.INVALID_EMAIL_PASSWORD,
        STATUS_CODE.UNAUTHORIZED,
      );
    }

    const now = new Date();

    // Check account lockout
    if (user.lockUntil && user.lockUntil > now) {
      const remainingMs = user.lockUntil.getTime() - now.getTime();
      const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
      return apiResponse(
        res,
        `Account is temporarily locked due to ${MAX_FAILED_LOGIN_ATTEMPTS} consecutive failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
        STATUS_CODE.UNAUTHORIZED,
        "Account Locked",
      );
    }

    const isMatch = await comparePassword(input.password, user.password);
    if (!isMatch) {
      // If previous lockout expired, reset counter to 1, otherwise increment
      const currentAttempts =
        user.lockUntil && user.lockUntil <= now
          ? 1
          : (user.failedLoginAttempts || 0) + 1;

      if (currentAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await UserModel.findByIdAndUpdate(user._id, {
          failedLoginAttempts: currentAttempts,
          lockUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
        });
        return apiResponse(
          res,
          "Account has been temporarily locked for 15 minutes due to 5 consecutive failed login attempts.",
          STATUS_CODE.UNAUTHORIZED,
          "Account Locked",
        );
      } else {
        await UserModel.findByIdAndUpdate(user._id, {
          failedLoginAttempts: currentAttempts,
          lockUntil: null,
        });
        const remainingAttempts = MAX_FAILED_LOGIN_ATTEMPTS - currentAttempts;
        return apiResponse(
          res,
          `Invalid email or password. ${remainingAttempts} attempt(s) remaining before account lockout.`,
          STATUS_CODE.UNAUTHORIZED,
          "Authentication Failed",
        );
      }
    }

    // Reset failed login attempts and lockout upon successful authentication
    if ((user.failedLoginAttempts || 0) > 0 || user.lockUntil) {
      await UserModel.findByIdAndUpdate(user._id, {
        failedLoginAttempts: 0,
        lockUntil: null,
      });
    }

    const userId = (user.id || user._id).toString();
    const sessionId = crypto.randomUUID();

    // Generate tokens
    const accessToken = generateAccessToken({
      id: userId,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
      sessionId,
    });

    const refreshToken = generateRefreshToken({
      id: userId,
      sessionId,
    });

    // Create server-side session in MongoDB & Redis (enforcing max 3 concurrent sessions)
    const clientIp =
      req.ip ||
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      "";
    const userAgent = (req.headers["user-agent"] as string) || "";

    await createSession({
      sessionId,
      userId,
      email: user.email,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
      refreshToken,
      userAgent,
      ipAddress: clientIp,
    });

    // Set HttpOnly cookies:
    // - access_token: 15 minutes
    // - token: 15 minutes (backwards-compat)
    // - refresh_token: 7 days
    res.cookie(
      "access_token",
      accessToken,
      getCookieOptions(req, ACCESS_TOKEN_EXPIRY_SECONDS * 1000),
    );
    res.cookie(
      "token",
      accessToken,
      getCookieOptions(req, ACCESS_TOKEN_EXPIRY_SECONDS * 1000),
    );
    res.cookie(
      "refresh_token",
      refreshToken,
      getCookieOptions(req, REFRESH_TOKEN_EXPIRY_SECONDS * 1000),
    );

    const responsePayload = {
      id: userId,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
    };

    return apiResponse(res, responsePayload, STATUS_CODE.SUCCESS);
  } catch (error: any) {
    console.error("[LOGIN_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message:
        process.env.NODE_ENV === "production"
          ? "An error occurred during authentication"
          : error.message,
    });
  }
};

/**
 * POST /refresh-token or POST /auth/refresh
 * Validates refresh token, executes Refresh Token Rotation (RTR),
 * guards against token reuse attacks, and issues new token pair.
 */
export const refreshSession = async (req: any, res: any) => {
  try {
    // 1. Extract refresh token from cookie or body or header
    const refreshToken =
      req.cookies?.refresh_token ||
      req.body?.refreshToken ||
      req.body?.refresh_token ||
      req.headers["x-refresh-token"];

    if (!refreshToken) {
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        message: "Refresh token is required",
        code: STATUS_CODE.UNAUTHORIZED,
      });
    }

    // 2. Verify refresh token cryptographic signature & expiry
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded || !decoded.sessionId || !decoded.id) {
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        message: "Invalid or expired refresh token",
        code: STATUS_CODE.UNAUTHORIZED,
      });
    }

    // 3. Verify user account in database is active
    const user: any = await UserModel.findById(decoded.id).lean();
    if (!user || user.status !== USER_ENUM.ACTIVE || user.is_active === false) {
      await revokeSession(decoded.sessionId);
      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        message: "User account is inactive or disabled",
        code: STATUS_CODE.UNAUTHORIZED,
      });
    }

    const userId = user._id.toString();

    // 4. Generate rotated token pair
    const newRefreshToken = generateRefreshToken({
      id: userId,
      sessionId: decoded.sessionId,
    });

    const newAccessToken = generateAccessToken({
      id: userId,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
      sessionId: decoded.sessionId,
    });

    // 5. Rotate session token in Redis & MongoDB (with automatic reuse detection!)
    const rotation = await rotateSessionToken(
      decoded.sessionId,
      refreshToken,
      newRefreshToken,
    );

    if (!rotation.success) {
      // ─── REUSE ATTACK DETECTED: TERMINATE CLIENT SESSIONS ───
      if (rotation.error === "TOKEN_REUSE_DETECTED") {
        const clearOpts = getClearCookieOptions(req);
        res.clearCookie("access_token", clearOpts);
        res.clearCookie("token", clearOpts);
        res.clearCookie("refresh_token", clearOpts);

        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          message:
            "Security violation: Refresh token reuse detected. Session terminated immediately.",
          code: STATUS_CODE.UNAUTHORIZED,
          securityViolation: true,
        });
      }

      return res.status(STATUS_CODE.UNAUTHORIZED).json({
        message: "Session has expired or was revoked",
        code: STATUS_CODE.UNAUTHORIZED,
      });
    }

    // 6. Set rotated HttpOnly cookies
    res.cookie(
      "access_token",
      newAccessToken,
      getCookieOptions(req, ACCESS_TOKEN_EXPIRY_SECONDS * 1000),
    );
    res.cookie(
      "token",
      newAccessToken,
      getCookieOptions(req, ACCESS_TOKEN_EXPIRY_SECONDS * 1000),
    );
    res.cookie(
      "refresh_token",
      newRefreshToken,
      getCookieOptions(req, REFRESH_TOKEN_EXPIRY_SECONDS * 1000),
    );

    const responsePayload = {
      session_id: decoded.sessionId,
      ...(rotation.isGracePeriod ? { is_grace_period: true } : {}),
    };

    return apiResponse(
      res,
      responsePayload,
      STATUS_CODE.SUCCESS,
      "Token refreshed successfully",
    );
  } catch (error: any) {
    console.error("[REFRESH_SESSION_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.UNAUTHORIZED).json({
      message: "An error occurred while refreshing the session",
      code: STATUS_CODE.UNAUTHORIZED,
    });
  }
};

/**
 * POST /logout
 * Destroys server-side session, blacklists access token, and clears all session cookies.
 */
export const logout = async (req: any, res: any) => {
  try {
    const token =
      req.cookies?.access_token ||
      req.cookies?.token ||
      req.headers["authorization"];

    // Revoke server-side session
    const sessionId = req.sessionId;
    if (sessionId) {
      await revokeSession(sessionId);
    }

    // Blacklist current access token
    if (token) {
      await blacklistToken(token);
    }

    const clearOpts = getClearCookieOptions(req);
    res.clearCookie("access_token", clearOpts);
    res.clearCookie("token", clearOpts);
    res.clearCookie("refresh_token", clearOpts);

    return apiResponse(res, {}, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
  } catch (error: any) {
    console.error("[LOGOUT_ERROR]", error?.message || error);
    const clearOpts = getClearCookieOptions(req);
    res.clearCookie("access_token", clearOpts);
    res.clearCookie("token", clearOpts);
    res.clearCookie("refresh_token", clearOpts);
    return apiResponse(res, {}, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
  }
};

/**
 * GET /auth/sessions
 * Returns the list of active sessions for the authenticated user.
 */
export const listActiveSessions = async (req: any, res: any) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: "Unauthorized", code: STATUS_CODE.UNAUTHORIZED });
    }

    const sessions = await getUserActiveSessions(userId);
    const currentSessionId = req.sessionId;

    const formattedSessions = sessions.map((s) => ({
      sessionId: s.sessionId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      isCurrent: s.sessionId === currentSessionId,
    }));

    return apiResponse(res, formattedSessions, STATUS_CODE.SUCCESS);
  } catch (error: any) {
    console.error("[LIST_SESSIONS_ERROR]", error?.message || error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Failed to retrieve sessions", code: STATUS_CODE.ERROR });
  }
};

/**
 * POST /auth/sessions/revoke
 * Revokes a specific session belonging to the user.
 */
export const revokeSessionHandler = async (req: any, res: any) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res
        .status(STATUS_CODE.BAD_REQUEST)
        .json({ message: "sessionId is required", code: STATUS_CODE.BAD_REQUEST });
    }

    await revokeSession(sessionId);

    // If revoking current session, clear cookies
    if (sessionId === req.sessionId) {
      const clearOpts = getClearCookieOptions(req);
      res.clearCookie("access_token", clearOpts);
      res.clearCookie("token", clearOpts);
      res.clearCookie("refresh_token", clearOpts);
    }

    return apiResponse(res, { revoked: true }, STATUS_CODE.SUCCESS, "Session revoked successfully");
  } catch (error: any) {
    console.error("[REVOKE_SESSION_ERROR]", error?.message || error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Failed to revoke session", code: STATUS_CODE.ERROR });
  }
};

/**
 * POST /auth/sessions/revoke-all-others
 * Revokes all sessions for the user except the current one.
 */
export const revokeOtherSessionsHandler = async (req: any, res: any) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const currentSessionId = req.sessionId;

    const sessions = await getUserActiveSessions(userId);
    let count = 0;
    for (const s of sessions) {
      if (s.sessionId !== currentSessionId) {
        await revokeSession(s.sessionId);
        count++;
      }
    }

    return apiResponse(
      res,
      { revokedCount: count },
      STATUS_CODE.SUCCESS,
      `Revoked ${count} other active session(s)`,
    );
  } catch (error: any) {
    console.error("[REVOKE_OTHER_SESSIONS_ERROR]", error?.message || error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Failed to revoke other sessions", code: STATUS_CODE.ERROR });
  }
};
