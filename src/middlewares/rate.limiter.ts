import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { getRedisConnection } from "../config/redis";
import type { Request, Response } from "express";

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
// IPv6 normalisation
// ---------------------------------------------------------------------------
// Collapse IPv4-mapped IPv6 addresses (::ffff:1.2.3.4 → 1.2.3.4) so that
// the same client always gets the same rate-limit bucket regardless of
// whether the connection arrives over IPv4 or IPv6.
// ---------------------------------------------------------------------------
function normaliseIp(ip: string | undefined): string {
  if (!ip) return "unknown";
  // Strip IPv4-mapped IPv6 prefix
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  // Localhost IPv6 → IPv4
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

// ---------------------------------------------------------------------------
// Key generators
// ---------------------------------------------------------------------------
// For login & password-reset we key on IP + lowercase username/email so that:
//   • One brute-forcing user doesn't lock out everyone behind the same NAT IP
//   • Attackers can't enumerate usernames across many IPs easily
//
// We normalise IPv6 → IPv4 manually (see normaliseIp) and disable the
// library's built-in IPv6 validation since we handle it ourselves.
// ---------------------------------------------------------------------------
function authKeyGenerator(req: Request, _res: Response): string {
  const ip = normaliseIp(req.ip);
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
  max: 20,
  standardHeaders: true, // Return `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  keyGenerator: authKeyGenerator,
  store: createRedisStore("login"),
  message: rateLimitMessage(15),
  skipSuccessfulRequests: true, // only count failed logins (non-2xx)
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
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
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
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
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
});
