import { CorsOptions } from "cors";
import { NODE_ENV } from "./constant";

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : ["http://localhost:3000", "http://localhost:3001"];

const developmentOrigins: string[] = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
];

const getOrigins = (): string[] => {
  if (NODE_ENV === "production") {
    return allowedOrigins;
  }
  return [...allowedOrigins, ...developmentOrigins];
};

const corsOptions: CorsOptions = {
  origin: getOrigins(),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "Cache-Control",
  ],
  exposedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

export default corsOptions;
