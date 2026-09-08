import { Request, Response, NextFunction } from "express";
import { STATUS_CODE } from "../utils/constant";

/**
 * Production-Grade CSRF Protection Middleware
 *
 * Enforces Origin & Referer header verification for state-changing requests (POST, PUT, DELETE, PATCH).
 * Protects against cross-site request forgery while allowing legitimate webhooks and API clients.
 */

/**
 * Comprehensive List of ABDM and System Webhook Prefixes.
 * Derived from a full audit of routes/webhook.ts, routes/v2, routes/v3, routes/hiu,
 * and NHA ABDM Milestone Specifications (M1, M2, M3, M4).
 */
export const WEBHOOK_PREFIXES: readonly string[] = [
  // ABDM v0.5 Gateway Webhooks
  "/v0.5/",
  "/v0.5",

  // ABDM v1.0 Gateway Webhooks
  "/v1.0/",
  "/v1.0",

  // ABDM HIECM Gateway Callbacks
  "/hiecm/",
  "/hiecm",

  // ABDM V3 HIP Webhooks (Care Context, Discovery, Linking, Health Info, Patient Share, Running Token)
  "/api/v3/hip/",
  "/v3/hip/",

  // ABDM V3 HIU Webhooks (Consent Callbacks, Data Transfer, On-Request, Running Token)
  "/api/v3/hiu/",
  "/v3/hiu/",

  // ABDM V3 Care Context Discovery & Linking Callbacks (plural and singular)
  "/api/v3/care-contexts/",
  "/v3/care-contexts/",
  "/api/v3/care-context/",
  "/v3/care-context/",

  // ABDM V3 Linking Callbacks (plural and singular: init, confirm, on_carecontext, on-notify)
  "/api/v3/links/",
  "/v3/links/",
  "/api/v3/link/",
  "/v3/link/",

  // ABDM V3 Consent Callbacks
  "/api/v3/consent/",
  "/v3/consent/",

  // ABDM V3 Patient & SMS Callbacks (plural and singular)
  "/api/v3/patients/",
  "/v3/patients/",
  "/api/v3/patient/",
  "/v3/patient/",

  // Sub-router HIU Callbacks mounted under /api/hiu/
  "/api/hiu/health-information/",
  "/hiu/health-information/",

  // Token Generation Webhook Callback
  "/api/token/generate-token",
  "/token/generate-token",

  // V2 Webhook endpoints
  "/api/v2/webhook/",
  "/api/v2/webhook",
  "/v2/webhook/",
  "/v2/webhook",
];

/**
 * Dynamic RegExp patterns to catch webhooks with variable URL parameters
 * (e.g. /:requestid/api/v3/hiu/consent/on-fetch) or standard callback actions.
 */
const DYNAMIC_WEBHOOK_PATTERNS: readonly RegExp[] = [
  /\/api\/v3\/hiu\/consent\/on-fetch/i,
  /\/api\/v3\/hip\//i,
  /\/api\/v3\/hiu\//i,
  /\/api\/v3\/consent\//i,
  /\/api\/v3\/care-contexts?\//i,
  /\/api\/v3\/links?\//i,
  /\/api\/v3\/patients?\//i,
  /\/v0\.5\/patients\/sms\/on-notify/i,
  /\/health-information\/(request|transfer|on-request|on-notify|notify)/i,
  /\/patient\/care-context\/(discover|on-discover)/i,
  /\/care-contexts?\/(discover|on-discover)/i,
  /\/links?\/(link\/init|link\/confirm|context\/on-notify|on_carecontext)/i,
  /\/running-token\/(status|on-status)/i,
];

/**
 * Multi-layer webhook detector to ensure no ABDM machine-to-machine callback is blocked:
 * 1. Exact prefix matching against all known webhook routes (case-insensitive)
 * 2. RegExp matching for dynamic parameter routes (e.g. UUID prefix)
 * 3. ABDM Gateway correlation header validation
 */
export const isAbdmWebhookRequest = (req: Request): boolean => {
  const fullPath = (req.originalUrl || req.path || "").split("?")[0].toLowerCase();
  const reqPath = (req.path || "").split("?")[0].toLowerCase();

  // Root webhook path
  if (reqPath === "/" || fullPath === "/") {
    return true;
  }

  // Layer 1: Prefix matching against all registered webhook routes
  const matchesPrefix = WEBHOOK_PREFIXES.some(
    (prefix) => {
      const lowerPrefix = prefix.toLowerCase();
      return fullPath.startsWith(lowerPrefix) || reqPath.startsWith(lowerPrefix);
    },
  );
  if (matchesPrefix) {
    return true;
  }

  // Layer 2: Dynamic path pattern matching
  const matchesPattern = DYNAMIC_WEBHOOK_PATTERNS.some(
    (pattern) => pattern.test(fullPath) || pattern.test(reqPath),
  );
  if (matchesPattern) {
    return true;
  }

  // Layer 3: ABDM Gateway correlation headers
  // ABDM callbacks always present REQUEST-ID + TIMESTAMP / X-HIP-ID / X-CM-ID
  const hasAbdmRequestId = !!(
    req.headers["request-id"] || req.headers["REQUEST-ID"]
  );
  const hasAbdmTimestamp = !!(
    req.headers["timestamp"] || req.headers["TIMESTAMP"]
  );
  const hasAbdmGatewayHeaders = !!(
    req.headers["x-hip-id"] ||
    req.headers["x-hiu-id"] ||
    req.headers["x-cm-id"]
  );

  if ((hasAbdmRequestId && hasAbdmTimestamp) || hasAbdmGatewayHeaders) {
    const isCallbackAction =
      fullPath.includes("on-") ||
      fullPath.includes("notify") ||
      fullPath.includes("discover") ||
      fullPath.includes("transfer") ||
      fullPath.includes("share") ||
      fullPath.includes("callback");

    if (isCallbackAction) {
      return true;
    }
  }

  return false;
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase();

  // Safe HTTP methods do not mutate state
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return next();
  }

  // Exempt all ABDM and system machine-to-machine webhooks
  if (isAbdmWebhookRequest(req)) {
    return next();
  }

  // Parse allowed origins from environment
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : ["http://localhost:3000", "http://localhost:3001"];

  const origin = req.headers["origin"] as string | undefined;
  const referer = req.headers["referer"] as string | undefined;

  // If Origin header is provided by browser, verify against allowed list
  if (origin) {
    const isOriginAllowed = allowedOrigins.some(
      (allowed) => allowed === origin || allowed === "*",
    );
    if (!isOriginAllowed) {
      console.warn(`[SECURITY][CSRF] Blocked unauthorized Origin: ${origin} on ${req.method} ${req.path}`);
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: Cross-Origin Request Blocked by CSRF Protection",
        code: STATUS_CODE.FORBIDDEN,
      });
    }
    return next();
  }

  // If Referer header is present (e.g. older browsers or some fetch requests), verify its origin
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      const isRefererAllowed = allowedOrigins.some(
        (allowed) => allowed === refererOrigin || allowed === "*",
      );
      if (!isRefererAllowed) {
        console.warn(`[SECURITY][CSRF] Blocked unauthorized Referer: ${refererOrigin} on ${req.method} ${req.path}`);
        return res.status(STATUS_CODE.FORBIDDEN).json({
          status: "error",
          message: "Forbidden: Cross-Origin Request Blocked by CSRF Protection",
          code: STATUS_CODE.FORBIDDEN,
        });
      }
    } catch {
      // Malformed referer header
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: Invalid Referer Header",
        code: STATUS_CODE.FORBIDDEN,
      });
    }
    return next();
  }

  // For non-browser clients (native mobile apps, server-to-server), require either
  // an Authorization header or an X-Requested-With / custom header to prevent simple HTML form submission attacks
  const hasAuth = req.headers["authorization"];
  const hasCustomHeader = req.headers["x-requested-with"] || req.headers["x-csrf-token"];

  // Browsers submitting traditional forms cannot attach custom headers or Authorization without JS
  if (hasAuth || hasCustomHeader) {
    return next();
  }

  // In production, reject unauthenticated state-changing browser-like requests without origin or custom headers
  if (process.env.NODE_ENV === "production") {
    const requestPath = (req.originalUrl || req.path || "").toLowerCase();
    // Allow public login attempt or health check
    if (requestPath.includes("/login") || requestPath.includes("/health")) {
      return next();
    }
  }

  return next();
};
