import { Queue, Worker, Job, QueueEvents } from "bullmq";
import { createBullMQConnection, getRedisConnection } from "../config/redis";
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
  entries: any[];
  keyMaterial: any;
  consentArtefactId?: string;
}

// ============================================================================
// Queues (created lazily — safe to import without Redis being up)
// ============================================================================

let _hipPushQueue: Queue<HipPushJobData> | null = null;
let _hiuTransferQueue: Queue<HiuTransferJobData> | null = null;

export const getHipPushQueue = (): Queue<HipPushJobData> => {
  if (!_hipPushQueue) {
    _hipPushQueue = new Queue<HipPushJobData>(HIP_PUSH_QUEUE, {
      connection: createBullMQConnection(),
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
      connection: createBullMQConnection(),
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

/**
 * Attempt to acquire a distributed lock for a consent ID.
 * Uses Redis SET NX EX (atomic set-if-not-exists with expiry).
 * Returns true if lock was acquired, false if already held.
 */
export const acquireConsentLock = async (
  consentId: string,
): Promise<boolean> => {
  const redis = getRedisConnection();
  const result = await redis.set(
    `${LOCK_PREFIX}${consentId}`,
    Date.now().toString(),
    "EX",
    LOCK_TTL_SECONDS,
    "NX",
  );
  return result === "OK";
};

/**
 * Release the distributed lock for a consent ID.
 */
export const releaseConsentLock = async (
  consentId: string,
): Promise<void> => {
  const redis = getRedisConnection();
  await redis.del(`${LOCK_PREFIX}${consentId}`);
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

      console.log(
        `${LOG_PREFIX} [HIP Worker] Processing job ${job.id} for consent: ${consentId}, attempt: ${job.attemptsMade + 1}`,
      );

      // Dynamic import to avoid circular dependencies
      const { default: HealthInformationService } = await import(
        "./health-information.service"
      );

      await HealthInformationService.processHealthInfoRequest(
        request,
        requestId,
        callbackAuth,
      );

      console.log(
        `${LOG_PREFIX} [HIP Worker] Job ${job.id} completed for consent: ${consentId}`,
      );
    },
    {
      connection: createBullMQConnection(),
      concurrency: 2, // Max 2 concurrent Puppeteer-based pushes
      limiter: {
        max: 10, // Max 10 jobs
        duration: 60000, // Per minute (ABDM rate limiting safety)
      },
    },
  );

  _hipWorker.on("completed", (job) => {
    console.log(`${LOG_PREFIX} [HIP Worker] Job ${job.id} completed`);
  });

  _hipWorker.on("failed", (job, err) => {
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
    }
  });

  _hipWorker.on("error", (err) => {
    console.error(`${LOG_PREFIX} [HIP Worker] Error:`, err.message);
  });

  console.log(
    `${LOG_PREFIX} HIP push worker started (concurrency=2, rate=10/min)`,
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
      const { transactionId, entries, keyMaterial, consentArtefactId } =
        job.data;

      console.log(
        `${LOG_PREFIX} [HIU Worker] Processing job ${job.id} for transaction: ${transactionId}, entries: ${entries.length}`,
      );

      const { handleHiuTransfer } = await import("./hiu.service");
      await handleHiuTransfer(
        transactionId,
        entries,
        keyMaterial,
        consentArtefactId,
      );

      console.log(
        `${LOG_PREFIX} [HIU Worker] Job ${job.id} completed for transaction: ${transactionId}`,
      );
    },
    {
      connection: createBullMQConnection(),
      concurrency: 3,
    },
  );

  _hiuWorker.on("completed", (job) => {
    console.log(`${LOG_PREFIX} [HIU Worker] Job ${job.id} completed`);
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

  console.log(
    `${LOG_PREFIX} Enqueued HIP push job ${job.id} for consent: ${consentId}, txn: ${transactionId}`,
  );
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
  const job = await queue.add("hiu-transfer", data, {
    jobId: `hiu-${data.transactionId}`, // Dedup by transactionId
    priority: 1, // HIU transfers are higher priority (already received data)
  });

  console.log(
    `${LOG_PREFIX} Enqueued HIU transfer job ${job.id} for txn: ${data.transactionId}`,
  );
  return job.id || null;
};

// ============================================================================
// Lifecycle
// ============================================================================

/**
 * Initialize all workers. Call once on server startup.
 */
export const initializeWorkers = (): void => {
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
  console.log(`${LOG_PREFIX} Shutting down queues and workers...`);

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
  console.log(`${LOG_PREFIX} All queues and workers shut down`);
};
