import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { getBullMQConnectionOpts, getRedisConnection } from "../config/redis";
import type { HealthInfoRequest } from "./health-information.service";

const LOG_PREFIX = "[ABDM_QUEUE]";

// ============================================================================
// Queue Names
// ============================================================================
const HIP_PUSH_QUEUE = "abdm-hip-data-push";
const HIU_TRANSFER_QUEUE = "abdm-hiu-data-transfer";

// ============================================================================
// Job Data Types
// ============================================================================

export interface HipPushJobData {
  request: HealthInfoRequest;
  requestId: string;
  callbackAuth: string;
}

export interface HiuTransferJobData {
  transactionId: string;
  payloadId?: string; // Reference to MongoDB document for large payloads
  entries?: any[];    // Optional, legacy direct payload
  keyMaterial?: any;  // Optional, legacy direct payload
  consentArtefactId?: string;
  pageNumber?: number;
}

// ============================================================================
// Queues (created lazily — safe to import without Redis being up)
// ============================================================================

let _hipPushQueue: Queue<HipPushJobData> | null = null;
let _hiuTransferQueue: Queue<HiuTransferJobData> | null = null;

export const getHipPushQueue = (): Queue<HipPushJobData> => {
  if (!_hipPushQueue) {
    _hipPushQueue = new Queue<HipPushJobData>(HIP_PUSH_QUEUE, {
      connection: getBullMQConnectionOpts(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600 * 24, count: 500 }, // Keep 24h or last 500
        removeOnFail: { age: 3600 * 72, count: 1000 }, // Keep failed 72h for debugging
      },
    });
    console.log(`${LOG_PREFIX} HIP push queue initialized`);
  }
  return _hipPushQueue;
};

export const getHiuTransferQueue = (): Queue<HiuTransferJobData> => {
  if (!_hiuTransferQueue) {
    _hiuTransferQueue = new Queue<HiuTransferJobData>(HIU_TRANSFER_QUEUE, {
      connection: getBullMQConnectionOpts(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 3600 * 24, count: 500 },
        removeOnFail: { age: 3600 * 72, count: 1000 },
      },
    });
    console.log(`${LOG_PREFIX} HIU transfer queue initialized`);
  }
  return _hiuTransferQueue;
};

// ============================================================================
// Redis-based distributed lock (replaces in-memory Set)
// ============================================================================

const LOCK_PREFIX = "abdm:lock:consent:";
const LOCK_TTL_SECONDS = 120; // Must exceed max processing time

// In-memory store of lock values per consentId (for safe release)
const lockValues = new Map<string, string>();

// Lua script for safe lock release: only delete if value matches our process ID
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/**
 * Attempt to acquire a distributed lock for a consent ID.
 * Uses Redis SET NX EX (atomic set-if-not-exists with expiry).
 * Returns true if lock was acquired, false if already held.
 */
export const acquireConsentLock = async (
  consentId: string,
): Promise<boolean> => {
  const redis = getRedisConnection();
  const lockValue = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(
    `${LOCK_PREFIX}${consentId}`,
    lockValue,
    "EX",
    LOCK_TTL_SECONDS,
    "NX",
  );
  if (result === "OK") {
    lockValues.set(consentId, lockValue);
    return true;
  }
  return false;
};

/**
 * Release the distributed lock for a consent ID.
 * Uses Lua script to atomically check-and-delete only if the lock value matches our process ID.
 * This prevents deleting another process's lock if ours expired and they re-acquired it.
 */
export const releaseConsentLock = async (
  consentId: string,
): Promise<void> => {
  const redis = getRedisConnection();
  const lockValue = lockValues.get(consentId);
  if (lockValue) {
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, `${LOCK_PREFIX}${consentId}`, lockValue);
    lockValues.delete(consentId);
  }
};

// ============================================================================
// Redis-based idempotency check
// ============================================================================

const PROCESSED_PREFIX = "abdm:processed:consent:";
const PROCESSED_TTL_SECONDS = 30; // 30 seconds (debounces rapid duplicates but allows manual refreshes)

/**
 * Mark a consent as processed (data transferred).
 * Used to prevent duplicate webhooks with different transactionIds.
 */
export const markConsentProcessed = async (
  consentId: string,
): Promise<void> => {
  const redis = getRedisConnection();
  await redis.set(
    `${PROCESSED_PREFIX}${consentId}`,
    Date.now().toString(),
    "EX",
    PROCESSED_TTL_SECONDS,
  );
};

/**
 * Check if a consent has already been processed.
 * Returns true if already processed (duplicate), false otherwise.
 */
export const isConsentProcessed = async (
  consentId: string,
): Promise<boolean> => {
  const redis = getRedisConnection();
  const result = await redis.get(`${PROCESSED_PREFIX}${consentId}`);
  return result !== null;
};

// ============================================================================
// Redis-based transaction ID bridging (for HIU race condition)
// ============================================================================

const TXN_BRIDGE_PREFIX = "abdm:hiu:txn:";
const TXN_BRIDGE_TTL_SECONDS = 600; // 10 minutes

/**
 * Store the mapping from transactionId → HIU requestId.
 * Called when on-request callback arrives with transactionId.
 */
export const bridgeTransactionId = async (
  transactionId: string,
  requestId: string,
): Promise<void> => {
  const redis = getRedisConnection();
  await redis.set(
    `${TXN_BRIDGE_PREFIX}${transactionId}`,
    requestId,
    "EX",
    TXN_BRIDGE_TTL_SECONDS,
  );
};

/**
 * Look up the HIU requestId for a transactionId.
 * Called when /transfer callback arrives — instant lookup, no retry needed.
 */
export const lookupTransactionBridge = async (
  transactionId: string,
): Promise<string | null> => {
  const redis = getRedisConnection();
  return redis.get(`${TXN_BRIDGE_PREFIX}${transactionId}`);
};

// ============================================================================
// Workers
// ============================================================================

let _hipWorker: Worker | null = null;
let _hiuWorker: Worker | null = null;

/**
 * Start the HIP data push worker.
 * Concurrency = 2: only 2 Puppeteer instances at once (prevents OOM).
 */
export const startHipPushWorker = (): Worker => {
  if (_hipWorker) return _hipWorker;

  _hipWorker = new Worker<HipPushJobData>(
    HIP_PUSH_QUEUE,
    async (job: Job<HipPushJobData>) => {
      const { request, requestId, callbackAuth } = job.data;
      const consentId = request.hiRequest.consent.id;
      // Dynamic import to avoid circular dependencies
      const { default: HealthInformationService } = await import(
        "./health-information.service"
      );

      await HealthInformationService.processHealthInfoRequest(
        request,
        requestId,
        callbackAuth,
      );
    },
    {
      connection: getBullMQConnectionOpts(),
      concurrency: 2, // Max 2 concurrent Puppeteer-based pushes
      // No rate limiter — ABDM spec requires immediate processing of
      // health-information/request. Concurrency cap is sufficient protection.
    },
  );

  _hipWorker.on("completed", (job) => {
  });

  _hipWorker.on("failed", async (job, err) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsUsed = job?.attemptsMade ?? 0;
    const willRetry = attemptsUsed < maxAttempts;

    if (willRetry) {
      console.warn(
        `${LOG_PREFIX} [HIP Worker] Job ${job?.id} failed (attempt ${attemptsUsed}/${maxAttempts}), BullMQ will RETRY: ${err.message}`,
      );
    } else {
      console.error(
        `${LOG_PREFIX} [HIP Worker] Job ${job?.id} PERMANENTLY FAILED after ${attemptsUsed} attempts: ${err.message}`,
      );

      // Per ABDM M2 spec Section 6.3.6: notify ABDM that the transfer FAILED
      // so it can release the consent for future requests.
      if (job?.data) {
        try {
          const { request, requestId, callbackAuth } = job.data;
          const consentId = request.hiRequest.consent.id;
          const transactionId = request.transactionId;
          const { default: HealthInformationService } = await import(
            "./health-information.service"
          );
          await HealthInformationService.sendFailedTransferNotification(
            consentId,
            transactionId,
          );
        } catch (notifyErr: any) {
          console.error(
            `${LOG_PREFIX} [HIP Worker] Failed to send FAILED notification to ABDM:`,
            notifyErr.message,
          );
        }
      }
    }
  });

  _hipWorker.on("error", (err) => {
    console.error(`${LOG_PREFIX} [HIP Worker] Error:`, err.message);
  });

  console.log(
    `${LOG_PREFIX} HIP push worker started (concurrency=2)`,
  );
  return _hipWorker;
};

/**
 * Start the HIU transfer processing worker.
 * Concurrency = 3: decryption is CPU-bound but doesn't use Puppeteer.
 */
export const startHiuTransferWorker = (): Worker => {
  if (_hiuWorker) return _hiuWorker;

  _hiuWorker = new Worker<HiuTransferJobData>(
    HIU_TRANSFER_QUEUE,
    async (job: Job<HiuTransferJobData>) => {
      let { transactionId, entries, keyMaterial, consentArtefactId, payloadId } =
        job.data;

      if (payloadId) {
        const { HIUTransferPayloadModel } = await import(
          "../models/HIUTransferPayload"
        );
        try {
          const payload = await HIUTransferPayloadModel.findById(payloadId);
          if (payload) {
            entries = payload.entries;
            keyMaterial = payload.keyMaterial;
          } else {
            throw new Error(`HIUTransferPayload with ID ${payloadId} not found in DB`);
          }
        } catch (dbErr: any) {
          console.error(`${LOG_PREFIX} [HIU Worker] DB Error loading payloadId ${payloadId}:`, dbErr.message);
          
          // Emergency Fallback: Try reading raw from MongoDB without strict BSON validation
          try {
            const mongoose = (await import("mongoose")).default;
            if (!mongoose.connection.db) {
              throw new Error("Mongoose connection db is not initialized.");
            }
            const rawDoc = await mongoose.connection.db
              .collection("hiu_transfer_payloads")
              .findOne({ _id: new mongoose.Types.ObjectId(payloadId) }, { enableUtf8Validation: false } as any);

            
            if (rawDoc) {
              console.warn(`${LOG_PREFIX} [HIU Worker] SUCCESSFUL RAW READ. Document keys:`, Object.keys(rawDoc));
              // Convert binary or weird strings to safe base64
              entries = rawDoc.entries;
              keyMaterial = rawDoc.keyMaterial;
            } else {
              throw new Error("Not found in raw collection");
            }
          } catch (rawErr: any) {
            console.error(`${LOG_PREFIX} [HIU Worker] Raw fallback also failed:`, rawErr.message);
            throw dbErr;
          }
        }
      }
      const { handleHiuTransfer } = await import("./hiu.service");
      await handleHiuTransfer(
        transactionId,
        entries || [],
        keyMaterial,
        consentArtefactId,
      );
    },
    {
      connection: getBullMQConnectionOpts(),
      concurrency: 3,
    },
  );

  _hiuWorker.on("completed", (job) => {
  });

  _hiuWorker.on("failed", (job, err) => {
    console.error(
      `${LOG_PREFIX} [HIU Worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`,
      err.message,
    );
  });

  _hiuWorker.on("error", (err) => {
    console.error(`${LOG_PREFIX} [HIU Worker] Error:`, err.message);
  });

  console.log(`${LOG_PREFIX} HIU transfer worker started (concurrency=3)`);
  return _hiuWorker;
};

// ============================================================================
// Enqueue helpers (called from controllers/services)
// ============================================================================

/**
 * Enqueue a HIP health data push job.
 * Uses transactionId as jobId — each ABDM request gets a unique transactionId,
 * so updated data pushes (same consent, new transaction) are processed correctly.
 * Rapid duplicates (same transactionId) are still deduped by BullMQ.
 */
export const enqueueHipPush = async (
  data: HipPushJobData,
): Promise<string | null> => {
  const consentId = data.request.hiRequest.consent.id;
  const transactionId = data.request.transactionId;

  // Deduplication is handled by BullMQ's jobId (`hip-${transactionId}`).
  // Each ABDM request has a unique transactionId, so updated data pushes
  // (same consent, new transaction) are always processed.
  // True duplicates (same transactionId arriving twice) are auto-deduped by BullMQ.

  const queue = getHipPushQueue();
  const job = await queue.add("hip-push", data, {
    jobId: `hip-${transactionId}`, // Dedup by transactionId (unique per ABDM request)
    priority: 2,
    // ── GUARANTEED DELIVERY ──
    // If processHealthInfoRequest throws TransientDataPushError (gateway not ready,
    // 5xx, network issues), BullMQ retries the entire job with exponential backoff.
    // Backoff schedule: 30s → 60s → 120s → 240s → 480s (~15 min total coverage).
    // This ensures we never permanently lose a data transfer due to gateway lag.
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 30_000, // 30s base delay
    },
    removeOnComplete: { age: 3600 },      // Clean up completed jobs after 1 hour
    removeOnFail: { age: 7 * 86400 },     // Keep failed jobs for 7 days (audit trail)
  });
  return job.id || null;
};

/**
 * Enqueue a HIU transfer processing job.
 * Uses transactionId as jobId for deduplication.
 */
export const enqueueHiuTransfer = async (
  data: HiuTransferJobData,
): Promise<string | null> => {
  const queue = getHiuTransferQueue();
  // Job key: use payloadId when available (unique per transfer callback).
  // ABDM sends multiple transfer callbacks with DIFFERENT care context entries
  // but the SAME transactionId and pageNumber=0. Each callback saves a unique
  // HIUTransferPayload document, so payloadId distinguishes them.
  // Data-level dedup is handled by the unique index on ExternalHealthRecord.
  const jobKey = data.payloadId
    ? `hiu-${data.transactionId}-${data.payloadId}`
    : `hiu-${data.transactionId}-p${data.pageNumber ?? 0}`;
  const job = await queue.add("hiu-transfer", data, {
    jobId: jobKey,
    priority: 1, // HIU transfers are higher priority (already received data)
  });
  return job.id || null;
};

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Initialize all workers. Call once on server startup.
 */
export const initializeWorkers = (): void => {
  getHipPushQueue();
  getHiuTransferQueue();

  startHipPushWorker();
  startHiuTransferWorker();

  // Start webhook ingestion worker (consent callbacks)
  try {
    const { startWebhookIngestionWorker } = require("./abdm.webhook.queue");
    startWebhookIngestionWorker();
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Failed to start webhook ingestion worker:`, err.message);
  }

  console.log(`${LOG_PREFIX} All ABDM workers initialized`);
};

/**
 * Gracefully close all queues and workers. Call on SIGTERM/SIGINT.
 */
export const shutdownQueues = async (): Promise<void> => {
  const closePromises: Promise<void>[] = [];

  if (_hipWorker) {
    closePromises.push(_hipWorker.close());
    _hipWorker = null;
  }
  if (_hiuWorker) {
    closePromises.push(_hiuWorker.close());
    _hiuWorker = null;
  }
  if (_hipPushQueue) {
    closePromises.push(_hipPushQueue.close());
    _hipPushQueue = null;
  }
  if (_hiuTransferQueue) {
    closePromises.push(_hiuTransferQueue.close());
    _hiuTransferQueue = null;
  }

  // Shutdown webhook ingestion queue
  try {
    const { shutdownWebhookQueue } = require("./abdm.webhook.queue");
    closePromises.push(shutdownWebhookQueue());
  } catch (_) {}

  await Promise.allSettled(closePromises);
};
