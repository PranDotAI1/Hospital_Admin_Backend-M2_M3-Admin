import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedisConnection } from "../config/redis";
import type { Request } from "express";

// ---------------------------------------------------------------------------
// Redis-backed store factory
// ---------------------------------------------------------------------------
// Uses the existing ioredis connection so rate-limit counters survive restarts
// and are shared across multiple Node processes (cluster / PM2).
// Falls back to the built-in in-memory store if Redis is unreachable during
// startup (a warning is logged).
// ---------------------------------------------------------------------------
function createRedisStore(prefix: string) {
  try {
    const client = getRedisConnection();
    return new RedisStore({
      // Use ioredis `call` method; rate-limit-redis expects a sendCommand fn
      sendCommand: (...args: string[]) =>
        client.call(args[0], ...args.slice(1)) as never,
      prefix: `rl:${prefix}:`,
    });
  } catch (err) {
    console.warn(
      `[RATE_LIMIT] Redis unavailable for "${prefix}" limiter – falling back to in-memory store. Error: ${(err as Error).message}`,
    );
    return undefined; // express-rate-limit defaults to MemoryStore
  }
}

// ---------------------------------------------------------------------------
// Key generators
// ---------------------------------------------------------------------------
// For login & password-reset we key on IP + lowercase username/email so that:
//   • One brute-forcing user doesn't lock out everyone behind the same NAT IP
//   • Attackers can't enumerate usernames across many IPs easily
// ---------------------------------------------------------------------------
function authKeyGenerator(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  // Login sends `username` or `email` in the body
  const identity = (
    (req.body?.username || req.body?.email || req.body?.phone || "") as string
  )
    .toLowerCase()
    .trim();
  return identity ? `${ip}:${identity}` : ip;
}

// ---------------------------------------------------------------------------
// Shared response builder
// ---------------------------------------------------------------------------
function rateLimitMessage(retryMinutes: number) {
  return {
    status: "error",
    message: `Too many requests. Please try again after ${retryMinutes} minutes.`,
    code: 429,
  };
}

// ---------------------------------------------------------------------------
// 1. Login limiter
//    Per IP+username: 10 attempts / 15 min
//    Prevents brute-force while allowing multiple staff on the same hospital
//    NAT IP to log in independently.
// ---------------------------------------------------------------------------
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true, // Return `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator: authKeyGenerator,
  store: createRedisStore("login"),
  message: rateLimitMessage(15),
  skipSuccessfulRequests: true, // only count failed logins (non-2xx)
});

// ---------------------------------------------------------------------------
// 2. Refresh-token limiter
//    Per IP: 200 req / 15 min
//    Generous limit – multiple browser tabs, mobile apps, and hospital
//    workstations behind a single NAT all share the same IP.
// ---------------------------------------------------------------------------
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore("refresh"),
  message: rateLimitMessage(15),
});

// ---------------------------------------------------------------------------
// 3. General API limiter (applied to /api/* in app.ts)
//    Per IP: 1000 req / 5 min
//    Hospital admins hit many endpoints rapidly (patient lists, billing,
//    reports). 500 was too aggressive for SPAs that preflight + fetch.
// ---------------------------------------------------------------------------
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRedisStore("api"),
  message: rateLimitMessage(5),
});

// ---------------------------------------------------------------------------
// 4. OTP limiter
//    Per IP+identifier: 5 req / 15 min
// ---------------------------------------------------------------------------
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
  store: createRedisStore("otp"),
  message: {
    status: "error",
    message: "Too many OTP attempts. Please try again after 15 minutes.",
    code: 429,
  },
});

// ---------------------------------------------------------------------------
// 5. Password reset limiter
//    Per IP+email: 10 req / 15 min
// ---------------------------------------------------------------------------
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
  store: createRedisStore("pwd-reset"),
  message: {
    status: "error",
    message:
      "Too many password reset attempts. Please try again after 15 minutes.",
    code: 429,
  },
});
