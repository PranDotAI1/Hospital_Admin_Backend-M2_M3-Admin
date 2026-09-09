import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import logger from "morgan";
import path from "path";
import "tsconfig-paths/register";
import dotenv from "dotenv";

dotenv.config();

import { connectDB } from "./config/db";
import indexRouter from "./routes/index";
import usersRouter from "./routes/users";
import V2router from "./routes/v2";
import v3router from "./routes/v3";
import webook from "./routes/webhook";
import V4router from "./routes/v4";
import { proxyRequest } from "./controllers/proxy.controller";
import { apiLimiter } from "./middlewares/rate.limiter";
import { csrfProtection } from "./middlewares/csrf.protection";
import { version } from "os";

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["http://localhost:3000", "http://localhost:3001"];

// Trust proxy configuration for correct client-IP detection behind reverse
// proxies (ALB, Nginx, Cloudflare, etc.).  Without this, express-rate-limit
// sees the proxy's IP and rate-limits ALL users as a single client.
//
// TRUST_PROXY values:
//   "false" / "0"  → disabled (direct-facing server, no proxy)
//   "true"  / "1"  → trust 1 hop (single ALB / Nginx)
//   "<number>"     → trust N hops (e.g. Cloudflare → ALB → app = 2)
//   "loopback"     → trust loopback addresses only
//
// Default: enabled in production (1 hop), disabled in development.
const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === "production" ? "1" : "false");
if (trustProxy === "false" || trustProxy === "0") {
  app.set("trust proxy", false);
} else if (/^\d+$/.test(trustProxy)) {
  app.set("trust proxy", parseInt(trustProxy, 10));
} else {
  app.set("trust proxy", trustProxy); // "loopback", "linklocal", "uniquelocal", or CIDR
}

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
    ],
    exposedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
    maxAge: 86400,
    preflightContinue: false,
  }),
);

app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "jade");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: {
      action: "deny",
    },
    noSniff: true,
    referrerPolicy: {
      policy: "strict-origin-when-cross-origin",
    },
    permittedCrossDomainPolicies: {
      permittedPolicies: "none",
    },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Enforce Permissions-Policy header for privacy compliance
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), payment=()",
  );
  next();
});

app.use(compression());
app.use(logger(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(csrfProtection);
app.use(express.static(path.join(__dirname, "../public")));

connectDB()
  .then(() => {
    console.log("Database connected successfully vie app");
  })
  .catch((error) => {
    console.error("Database connection failed:", error.message);
  });

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "1.0.1",
  });
});

// URL FOR RECEVIED THE DATA
app.use("/", webook);

// Use the v3 router for version 3 API routes
app.use("/api/v3", v3router);

// Use the v2 router for version 2 API routes
app.use("/api/v2", V2router);

// Use the v4 router for version 2 API routes
app.use("/api/v4", V4router);

// ALL OTHERS ROUTES
app.use("/api", apiLimiter, indexRouter);
app.use("/api/users", usersRouter);

// this is for  dev purpose only - @harshithreddy
if (process.env.NODE_ENV === "development") {
  app.all("/proxy/*", proxyRequest);
}

app.use((_req: Request, res: Response) => {
  res.status(404).json({ status: "error", message: "Not Found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[UNHANDLED_ERROR]", err.message, err.stack);
  const statusCode = (err as any).statusCode || 500;
  res.status(statusCode).json({
    status: "error",
    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

export default app;
