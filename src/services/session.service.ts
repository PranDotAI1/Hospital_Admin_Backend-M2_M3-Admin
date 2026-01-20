import crypto from "crypto";
import { Types } from "mongoose";
import {
  ISession,
  SessionModel,
  SessionStatus,
  SignInMethod,
} from "../models/Session";
import { getGeoInfo, extractClientIp, GeoInfo } from "./geoip.service";
import { parseUserAgent, ParsedUserAgent } from "./useragent.service";

const SESSION_EXPIRY_HOURS = parseInt(
  process.env.SESSION_EXPIRY_HOURS || "24",
  10,
);
const MAX_CONCURRENT_SESSIONS = parseInt(
  process.env.MAX_CONCURRENT_SESSIONS || "5",
  10,
);

export interface CreateSessionInput {
  userId: string | Types.ObjectId;
  token: string;
  userAgent: string;
  ip: string;
  signInMethod?: SignInMethod;
}

export interface SessionInfo {
  id: string;
  deviceType: string;
  deviceName?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  city?: string;
  country?: string;
  countryName?: string;
  timezone?: string;
  isTrusted: boolean;
  isCurrent: boolean;
  lastActivityAt: Date;
  createdAt: Date;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  input: CreateSessionInput & { _id?: Types.ObjectId },
): Promise<ISession> {
  const {
    userId,
    token,
    userAgent,
    ip,
    signInMethod = SignInMethod.PASSWORD,
    _id,
  } = input;

  const parsedUA: ParsedUserAgent = parseUserAgent(userAgent);
  const tokenHash = hashToken(token);

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_EXPIRY_HOURS);

  const sessionData: any = {
    userId: new Types.ObjectId(userId.toString()),
    tokenHash,
    status: SessionStatus.ACTIVE,
    signInMethod,
    expiresAt,
    userAgent,

    deviceType: parsedUA.deviceType,
    deviceName: parsedUA.deviceName,
    browser: parsedUA.browser,
    browserVersion: parsedUA.browserVersion,
    os: parsedUA.os,
    osVersion: parsedUA.osVersion,

    ipAddress: ip,

    lastActivityAt: new Date(),
    lastActivityIp: ip,
    activityCount: 1,
  };

  if (_id) {
    sessionData._id = _id;
  }

  const session = await SessionModel.create(sessionData);

  getGeoInfo(ip)
    .then(async (geoInfo) => {
      if (geoInfo && (geoInfo.city || geoInfo.country)) {
        await SessionModel.updateOne(
          { _id: session._id },
          {
            $set: {
              city: geoInfo.city,
              region: geoInfo.region,
              country: geoInfo.country,
              countryName: geoInfo.countryName,
              timezone: geoInfo.timezone,
              isp: geoInfo.isp,
            },
          },
        );
      }
    })
    .catch((err) => {
      console.warn(
        `Failed to update session ${session._id} with geo info:`,
        err,
      );
    });

  await enforceSessionLimit(userId.toString());

  return session;
}

export async function validateSession(
  sessionId: string,
): Promise<ISession | null> {
  if (!Types.ObjectId.isValid(sessionId)) {
    return null;
  }

  const session = await SessionModel.findOne({
    _id: new Types.ObjectId(sessionId),
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() },
  });

  return session;
}

export async function validateSessionForUser(
  sessionId: string,
  userId: string,
): Promise<ISession | null> {
  if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
    return null;
  }

  return SessionModel.findOne({
    _id: new Types.ObjectId(sessionId),
    userId: new Types.ObjectId(userId),
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() },
  });
}

export async function validateSessionByToken(
  token: string,
): Promise<ISession | null> {
  const tokenHash = hashToken(token);

  const session = await SessionModel.findOne({
    tokenHash,
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() },
  });

  return session;
}

export async function updateSessionActivity(
  sessionId: string,
  ip?: string,
): Promise<void> {
  if (!Types.ObjectId.isValid(sessionId)) return;

  await SessionModel.updateOne(
    { _id: new Types.ObjectId(sessionId), status: SessionStatus.ACTIVE },
    {
      $set: {
        lastActivityAt: new Date(),
        ...(ip && { lastActivityIp: ip }),
      },
      $inc: { activityCount: 1 },
    },
  );
}

export async function invalidateSession(
  sessionId: string,
  reason: string = "user_logout",
): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;

  const result = await SessionModel.updateOne(
    { _id: new Types.ObjectId(sessionId), status: SessionStatus.ACTIVE },
    {
      $set: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    },
  );

  return result.modifiedCount > 0;
}

export async function invalidateAllUserSessions(
  userId: string,
  exceptSessionId?: string,
  reason: string = "logout_all_devices",
): Promise<number> {
  const query: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    status: SessionStatus.ACTIVE,
  };

  if (exceptSessionId && Types.ObjectId.isValid(exceptSessionId)) {
    query._id = { $ne: new Types.ObjectId(exceptSessionId) };
  }

  const result = await SessionModel.updateMany(query, {
    $set: {
      status: SessionStatus.REVOKED,
      revokedAt: new Date(),
      revokedReason: reason,
    },
  });

  return result.modifiedCount;
}

export async function getUserActiveSessions(
  userId: string,
  currentSessionId?: string,
): Promise<SessionInfo[]> {
  const sessions = await SessionModel.find({
    userId: new Types.ObjectId(userId),
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActivityAt: -1 })
    .lean();

  return sessions.map((session) => ({
    id: session._id.toString(),
    deviceType: session.deviceType,
    deviceName: session.deviceName,
    browser: session.browser,
    browserVersion: session.browserVersion,
    os: session.os,
    osVersion: session.osVersion,
    city: session.city,
    country: session.country,
    countryName: session.countryName,
    timezone: session.timezone,
    isTrusted: session.isTrusted,
    isCurrent: currentSessionId === session._id.toString(),
    lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt,
  }));
}

export async function trustSession(sessionId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;

  const result = await SessionModel.updateOne(
    { _id: new Types.ObjectId(sessionId) },
    { $set: { isTrusted: true } },
  );

  return result.modifiedCount > 0;
}

export async function trustSessionForUser(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
    return false;
  }

  const result = await SessionModel.updateOne(
    { _id: new Types.ObjectId(sessionId), userId: new Types.ObjectId(userId) },
    { $set: { isTrusted: true } },
  );

  return result.modifiedCount > 0;
}

export async function invalidateSessionForUser(
  sessionId: string,
  userId: string,
  reason: string = "user_revoked",
): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
    return false;
  }

  const result = await SessionModel.updateOne(
    {
      _id: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(userId),
      status: SessionStatus.ACTIVE,
    },
    {
      $set: {
        status: SessionStatus.REVOKED,
        revokedAt: new Date(),
        revokedReason: reason,
      },
    },
  );

  return result.modifiedCount > 0;
}

async function enforceSessionLimit(userId: string): Promise<void> {
  const activeSessions = await SessionModel.find({
    userId: new Types.ObjectId(userId),
    status: SessionStatus.ACTIVE,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();

  if (activeSessions.length > MAX_CONCURRENT_SESSIONS) {
    const sessionsToRevoke = activeSessions.slice(MAX_CONCURRENT_SESSIONS);
    const idsToRevoke = sessionsToRevoke.map((s) => s._id);

    await SessionModel.updateMany(
      { _id: { $in: idsToRevoke } },
      {
        $set: {
          status: SessionStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: "session_limit_exceeded",
        },
      },
    );
  }
}

export async function checkSuspiciousActivity(
  userId: string,
  currentIp: string,
  currentGeo: GeoInfo,
): Promise<string[]> {
  const flags: string[] = [];

  const recentSessions = await SessionModel.find({
    userId: new Types.ObjectId(userId),
    status: SessionStatus.ACTIVE,
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (recentSessions.length === 0) return flags;

  const lastSession = recentSessions[0];
  if (lastSession.country && currentGeo.country) {
    if (lastSession.country !== currentGeo.country) {
      flags.push(
        `country_change:${lastSession.country}->${currentGeo.country}`,
      );
    }
  }

  if (lastSession.city && currentGeo.city) {
    const timeDiff = Date.now() - new Date(lastSession.createdAt).getTime();
    const hoursDiff = timeDiff / (1000 * 60 * 60);

    if (lastSession.city !== currentGeo.city && hoursDiff < 1) {
      flags.push(
        `rapid_location_change:${lastSession.city}->${currentGeo.city}`,
      );
    }
  }

  return flags;
}

export async function cleanupExpiredSessions(): Promise<number> {
  const result = await SessionModel.deleteMany({
    $or: [
      { status: SessionStatus.EXPIRED },
      {
        status: SessionStatus.REVOKED,
        revokedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    ],
  });

  return result.deletedCount;
}

export default {
  createSession,
  validateSession,
  validateSessionForUser,
  validateSessionByToken,
  updateSessionActivity,
  invalidateSession,
  invalidateSessionForUser,
  invalidateAllUserSessions,
  getUserActiveSessions,
  trustSession,
  trustSessionForUser,
  checkSuspiciousActivity,
  cleanupExpiredSessions,
};
