/**
 * BullMQ queue for ABDM webhook ingestion.
 *
 * Consent callbacks are pushed here instead of processed synchronously.
 * Job types: consent-notify, consent-on-fetch, consent-on-status
 */

import { Queue, Worker, Job } from "bullmq";
import { getBullMQConnectionOpts } from "../config/redis";
import { AbdmLogger } from "../utils/abdm.logger";

const LOG_PREFIX = "[WEBHOOK_QUEUE]";
const WEBHOOK_INGESTION_QUEUE = "abdm-webhook-ingestion";

export interface ConsentNotifyJobData {
  type: "consent-notify";
  notification: any;
  requestId: string;
  callbackAuth?: string;
}

export interface ConsentOnFetchJobData {
  type: "consent-on-fetch";
  body: any;
  paramRequestId?: string;
}

export interface ConsentOnStatusJobData {
  type: "consent-on-status";
  body: any;
}

export type WebhookJobData =
  | ConsentNotifyJobData
  | ConsentOnFetchJobData
  | ConsentOnStatusJobData;

let _webhookQueue: Queue<WebhookJobData> | null = null;

export const getWebhookIngestionQueue = (): Queue<WebhookJobData> => {
  if (!_webhookQueue) {
    _webhookQueue = new Queue<WebhookJobData>(WEBHOOK_INGESTION_QUEUE, {
      connection: getBullMQConnectionOpts(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { age: 3600 * 24, count: 500 },
        removeOnFail: { age: 3600 * 72, count: 1000 },
      },
    });
    console.log(`${LOG_PREFIX} Webhook ingestion queue initialized`);
  }
  return _webhookQueue;
};

let _webhookWorker: Worker<WebhookJobData> | null = null;

export const startWebhookIngestionWorker = (): Worker => {
  if (_webhookWorker) return _webhookWorker;

  getWebhookIngestionQueue();

  _webhookWorker = new Worker<WebhookJobData>(
    WEBHOOK_INGESTION_QUEUE,
    async (job: Job<WebhookJobData>) => {
      const { data } = job;
      switch (data.type) {
        case "consent-notify": {
          const { handleHipNotify } = await import("../services/consent.service");
          await handleHipNotify(data.notification, data.requestId, data.callbackAuth);
          break;
        }
        case "consent-on-fetch": {
          await processConsentOnFetch(data);
          break;
        }
        case "consent-on-status": {
          await processConsentOnStatus(data);
          break;
        }
      }
    },
    {
      connection: getBullMQConnectionOpts(),
      concurrency: 3,
    },
  );

  _webhookWorker.on("completed", (job) => {
  });
  _webhookWorker.on("failed", (job, err) => {
    console.error(`${LOG_PREFIX} Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
  });
  _webhookWorker.on("error", (err) => {
    console.error(`${LOG_PREFIX} Worker error:`, err.message);
  });

  console.log(`${LOG_PREFIX} Webhook ingestion worker started (concurrency=3)`);
  return _webhookWorker;
};

async function processConsentOnFetch(data: ConsentOnFetchJobData) {
  const { processConsentOnFetchCallback } = await import("../services/consent.service");
  await processConsentOnFetchCallback(data.body, data.paramRequestId);
}

async function processConsentOnStatus(data: ConsentOnStatusJobData) {
  // Use the shared implementation from consent.service.ts to avoid
  // duplicated logic that can diverge and cause inconsistent behavior.
  const { processConsentOnStatusCallback } = await import("../services/consent.service");
  await processConsentOnStatusCallback(data.body);
}

// Enqueue helpers
export const enqueueConsentNotify = async (
  data: Omit<ConsentNotifyJobData, "type">,
): Promise<string | null> => {
  const queue = getWebhookIngestionQueue();
  // Use the ABDM requestId as dedup key — it is unique per notification delivery.
  // Previous approach used minuteBucket which caused both duplicate processing
  // (same notification in different minutes) and silent drops (same jobId within a minute).
  const jobId = `cn-${data.requestId}-${Date.now()}`;
  const job = await queue.add("consent-notify", { ...data, type: "consent-notify" as const }, {
    jobId,
  });
  return job.id || null;
};

export const enqueueConsentOnFetch = async (
  data: Omit<ConsentOnFetchJobData, "type">,
): Promise<string | null> => {
  const queue = getWebhookIngestionQueue();
  const consentId = data.body?.consent?.consentDetail?.consentId || data.body?.consent?.id || "unknown";
  const job = await queue.add("consent-on-fetch", { ...data, type: "consent-on-fetch" as const }, {
    jobId: `cof-${consentId}`,
  });
  return job.id || null;
};

export const enqueueConsentOnStatus = async (
  data: Omit<ConsentOnStatusJobData, "type">,
): Promise<string | null> => {
  const queue = getWebhookIngestionQueue();
  const consentReqId = data.body?.consentRequest?.id || "unknown";
  const job = await queue.add("consent-on-status", { ...data, type: "consent-on-status" as const }, {
    jobId: `cos-${consentReqId}`,
  });
  return job.id || null;
};

export const shutdownWebhookQueue = async (): Promise<void> => {
  const promises: Promise<void>[] = [];
  if (_webhookWorker) { promises.push(_webhookWorker.close()); _webhookWorker = null; }
  if (_webhookQueue) { promises.push(_webhookQueue.close()); _webhookQueue = null; }
  await Promise.allSettled(promises);
};
