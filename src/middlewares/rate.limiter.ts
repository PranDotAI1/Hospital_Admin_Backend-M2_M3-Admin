import rateLimit from "express-rate-limit";

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

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "error",
    message: "Too many requests. Please try again later.",
    code: 429,
  },
});
