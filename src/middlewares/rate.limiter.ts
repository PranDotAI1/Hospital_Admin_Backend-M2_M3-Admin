import rateLimit from "express-rate-limit";

// Limit login attempts: max 5 requests per 15 minutes per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many login attempts. Please try again after 15 minutes.",
    code: 429,
  },
});

// Refresh token limiter: max 100 requests per 15 minutes per IP (supports multiple tabs / hospital NAT IP)
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many token refresh attempts. Please try again later.",
    code: 429,
  },
});

// General API limiter: max 500 requests per 5 minutes per IP
export const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
    code: 429,
  },
});

// OTP generation / verification limiter: max 5 attempts per 15 minutes per IP
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many OTP attempts. Please try again after 15 minutes.",
    code: 429,
  },
});

// Password update / reset limiter: max 5 requests per 15 minutes per IP
export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many password update attempts. Please try again after 15 minutes.",
    code: 429,
  },
});

