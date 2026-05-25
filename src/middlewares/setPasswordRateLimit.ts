import { Request, Response, NextFunction } from "express";
import { apiResponse } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { SET_PASSWORD_RATE_LIMIT } from "../utils/constant";

/**
 * In-memory store for set-password rate limiting by IP.
 * For production at scale, use Redis or similar.
 */
interface WindowEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, WindowEntry>();
const WINDOW_MS =
  SET_PASSWORD_RATE_LIMIT.WINDOW_MINUTES * 60 * 1000;
const MAX = SET_PASSWORD_RATE_LIMIT.MAX_ATTEMPTS;

const prune = (): void => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) store.delete(key);
  }
};

/** Run prune every 5 minutes to avoid unbounded growth */
setInterval(prune, 5 * 60 * 1000);

const getClientIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  return req.socket?.remoteAddress ?? req.ip ?? "unknown";
};

/**
 * Rate limit middleware for POST /doctors/set-password.
 * Limits attempts per IP to prevent brute force and token guessing.
 */
export const setPasswordRateLimit = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const ip = getClientIp(req);
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry) {
    entry = { count: 1, windowStart: now };
    store.set(ip, entry);
    return next();
  }

  if (now - entry.windowStart > WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
    store.set(ip, entry);
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX) {
    apiResponse(
      res,
      { message: "Too many attempts. Please try again later." },
      STATUS_CODE.BAD_REQUEST,
    );
    return;
  }
  next();
};
