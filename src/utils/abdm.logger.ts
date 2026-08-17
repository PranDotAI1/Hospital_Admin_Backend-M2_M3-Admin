/**
 * Structured logging utility for ABDM artefact ingestion.
 *
 * Provides categorized log entries for:
 * - Accepted artefacts
 * - Rejected artefacts (with reason)
 * - Duplicate artefacts
 * - Unmatched events
 * - Debug payload logging (metadata only, no PHI)
 */

export enum ArtefactLogEvent {
  ACCEPTED = "ARTEFACT_ACCEPTED",
  REJECTED = "ARTEFACT_REJECTED",
  DUPLICATE = "ARTEFACT_DUPLICATE",
  UNMATCHED = "UNMATCHED_EVENT",
}

export interface ArtefactLogDetails {
  event: ArtefactLogEvent;
  requestId?: string;
  consentId?: string;
  artefactId?: string;
  sourceType?: string;
  reason?: string;
  eventType?: string;
  routePath?: string;
  transactionId?: string;
  timestamp: string;
}

const LOG_PREFIX = "[ABDM_ARTEFACT]";

/**
 * Format and emit a structured log entry.
 */
const emitLog = (level: "info" | "warn" | "error", details: ArtefactLogDetails): void => {
  const logLine = {
    ...details,
    _prefix: LOG_PREFIX,
  };

  switch (level) {
    case "info":
      console.log(`${LOG_PREFIX} [${details.event}]`, JSON.stringify(logLine));
      break;
    case "warn":
      console.warn(`${LOG_PREFIX} [${details.event}]`, JSON.stringify(logLine));
      break;
    case "error":
      console.error(`${LOG_PREFIX} [${details.event}]`, JSON.stringify(logLine));
      break;
  }
};

/**
 * Log a successfully accepted artefact.
 */
export const logAccepted = (details: {
  requestId?: string;
  consentId?: string;
  artefactId?: string;
  sourceType?: string;
  transactionId?: string;
}): void => {
  emitLog("info", {
    event: ArtefactLogEvent.ACCEPTED,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Log a rejected artefact (with reason).
 */
export const logRejected = (details: {
  requestId?: string;
  consentId?: string;
  artefactId?: string;
  reason: string;
  eventType?: string;
  routePath?: string;
}): void => {
  emitLog("warn", {
    event: ArtefactLogEvent.REJECTED,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Log a duplicate artefact that was skipped.
 */
export const logDuplicate = (details: {
  requestId?: string;
  consentId?: string;
  artefactId?: string;
  sourceType?: string;
  transactionId?: string;
}): void => {
  emitLog("warn", {
    event: ArtefactLogEvent.DUPLICATE,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Log an unmatched event (unknown source, no consent match, etc.).
 */
export const logUnmatched = (details: {
  requestId?: string;
  consentId?: string;
  reason: string;
  eventType?: string;
  routePath?: string;
}): void => {
  emitLog("error", {
    event: ArtefactLogEvent.UNMATCHED,
    ...details,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Temporary debug logging for full payload metadata.
 * Logs only safe metadata fields (requestId, consentId, timestamp, transactionId).
 * NEVER logs PHI (keyMaterial values, patient data, encrypted content).
 */
export const logPayloadDebug = (
  routePath: string,
  payload: Record<string, any>,
): void => {
  const safeMeta: Record<string, any> = {
    _route: routePath,
    _ts: new Date().toISOString(),
  };

  // Extract only safe metadata fields
  if (payload.requestId) safeMeta.requestId = payload.requestId;
  if (payload.transactionId) safeMeta.transactionId = payload.transactionId;
  if (payload.timestamp) safeMeta.payloadTimestamp = payload.timestamp;
  if (payload.hiRequest?.consent?.id) safeMeta.consentId = payload.hiRequest.consent.id;
  if (payload.notification?.status) safeMeta.notificationStatus = payload.notification.status;
  if (payload.notification?.consentRequestId)
    safeMeta.consentRequestId = payload.notification.consentRequestId;
  if (payload.notification?.consentId)
    safeMeta.notificationConsentId = payload.notification.consentId;
  if (payload.entries?.length != null) safeMeta.entryCount = payload.entries.length;

  // Minimal, informative log instead of full JSON spam
  const identifier = safeMeta.transactionId || safeMeta.requestId || safeMeta.consentRequestId || "No-ID";
  console.log(`${LOG_PREFIX} [WEBHOOK] Received on ${routePath} [ID: ${identifier}]`);
};

export const AbdmLogger = {
  logAccepted,
  logRejected,
  logDuplicate,
  logUnmatched,
  logPayloadDebug,
};
