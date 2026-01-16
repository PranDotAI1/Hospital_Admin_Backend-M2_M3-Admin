import dotenv from "dotenv";

dotenv.config();

export const NODE_ENV = process.env.NODE_ENV || "development";
export const PORT_STR = process.env.PORT || "3000";
export const SHUTDOWN_TIMEOUT_MS = 15000;
