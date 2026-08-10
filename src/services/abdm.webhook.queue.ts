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
  const { ConsentArtefactModel, ConsentArtefactStatus } = await import("../models/ConsentArtefact");
  const { PHRConsentArtefactModel } = await import("../models/PHRConsentArtefact");
  const { ExternalHealthRecordModel } = await import("../models/ExternalHealthRecord");
  const { ConsentRequestModel } = await import("../models/ConsentRequest");
  const { ConsentService } = await import("../services/consent.service");
  const body = data.body;

  if (body.error || !body.consentRequest?.id) return;

  const reqId = body.consentRequest.id;
  const eventTs = body.timestamp ? new Date(body.timestamp) : new Date();
  const statusUpdate: any = { status: body.consentRequest.status || "UNKNOWN", lastCheckedAt: new Date() };
  const broadQuery = { $or: [{ consentRequestId: reqId }, { artefactId: reqId }] };

  if (body.consentRequest.status === "GRANTED") statusUpdate.grantedAt = eventTs;

  const revokeStatuses = ["REVOKED", "EXPIRED", "DENIED"];
  if (revokeStatuses.includes(body.consentRequest.status)) {
    const statusEnum = body.consentRequest.status === "REVOKED" ? ConsentArtefactStatus.REVOKED
      : body.consentRequest.status === "EXPIRED" ? ConsentArtefactStatus.EXPIRED
      : ConsentArtefactStatus.DENIED;
    const setFields: any = { status: statusEnum };
    if (body.consentRequest.status !== "EXPIRED") {
      const tsField = body.consentRequest.status === "REVOKED" ? "revokedAt" : "deniedAt";
      setFields[tsField] = eventTs;
      statusUpdate[tsField] = eventTs;
    }
    await ConsentArtefactModel.updateMany(broadQuery, { $set: setFields });
    await PHRConsentArtefactModel.updateMany(broadQuery, { $set: setFields });
    const affectedIds = await ConsentArtefactModel.distinct("artefactId", broadQuery);
    if (affectedIds.length > 0) {
      await ExternalHealthRecordModel.deleteMany({ consentArtefactId: { $in: affectedIds } });
    }
  }

  const updateResult = await ConsentRequestModel.updateOne(
    {
      $or: [
        { consentRequestId: reqId },
        { requestId: reqId },
        { requestId: body.response?.requestId },
      ],
    },
    { $set: statusUpdate },
  );

  if (body.consentRequest.status === "GRANTED" &&
      body.consentRequest.consentArtefacts?.length > 0 &&
      updateResult.matchedCount > 0) {
  }
}

// Enqueue helpers
export const enqueueConsentNotify = async (
  data: Omit<ConsentNotifyJobData, "type">,
): Promise<string | null> => {
  const queue = getWebhookIngestionQueue();
  const baseKey = data.notification?.consentId || data.notification?.consentRequestId || data.requestId;
  const status = (data.notification?.status || "UNKNOWN").toUpperCase();
  const minuteBucket = Math.floor(Date.now() / 60000);
  const job = await queue.add("consent-notify", { ...data, type: "consent-notify" as const }, {
    jobId: `cn-${baseKey}-${status}-${minuteBucket}`,
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
