import crypto from "crypto";
import { Types } from "mongoose";
import { getRedisConnection } from "../config/redis";
import { ISession, SessionModel } from "../models/Session";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days in seconds
export const MAX_CONCURRENT_SESSIONS_PER_USER = parseInt(
  process.env.MAX_CONCURRENT_SESSIONS || "3",
  10,
); // Maximum concurrent sessions per user (defaults to 3, configurable via env)
export const ROTATION_GRACE_PERIOD_MS = 30 * 1000; // 30 seconds grace period for concurrent in-flight requests

export interface SessionData {
  sessionId: string;
  userId: string;
  email: string;
  role_id: number;
  hospital_id?: string;
  refreshTokenHash: string;
  previousRefreshTokenHash?: string;
  rotatedAt?: string | Date;
  userAgent?: string;
  ipAddress?: string;
  isValid: boolean;
  expiresAt: string | Date;
  lastActiveAt: string | Date;
}

export interface CreateSessionParams {
  sessionId?: string;
  userId: string | Types.ObjectId;
  email: string;
  role_id: number;
  hospital_id?: string | Types.ObjectId;
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * SHA-256 hash helper for refresh tokens (tokens are never stored in plaintext)
 */
export const hashRefreshToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

/**
 * Creates a new session in MongoDB and Redis.
 * Enforces the maximum concurrent sessions limit (max 3 per user).
 * If the user already has 3 or more active sessions, the oldest active session is automatically revoked.
 */
export const createSession = async (
  params: CreateSessionParams,
): Promise<ISession> => {
  const userIdObj =
    typeof params.userId === "string"
      ? new Types.ObjectId(params.userId)
      : params.userId;

  const hospitalIdObj = params.hospital_id
    ? typeof params.hospital_id === "string"
      ? new Types.ObjectId(params.hospital_id)
      : params.hospital_id
    : undefined;

  // 1. Enforce concurrent session limit (max active sessions per user)
  try {
    // If user is logging in again from the EXACT same client (same userAgent & ipAddress),
    // supersede/revoke the previous session from that device so ghost sessions don't pile up.
    if (params.userAgent && params.ipAddress) {
      const sameClientSessions = await SessionModel.find({
        userId: userIdObj,
        isValid: true,
        userAgent: params.userAgent,
        ipAddress: params.ipAddress,
        expiresAt: { $gt: new Date() },
      });

      for (const oldClientSession of sameClientSessions) {
        await revokeSession(oldClientSession.sessionId);
      }
    }

    const activeSessions = await SessionModel.find({
      userId: userIdObj,
      isValid: true,
      expiresAt: { $gt: new Date() },
    }).sort({ lastActiveAt: 1 }); // oldest active first

    if (activeSessions.length >= MAX_CONCURRENT_SESSIONS_PER_USER) {
      const sessionsToRevokeCount =
        activeSessions.length - MAX_CONCURRENT_SESSIONS_PER_USER + 1;
      const sessionsToRevoke = activeSessions.slice(0, sessionsToRevokeCount);

      for (const oldSession of sessionsToRevoke) {
        console.log(
          `[SESSION] User ${params.email} reached max concurrent sessions (${MAX_CONCURRENT_SESSIONS_PER_USER}). Evicting oldest session: ${oldSession.sessionId}`,
        );
        await revokeSession(oldSession.sessionId);
      }
    }
  } catch (err: any) {
    console.warn(
      `[SESSION] Error checking concurrent sessions limit: ${err?.message}`,
    );
  }

  // 2. Generate or use provided session ID & token hash
  const sessionId = params.sessionId || crypto.randomUUID();
  const refreshTokenHash = hashRefreshToken(params.refreshToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  // 3. Persist to MongoDB
  const session = await SessionModel.create({
    sessionId,
    userId: userIdObj,
    email: params.email.toLowerCase().trim(),
    role_id: params.role_id,
    hospital_id: hospitalIdObj,
    refreshTokenHash,
    userAgent: params.userAgent || "",
    ipAddress: params.ipAddress || "",
    isValid: true,
    expiresAt,
    lastActiveAt: now,
  });

  // 4. Cache in Redis for <1ms hot-path lookup
  try {
    const redis = getRedisConnection();
    const sessionPayload: SessionData = {
      sessionId,
      userId: userIdObj.toString(),
      email: params.email.toLowerCase().trim(),
      role_id: params.role_id,
      hospital_id: hospitalIdObj?.toString(),
      refreshTokenHash,
      userAgent: params.userAgent || "",
      ipAddress: params.ipAddress || "",
      isValid: true,
      expiresAt: expiresAt.toISOString(),
      lastActiveAt: now.toISOString(),
    };

    await redis.set(
      `session:${sessionId}`,
      JSON.stringify(sessionPayload),
      "EX",
      SESSION_TTL_SECONDS,
    );

    await redis.sadd(`user_sessions:${userIdObj.toString()}`, sessionId);
    await redis.expire(`user_sessions:${userIdObj.toString()}`, SESSION_TTL_SECONDS);
  } catch (redisError: any) {
    console.warn(
      `[SESSION] Failed to cache session in Redis, relying on MongoDB: ${redisError?.message}`,
    );
  }

  return session;
};

/**
 * Validates whether a session is currently active and valid.
 * Checks Redis cache first (<1ms), then falls back to MongoDB.
 */
export const validateSession = async (
  sessionId: string,
): Promise<SessionData | null> => {
  if (!sessionId) return null;

  // 1. Try Redis cache
  try {
    const redis = getRedisConnection();
    const cached = await redis.get(`session:${sessionId}`);
    if (cached) {
      const data: SessionData = JSON.parse(cached);
      if (!data.isValid) {
        return null; // Fast negative cache hit (<0.5ms) - does not query MongoDB
      }

      // Throttled heartbeat: update lastActiveAt in Redis at most once every 2 minutes
      const lastActiveTime = new Date(data.lastActiveAt).getTime();
      if (Date.now() - lastActiveTime > 2 * 60 * 1000) {
        data.lastActiveAt = new Date().toISOString();
        const remainingTtl = await redis.ttl(`session:${sessionId}`);
        if (remainingTtl > 0) {
          redis
            .set(`session:${sessionId}`, JSON.stringify(data), "EX", remainingTtl)
            .catch(() => {});
        }
        // Asynchronously keep MongoDB lastActiveAt in sync so eviction accurately identifies inactive sessions
        SessionModel.updateOne(
          { sessionId },
          { lastActiveAt: new Date() },
        ).catch((err) =>
          console.warn(`[SESSION] Failed to sync lastActiveAt to DB: ${err?.message}`),
        );
      }

      return data;
    }
  } catch (redisError: any) {
    // Redis unavailable, proceed to MongoDB fallback
  }

  // 2. Fallback to MongoDB
  try {
    const session = await SessionModel.findOne({
      sessionId,
      isValid: true,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) {
      return null;
    }

    const sessionData: SessionData = {
      sessionId: session.sessionId,
      userId: session.userId.toString(),
      email: session.email,
      role_id: session.role_id,
      hospital_id: session.hospital_id?.toString(),
      refreshTokenHash: session.refreshTokenHash,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      isValid: session.isValid,
      expiresAt: session.expiresAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
    };

    // Re-warm Redis cache
    try {
      const redis = getRedisConnection();
      const remainingSeconds = Math.max(
        1,
        Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000),
      );
      await redis.set(
        `session:${sessionId}`,
        JSON.stringify(sessionData),
        "EX",
        remainingSeconds,
      );
    } catch {
      // ignore redis write error
    }

    return sessionData;
  } catch (dbError: any) {
    console.error(`[SESSION] Database error in validateSession: ${dbError?.message}`);
    return null;
  }
};

/**
 * Performs Refresh Token Rotation (RTR) and Token Reuse Detection.
 * If the presented refresh token does NOT match the active hash,
 * a reuse attack is flagged and the session is terminated immediately.
 */
export const rotateSessionToken = async (
  sessionId: string,
  presentedRefreshToken: string,
  newRefreshToken: string,
): Promise<{
  success: boolean;
  isGracePeriod?: boolean;
  error?: "SESSION_NOT_FOUND" | "SESSION_REVOKED" | "TOKEN_REUSE_DETECTED" | "DATABASE_ERROR";
  session?: ISession;
}> => {
  if (!sessionId || !presentedRefreshToken || !newRefreshToken) {
    return { success: false, error: "SESSION_NOT_FOUND" };
  }

  const session = await SessionModel.findOne({ sessionId });
  if (!session) {
    return { success: false, error: "SESSION_NOT_FOUND" };
  }

  if (!session.isValid || session.expiresAt.getTime() <= Date.now()) {
    return { success: false, error: "SESSION_REVOKED" };
  }

  const presentedHash = hashRefreshToken(presentedRefreshToken);

  // ─── CHECK 1: TOKEN MATCHES ACTIVE REFRESH TOKEN (NORMAL ROTATION) ───
  if (presentedHash === session.refreshTokenHash) {
    const newHash = hashRefreshToken(newRefreshToken);
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    session.previousRefreshTokenHash = session.refreshTokenHash;
    session.rotatedAt = now;
    session.refreshTokenHash = newHash;
    session.lastActiveAt = now;
    session.expiresAt = newExpiresAt;
    await session.save();

    // Update Redis cache
    try {
      const redis = getRedisConnection();
      const updatedPayload: SessionData = {
        sessionId: session.sessionId,
        userId: session.userId.toString(),
        email: session.email,
        role_id: session.role_id,
        hospital_id: session.hospital_id?.toString(),
        refreshTokenHash: newHash,
        previousRefreshTokenHash: session.previousRefreshTokenHash,
        rotatedAt: now.toISOString(),
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        isValid: true,
        expiresAt: newExpiresAt.toISOString(),
        lastActiveAt: now.toISOString(),
      };

      await redis.set(
        `session:${sessionId}`,
        JSON.stringify(updatedPayload),
        "EX",
        SESSION_TTL_SECONDS,
      );
    } catch (redisError: any) {
      console.warn(
        `[SESSION] Error updating rotated session in Redis: ${redisError?.message}`,
      );
    }

    return { success: true, session };
  }

  // ─── CHECK 2: TOKEN MATCHES PREVIOUS TOKEN WITHIN 30S GRACE PERIOD ───
  // Handles in-flight parallel requests from SPAs / mobile apps when access token expires
  if (
    session.previousRefreshTokenHash &&
    presentedHash === session.previousRefreshTokenHash
  ) {
    const rotatedTime = session.rotatedAt
      ? new Date(session.rotatedAt).getTime()
      : 0;
    const isWithinGracePeriod =
      Date.now() - rotatedTime <= ROTATION_GRACE_PERIOD_MS;

    if (isWithinGracePeriod) {
      console.warn(
        `[SESSION] Refresh token replay within ${ROTATION_GRACE_PERIOD_MS / 1000}s grace period for session ${sessionId} (in-flight parallel request). Re-issuing active session tokens.`,
      );
      return { success: true, session, isGracePeriod: true };
    }
  }

  // ─── CRITICAL SECURITY CHECK: TOKEN REUSE DETECTION ───
  // Token matches neither active nor grace-period token -> THEFT / REUSE ATTACK DETECTED
  console.error(
    `[SECURITY ALERT] Refresh token reuse detected for user ${session.email} (session: ${sessionId})! Possible token theft. Terminating session immediately.`,
  );

  // Revoke the session immediately
  await revokeSession(sessionId);

  return { success: false, error: "TOKEN_REUSE_DETECTED" };
};

/**
 * Revokes a single session by sessionId.
 */
export const revokeSession = async (sessionId: string): Promise<boolean> => {
  if (!sessionId) return false;

  try {
    // 1. Update in MongoDB
    const session = await SessionModel.findOneAndUpdate(
      { sessionId },
      { isValid: false },
      { new: true },
    );

    // 2. Cache negative result (tombstone) in Redis to prevent DB hammering on revoked requests
    try {
      const redis = getRedisConnection();
      const tombstone: Partial<SessionData> = {
        sessionId,
        isValid: false,
      };
      // Cache negative validity for 15 minutes (matching access token life)
      await redis.set(
        `session:${sessionId}`,
        JSON.stringify(tombstone),
        "EX",
        900,
      );
      if (session?.userId) {
        await redis.srem(
          `user_sessions:${session.userId.toString()}`,
          sessionId,
        );
      }
    } catch (redisError: any) {
      console.warn(`[SESSION] Redis error during revokeSession: ${redisError?.message}`);
    }

    return true;
  } catch (error: any) {
    console.error(`[SESSION] Error revoking session ${sessionId}: ${error?.message}`);
    return false;
  }
};

/**
 * Revokes ALL active sessions for a given user.
 * Triggered on password change, password reset, or account suspension.
 */
export const revokeAllUserSessions = async (
  userId: string | Types.ObjectId,
): Promise<number> => {
  if (!userId) return 0;

  try {
    const userIdObj =
      typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    const activeSessions = await SessionModel.find({
      userId: userIdObj,
      isValid: true,
    }).select("sessionId");

    await SessionModel.updateMany(
      { userId: userIdObj, isValid: true },
      { isValid: false },
    );

    try {
      const redis = getRedisConnection();
      for (const s of activeSessions) {
        await redis.set(
          `session:${s.sessionId}`,
          JSON.stringify({ sessionId: s.sessionId, isValid: false }),
          "EX",
          900,
        );
      }
      await redis.del(`user_sessions:${userIdObj.toString()}`);
    } catch (redisError: any) {
      console.warn(
        `[SESSION] Redis error during revokeAllUserSessions: ${redisError?.message}`,
      );
    }

    console.log(
      `[SESSION] Revoked ${activeSessions.length} active sessions for user ${userId.toString()}`,
    );
    return activeSessions.length;
  } catch (error: any) {
    console.error(
      `[SESSION] Error revoking all sessions for user ${userId}: ${error?.message}`,
    );
    return 0;
  }
};

/**
 * Returns active sessions for a user, excluding sensitive token hashes.
 */
export const getUserActiveSessions = async (
  userId: string | Types.ObjectId,
): Promise<Array<{
  sessionId: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
}>> => {
  const userIdObj =
    typeof userId === "string" ? new Types.ObjectId(userId) : userId;

  return SessionModel.find({
    userId: userIdObj,
    isValid: true,
    expiresAt: { $gt: new Date() },
  })
    .select("sessionId userAgent ipAddress createdAt lastActiveAt expiresAt")
    .sort({ lastActiveAt: -1 })
    .lean();
};
