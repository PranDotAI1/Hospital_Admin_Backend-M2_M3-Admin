/**
 * ABDM Event Type Classification and Handler Map.
 *
 * Classifies incoming webhook events by route path and payload content,
 * and provides a handler map that determines which events are allowed
 * to produce artefact storage.
 *
 * Only CONSENT_GRANTED and DATA_TRANSFER events may result in artefact creation.
 * All other events are either informational callbacks or status updates.
 */

const LOG_PREFIX = "[ABDM_EVENT]";

// ============================================================================
// Event Type Enum
// ============================================================================

export enum AbdmEventType {
  // Artefact-producing events
  CONSENT_GRANTED = "CONSENT_GRANTED",
  DATA_TRANSFER = "DATA_TRANSFER",

  // Consent lifecycle events (non-artefact-producing)
  CONSENT_REVOKED = "CONSENT_REVOKED",
  CONSENT_DENIED = "CONSENT_DENIED",
  CONSENT_EXPIRED = "CONSENT_EXPIRED",
  CONSENT_ON_INIT = "CONSENT_ON_INIT",
  CONSENT_ON_FETCH = "CONSENT_ON_FETCH",
  CONSENT_ON_STATUS = "CONSENT_ON_STATUS",

  // Data flow events (non-artefact-producing)
  HEALTH_INFO_REQUEST = "HEALTH_INFO_REQUEST",
  HEALTH_INFO_ON_NOTIFY = "HEALTH_INFO_ON_NOTIFY",
  HIU_ON_REQUEST = "HIU_ON_REQUEST",

  // Discovery & Linking events
  DISCOVERY = "DISCOVERY",
  LINK_INIT = "LINK_INIT",
  LINK_CONFIRM = "LINK_CONFIRM",
  LINK_ON_CARECONTEXT = "LINK_ON_CARECONTEXT",
  LINK_ON_CONTEXT_NOTIFY = "LINK_ON_CONTEXT_NOTIFY",
  TOKEN_ON_GENERATE = "TOKEN_ON_GENERATE",

  // Patient share
  PATIENT_SHARE = "PATIENT_SHARE",

  // SMS
  SMS_ON_NOTIFY = "SMS_ON_NOTIFY",

  // Unknown
  UNKNOWN = "UNKNOWN",
}

// ============================================================================
// Events that are allowed to produce artefact storage
// ============================================================================

export const ARTEFACT_PRODUCING_EVENTS = new Set<AbdmEventType>([
  AbdmEventType.CONSENT_GRANTED,
  AbdmEventType.DATA_TRANSFER,
]);

/**
 * Check if an event type is allowed to produce artefact storage.
 */
export const isArtefactProducingEvent = (eventType: AbdmEventType): boolean =>
  ARTEFACT_PRODUCING_EVENTS.has(eventType);

// ============================================================================
// Event Type Classification
// ============================================================================

/**
 * Classify an incoming webhook request into an AbdmEventType.
 *
 * Uses the route path as the primary signal, with payload inspection
 * for consent notify events (to distinguish GRANTED vs REVOKED etc.).
 */
export const classifyWebhookEvent = (
  routePath: string,
  body: any,
): AbdmEventType => {
  const path = routePath.toLowerCase();

  // Health Information Request (HIP receives request to push data)
  if (path.includes("/hip/health-information/request")) {
    return AbdmEventType.HEALTH_INFO_REQUEST;
  }

  // Health Information on-notify (ABDM acks our notify)
  if (path.includes("/hip/health-information/on-notify")) {
    return AbdmEventType.HEALTH_INFO_ON_NOTIFY;
  }

  // HIU Health Information Transfer (we receive encrypted data)
  if (path.includes("/hiu/health-information/transfer")) {
    return AbdmEventType.DATA_TRANSFER;
  }

  // HIU on-request (ABDM acks our data request)
  if (path.includes("/hiu/health-information/on-request")) {
    return AbdmEventType.HIU_ON_REQUEST;
  }

  // Consent HIP Notify (GRANTED/REVOKED/DENIED/EXPIRED)
  if (
    path.includes("/consent/request/hip/notify") ||
    (path.includes("/hiu/consent/request/notify") && body?.notification) ||
    (path.includes("/hiu/consent/request/on-notify") && body?.notification)
  ) {
    const status = body?.notification?.status?.toUpperCase();
    switch (status) {
      case "GRANTED":
        return AbdmEventType.CONSENT_GRANTED;
      case "REVOKED":
        return AbdmEventType.CONSENT_REVOKED;
      case "DENIED":
        return AbdmEventType.CONSENT_DENIED;
      case "EXPIRED":
        return AbdmEventType.CONSENT_EXPIRED;
      default:
        console.warn(
          `${LOG_PREFIX} Consent notify with unknown status: ${status}`,
        );
        return AbdmEventType.UNKNOWN;
    }
  }

  // Consent On-Init
  if (path.includes("/consent/request/on-init")) {
    return AbdmEventType.CONSENT_ON_INIT;
  }

  // Consent On-Fetch
  if (path.includes("/consent/on-fetch")) {
    return AbdmEventType.CONSENT_ON_FETCH;
  }

  // Consent On-Status
  if (path.includes("/consent/request/on-status")) {
    return AbdmEventType.CONSENT_ON_STATUS;
  }

  // Discovery
  if (
    path.includes("/care-contexts/discover") ||
    path.includes("/care-context/discover") ||
    path.includes("/care-context/on-discover")
  ) {
    return AbdmEventType.DISCOVERY;
  }

  // Link Init
  if (path.includes("/link/init") || path.includes("/link/care-context/init")) {
    return AbdmEventType.LINK_INIT;
  }

  // Link Confirm
  if (
    path.includes("/link/confirm") ||
    path.includes("/link/care-context/confirm")
  ) {
    return AbdmEventType.LINK_CONFIRM;
  }

  // Link on-carecontext
  if (path.includes("/link/on_carecontext") || path.includes("/on-carecontext")) {
    return AbdmEventType.LINK_ON_CARECONTEXT;
  }

  // Context on-notify
  if (path.includes("/context/on-notify")) {
    return AbdmEventType.LINK_ON_CONTEXT_NOTIFY;
  }

  // Token on-generate
  if (path.includes("/token/on-generate-token")) {
    return AbdmEventType.TOKEN_ON_GENERATE;
  }

  // Patient share
  if (path.includes("/patient/share")) {
    return AbdmEventType.PATIENT_SHARE;
  }

  // SMS on-notify
  if (path.includes("/sms/on-notify")) {
    return AbdmEventType.SMS_ON_NOTIFY;
  }

  // Running token status
  if (path.includes("/running-token")) {
    return AbdmEventType.UNKNOWN; // Informational, not artefact-producing
  }

  console.warn(`${LOG_PREFIX} Could not classify event for path: ${path}`);
  return AbdmEventType.UNKNOWN;
};

/**
 * Get a human-readable description for an event type.
 */
export const getEventDescription = (eventType: AbdmEventType): string => {
  const descriptions: Record<AbdmEventType, string> = {
    [AbdmEventType.CONSENT_GRANTED]: "Consent granted — artefact will be stored",
    [AbdmEventType.DATA_TRANSFER]: "Health data transfer — artefact will be stored",
    [AbdmEventType.CONSENT_REVOKED]: "Consent revoked — artefacts will be marked REVOKED",
    [AbdmEventType.CONSENT_DENIED]: "Consent denied — artefacts will be marked DENIED",
    [AbdmEventType.CONSENT_EXPIRED]: "Consent expired — artefacts will be marked EXPIRED",
    [AbdmEventType.CONSENT_ON_INIT]: "Consent init callback — status update only",
    [AbdmEventType.CONSENT_ON_FETCH]: "Consent fetch callback — artefact details stored",
    [AbdmEventType.CONSENT_ON_STATUS]: "Consent status callback — status update only",
    [AbdmEventType.HEALTH_INFO_REQUEST]: "Health info request — data push initiated",
    [AbdmEventType.HEALTH_INFO_ON_NOTIFY]: "Health info on-notify — ABDM acknowledgment",
    [AbdmEventType.HIU_ON_REQUEST]: "HIU on-request — ABDM acknowledges our data request",
    [AbdmEventType.DISCOVERY]: "Patient discovery — care context matching",
    [AbdmEventType.LINK_INIT]: "Link init — OTP generation",
    [AbdmEventType.LINK_CONFIRM]: "Link confirm — OTP verification",
    [AbdmEventType.LINK_ON_CARECONTEXT]: "Link on-carecontext — linking callback",
    [AbdmEventType.LINK_ON_CONTEXT_NOTIFY]: "Link context on-notify — notification callback",
    [AbdmEventType.TOKEN_ON_GENERATE]: "Token on-generate — token generation callback",
    [AbdmEventType.PATIENT_SHARE]: "Patient share — scan & share",
    [AbdmEventType.SMS_ON_NOTIFY]: "SMS on-notify — SMS notification callback",
    [AbdmEventType.UNKNOWN]: "Unknown event type",
  };
  return descriptions[eventType] || "Unknown event";
};
