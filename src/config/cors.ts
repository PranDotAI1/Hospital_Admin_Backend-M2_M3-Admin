import { CorsOptions } from "cors";
import { NODE_ENV } from "./constant";

const allowedOrigins: string[] = process.env.CORS_URLS
  ? process.env.CORS_URLS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : [];

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
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

export default corsOptions;
