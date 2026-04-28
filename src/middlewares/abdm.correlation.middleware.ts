/**
 * Correlation Validation Middleware for ABDM Webhooks.
 *
 * Runs AFTER abdm.webhook.auth but BEFORE route handlers.
 * For artefact-producing routes:
 * 1. Validates payload schema (Zod)
 * 2. Classifies the event type
 * 3. Checks correlation: ensures consentId/requestId matches a known consent
 * 4. If no match → logs to UnmatchedEvent, responds 200 (ABDM expects 200)
 * 5. Attaches validated + typed payload to req.abdmPayload
 *
 * Non-artefact routes pass through untouched.
 */

import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  HealthInformationRequestSchema,
  ConsentNotifySchema,
  HiuTransferSchema,
} from "../schemas/abdm.webhook.schemas";
import {
  classifyWebhookEvent,
  AbdmEventType,
  isArtefactProducingEvent,
} from "../services/abdm.event.handler";
import {
  UnmatchedEventModel,
  UnmatchedEventReason,
} from "../models/UnmatchedEvent";
import { ConsentRequestModel } from "../models/ConsentRequest";
import { ConsentArtefactModel } from "../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../models/PHRConsentArtefact";
import { AbdmLogger } from "../utils/abdm.logger";

const LOG_PREFIX = "[CORRELATION]";

/** Route paths that require full correlation validation */
const VALIDATED_PATHS = [
  "/api/v3/hip/health-information/request",
  "/api/v3/consent/request/hip/notify",
  "/api/v3/hiu/consent/request/notify",
  "/api/v3/hiu/consent/request/on-notify",
  "/api/v3/hiu/health-information/transfer",
];

/** Check if a route needs correlation validation */
const needsCorrelationValidation = (path: string): boolean =>
  VALIDATED_PATHS.some((vp) => path.includes(vp.replace("/api/v3", "")));

/** Extract safe metadata from payload for logging (no PHI) */
const extractSafePayloadMeta = (body: any): Record<string, any> => {
  const meta: Record<string, any> = {};
  if (body?.requestId) meta.requestId = body.requestId;
  if (body?.transactionId) meta.transactionId = body.transactionId;
  if (body?.timestamp) meta.timestamp = body.timestamp;
  if (body?.hiRequest?.consent?.id) meta.consentId = body.hiRequest.consent.id;
  if (body?.notification?.status) meta.status = body.notification.status;
  if (body?.notification?.consentRequestId)
    meta.consentRequestId = body.notification.consentRequestId;
  if (body?.notification?.consentId)
    meta.consentId = body.notification.consentId;
  if (body?.entries?.length != null) meta.entryCount = body.entries.length;
  return meta;
};

/**
 * Look up whether a consentId or requestId exists in our system.
 * Returns true if found in ConsentRequest, ConsentArtefact, or PHRConsentArtefact.
 */
const isKnownConsent = async (
  consentId?: string,
  requestId?: string,
): Promise<boolean> => {
  if (!consentId && !requestId) return false;

  const lookups: Promise<any>[] = [];

  if (consentId) {
    // Check ConsentArtefact by artefactId
    lookups.push(
      ConsentArtefactModel.findOne({ artefactId: consentId })
        .select("_id")
        .lean(),
    );
    lookups.push(
      PHRConsentArtefactModel.findOne({ artefactId: consentId })
        .select("_id")
        .lean(),
    );
    // Check ConsentRequest by consentRequestId or consentArtefacts containing this ID
    lookups.push(
      ConsentRequestModel.findOne({
        $or: [
          { consentRequestId: consentId },
          { consentArtefacts: consentId },
        ],
      })
        .select("_id")
        .lean(),
    );
  }

  if (requestId && requestId !== consentId) {
    lookups.push(
      ConsentRequestModel.findOne({
        $or: [{ requestId }, { consentRequestId: requestId }],
      })
        .select("_id")
        .lean(),
    );
  }

  const results = await Promise.all(lookups);
  return results.some((r) => r !== null);
};

/**
 * Record an unmatched event in the database for debugging.
 */
const recordUnmatchedEvent = async (
  req: Request,
  eventType: string,
  reason: UnmatchedEventReason,
  reasonDetail: string,
  consentId?: string,
  artefactId?: string,
): Promise<void> => {
  try {
    await UnmatchedEventModel.create({
      eventType,
      reason,
      reasonDetail,
      rawPayload: extractSafePayloadMeta(req.body),
      requestId:
        (req.headers["request-id"] as string) ||
        (req.headers["REQUEST-ID"] as string) ||
        req.body?.requestId,
      consentId,
      artefactId,
      sourceIp: req.ip || req.socket.remoteAddress,
      headers: {
        "content-type": req.headers["content-type"] as string,
        "request-id":
          (req.headers["request-id"] as string) || "",
        timestamp: (req.headers["timestamp"] as string) || "",
      },
      routePath: req.originalUrl || req.path,
    });
  } catch (err: any) {
    console.error(
      `${LOG_PREFIX} Failed to record unmatched event:`,
      err.message,
    );
  }
};

/**
 * Validate and correlate ABDM webhook payloads.
 *
 * Express middleware: validates schema, checks consent correlation,
 * and attaches typed payload to the request for downstream handlers.
 */
export const validateAndCorrelate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const path = req.originalUrl || req.path;

  // Skip non-ABDM routes and non-validated paths
  if (!needsCorrelationValidation(path)) {
    next();
    return;
  }

  // Log debug payload metadata
  AbdmLogger.logPayloadDebug(path, req.body);

  // Step 1: Classify the event
  const eventType = classifyWebhookEvent(path, req.body);

  // Step 2: Schema validation (only for artefact-producing and critical paths)
  try {
    if (path.includes("/hip/health-information/request")) {
      const parsed = HealthInformationRequestSchema.parse(req.body);
      (req as any).abdmPayload = parsed;
    } else if (
      path.includes("/consent/request/hip/notify") ||
      path.includes("/hiu/consent/request/notify") ||
      path.includes("/hiu/consent/request/on-notify")
    ) {
      const parsed = ConsentNotifySchema.parse(req.body);
      (req as any).abdmPayload = parsed;
    } else if (path.includes("/hiu/health-information/transfer")) {
      const parsed = HiuTransferSchema.parse(req.body);
      (req as any).abdmPayload = parsed;
    }
  } catch (err) {
    if (err instanceof ZodError) {
      const errorSummary = err.issues
        .map((e: any) => `${e.path.join(".")}: ${e.message}`)
        .join("; ");

      console.warn(
        `${LOG_PREFIX} Schema validation failed on ${path}: ${errorSummary}`,
      );

      AbdmLogger.logRejected({
        requestId: req.body?.requestId,
        consentId:
          req.body?.hiRequest?.consent?.id ||
          req.body?.notification?.consentId,
        reason: `INVALID_PAYLOAD: ${errorSummary}`,
        eventType: eventType,
        routePath: path,
      });

      await recordUnmatchedEvent(
        req,
        eventType,
        UnmatchedEventReason.INVALID_PAYLOAD,
        errorSummary,
      );

      // ABDM expects 200/202 even for rejected payloads (it won't retry on 4xx for some flows)
      res.status(200).json({
        status: "Acknowledged",
        message: "Payload validation failed",
      });
      return;
    }
    // Non-Zod error — let it pass through
    throw err;
  }

  // Step 3: Event type filtering — reject unknown events on artefact-producing routes
  if (eventType === AbdmEventType.UNKNOWN) {
    console.warn(
      `${LOG_PREFIX} Unknown event type on artefact-producing route: ${path}`,
    );

    AbdmLogger.logUnmatched({
      requestId: req.body?.requestId,
      reason: "UNKNOWN_EVENT: Unrecognized event type on validated route",
      eventType: "UNKNOWN",
      routePath: path,
    });

    await recordUnmatchedEvent(
      req,
      "UNKNOWN",
      UnmatchedEventReason.UNKNOWN_EVENT,
      `Unrecognized event on route ${path}`,
    );

    res.status(200).json({
      status: "Acknowledged",
      message: "Unknown event type",
    });
    return;
  }

  // Step 4: Correlation check — only for artefact-producing events
  if (isArtefactProducingEvent(eventType)) {
    // Extract consentId based on event type
    let consentId: string | undefined;
    let requestId: string | undefined;

    if (eventType === AbdmEventType.HEALTH_INFO_REQUEST) {
      consentId = req.body?.hiRequest?.consent?.id;
    } else if (eventType === AbdmEventType.CONSENT_GRANTED) {
      consentId =
        req.body?.notification?.consentId ||
        req.body?.notification?.consentRequestId;
      // For GRANTED, the artefact IDs are new — we check the parent consentRequestId
      requestId = req.body?.notification?.consentRequestId;
    } else if (eventType === AbdmEventType.DATA_TRANSFER) {
      // Transfer events are validated by transactionId in HIU service (already has retry logic)
      // Don't block here — the HIU service has robust fallback mechanisms
      (req as any).abdmEventType = eventType;
      next();
      return;
    }

    // For CONSENT_GRANTED: the artefact doesn't exist yet (it's being created).
    // We validate the PARENT consent request exists.
    // For HEALTH_INFO_REQUEST: the artefact should already exist.
    if (consentId || requestId) {
      const known = await isKnownConsent(consentId, requestId);
      if (!known) {
        // Special case: CONSENT_GRANTED notifications may arrive before our on-init callback
        // creates the ConsentRequest record. For GRANTED events, allow through — the handler
        // will create the artefact and link it. The consent.service already has dedup guards.
        if (eventType === AbdmEventType.CONSENT_GRANTED) {
          console.warn(
            `${LOG_PREFIX} No existing consent found for GRANTED notification (consentId=${consentId}, requestId=${requestId}). Allowing through — handler will create artefact.`,
          );
        } else {
          console.warn(
            `${LOG_PREFIX} No consent match for ${eventType}: consentId=${consentId}, requestId=${requestId}`,
          );

          AbdmLogger.logUnmatched({
            requestId: req.body?.requestId,
            consentId,
            reason: `NO_CONSENT_MATCH: No consent/artefact found for consentId=${consentId}`,
            eventType,
            routePath: path,
          });

          await recordUnmatchedEvent(
            req,
            eventType,
            UnmatchedEventReason.NO_CONSENT_MATCH,
            `No consent/artefact found for consentId=${consentId}`,
            consentId,
          );

          // Still respond 200 — ABDM expects acknowledgment
          res.status(200).json({
            status: "Acknowledged",
            message: "No matching consent found",
          });
          return;
        }
      }
    }
  }

  // Attach event type for downstream use
  (req as any).abdmEventType = eventType;

  next();
};
