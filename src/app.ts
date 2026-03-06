import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
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

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["http://localhost:3000", "http://localhost:3001"];

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

app.use(compression());
app.use(logger("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "../public")));

connectDB()
  .then(() => {
    console.log("Database connected successfully vie app");
  })
  .catch((error) => {
    console.error("Database connection failed:", error.message);
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

app.use((req: Request, res: Response, next: NextFunction) => {
  const err = new Error("Not Found");
  res.status(404).send(err.message);
});

export default app;
