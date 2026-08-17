import { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const LOG_PREFIX = "[WEBHOOK_AUTH]";
const ABDM_CALLBACK_PREFIXES = [
  "/api/v3/hip/",
  "/api/v3/hiu/",
  "/api/v3/consent/",
  "/api/v3/care-contexts/",
  "/api/v3/links/",
  "/api/v3/patients/sms/",
  "/api/v3/patient/care-context/",
  "/v0.5/patients/sms/",
];

const client = jwksClient({
  jwksUri: process.env.ABDM_JWKS_URI || "https://dev.abdm.gov.in/gateway/v0.5/certs",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 60 * 1000 // 10 hours
});

const verifyAbdmJwt = async (token: string): Promise<boolean> => {
  try {
    const tokenString = token.replace(/^bearer\s+/i, "");
    const decoded = jwt.decode(tokenString, { complete: true });
    
    if (!decoded || !decoded.header || !decoded.header.kid) {
      console.warn(`${LOG_PREFIX} JWT missing kid in header`);
      return false;
    }
    
    const key = await client.getSigningKey(decoded.header.kid);
    const signingKey = key.getPublicKey();
    
    jwt.verify(tokenString, signingKey);
    return true;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} JWT verification failed:`, err.message);
    return false;
  }
};

const isAbdmCallbackPath = (path: string): boolean =>
  ABDM_CALLBACK_PREFIXES.some((prefix) => path.startsWith(prefix));

const parseAbdmTimestamp = (ts: string): number => {
  const trimmed = ts.trim();
  if (
    !trimmed.endsWith("Z") &&
    !trimmed.includes("+") &&
    !/T\d{2}:\d{2}:\d{2}.*-/.test(trimmed)
  ) {
    const iso = trimmed.replace(" ", "T") + "Z";
    return new Date(iso).getTime();
  }
  return new Date(trimmed).getTime();
};

export const validateAbdmWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!isAbdmCallbackPath(req.path)) {
    next();
    return;
  }

  const authHeader =
    req.headers["authorization"] || req.headers["Authorization"];
  const requestId =
    req.headers["request-id"] || req.headers["REQUEST-ID"] || "";
  const timestamp =
    req.headers["timestamp"] || req.headers["TIMESTAMP"] || "";

  let jwtVerified = false;

  if (!authHeader) {
    console.warn(
      `${LOG_PREFIX} Missing Authorization header on ${req.method} ${req.path}`,
    );
    const isDataTransfer = req.path.includes("/hiu/health-information/transfer");
    if (!isDataTransfer && (process.env.NODE_ENV === "production" || process.env.ENFORCE_ABDM_JWT === "true")) {
      res.status(401).json({
        error: { code: 1401, message: "Missing Authorization header" },
      });
      return;
    }
  } else {
    const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!authStr.startsWith("Bearer ") && !authStr.startsWith("bearer ")) {
      console.warn(
        `${LOG_PREFIX} Authorization header is not a Bearer token on ${req.path}`,
      );
    } else {
      const isValid = await verifyAbdmJwt(authStr);
      if (!isValid) {
        console.error(`${LOG_PREFIX} Invalid JWT signature on ${req.path}`);
        if (process.env.NODE_ENV === "production" || process.env.ENFORCE_ABDM_JWT === "true") {
          res.status(401).json({
            error: { code: 1401, message: "Invalid Authorization token signature" },
          });
          return;
        }
      } else {
        jwtVerified = true;
      }
    }
  }

  if (!requestId) {
  }

  if (timestamp) {
    const requestTime = parseAbdmTimestamp(timestamp as string);
    const now = Date.now();
    const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

    if (!isNaN(requestTime) && Math.abs(now - requestTime) > MAX_AGE_MS) {
      console.warn(
        `${LOG_PREFIX} Stale TIMESTAMP on ${req.path}: ${timestamp} (${Math.round(Math.abs(now - requestTime) / 1000)}s drift)`,
      );
      const HARD_BLOCK_MS = 30 * 60 * 1000;
      if (
        process.env.NODE_ENV === "production" &&
        Math.abs(now - requestTime) > HARD_BLOCK_MS
      ) {
        res.status(400).json({
          error: {
            code: 1400,
            message: "Request timestamp is stale (>30 minutes)",
          },
        });
        return;
      }
    }
  }

  (req as any).abdmAuth = {
    token: authHeader || null,
    requestId: requestId || null,
    timestamp: timestamp || null,
    isAuthenticated: jwtVerified,
  };

  next();
};

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 1429,
      message: "Too many webhook requests. Please slow down.",
    },
  },
});
