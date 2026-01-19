import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import logger from "morgan";
import path from "path";
import "tsconfig-paths/register";

import corsOptions from "./config/cors";
import { connectDB } from "./config/db";
import indexRouter from "./routes/index";
import usersRouter from "./routes/users";
import V2router from "./routes/v2";
import v3router from "./routes/v3";
import webook from "./routes/webhook";
import V4router from "./routes/v4";

const app = express();

app.use(cors(corsOptions));

app.set("views", path.join(__dirname, "../views"));
app.set("view engine", "jade");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
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
app.use("/api", indexRouter);
app.use("/api/users", usersRouter);

app.use((req: Request, res: Response, next: NextFunction) => {
  const err = new Error("Not Found");
  res.status(404).send(err.message);
});

export default app;
