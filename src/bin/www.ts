import "dotenv/config";
import http from "http"; // Ensure you import the 'http' module
import app from "../app";
import {
  setBridgeUrlOnStartup,
  purgeRevokedExternalRecords,
  startDataErasureCron,
} from "../services/startup.service";


const PORT: string | number = process.env.PORT || 4000;

const port = normalizePort(PORT);
app.set("port", port);

const server = http.createServer(app);

server.listen(port);
server.on("error", onError);
server.on("listening", onListening);

function normalizePort(val: string | number): number | string | boolean {
  const port = typeof val === "string" ? parseInt(val, 10) : val;
  if (isNaN(port)) return val; // Named pipe
  if (port >= 0) return port; // Port number
  return false;
}

function onError(error: NodeJS.ErrnoException): void {
  if (error.syscall !== "listen") throw error;

  const bind = typeof port === "string" ? `Pipe ${port}` : `Port ${port}`;

  switch (error.code) {
    case "EACCES":
      console.error(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case "EADDRINUSE":
      console.error(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

function onListening(): void {
  const addr = server.address();
  if (!addr) {
    console.error("Failed to retrieve server address");
    return;
  }
  const bind = typeof addr === "string" ? `pipe ${addr}` : `port ${addr.port}`;
  // Automatically configure the ABDM bridge URL on every server start
  setBridgeUrlOnStartup();

  // Purge any external health records left behind by missed revocation callbacks
  purgeRevokedExternalRecords();
  
  // Start the background cron to delete expired health data
  startDataErasureCron();

  try {
    const { initializeWorkers } = require("../services/abdm.queue.service");
    initializeWorkers();
    console.log("[STARTUP] BullMQ workers initialized");
  } catch (err: any) {
    console.warn(
      `[STARTUP] BullMQ workers not started (Redis may be unavailable): ${err.message}`,
    );
    console.warn(
      "[STARTUP] ABDM processing will use direct (inline) mode as fallback",
    );
  }
}

async function gracefulShutdown(signal: string): Promise<void> {
  server.close(() => {
    console.log("HTTP server closed.");
  });

  try {
    const { shutdownQueues } = require("../services/abdm.queue.service");
    await shutdownQueues();
  } catch (_) {}

  try {
    const { closeRedisConnections } = require("../config/redis");
    await closeRedisConnections();
    console.log("Redis connections closed.");
  } catch (_) {}

  const timeout = setTimeout(() => {
    console.error("Forced shutdown — timed out after 15s");
    process.exit(1);
  }, 15_000);
  timeout.unref();
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGUSR2", () => {
  gracefulShutdown("SIGUSR2").then(() => {
    process.kill(process.pid, "SIGUSR2");
  });
});
