import { Router } from "express";
import { healthInformation } from "../controllers/v2/webhook.controller";
import {
  handleConsentOnInit,
  handleConsentHipNotify,
  handleConsentOnFetch,
  handleConsentOnStatus,
} from "../controllers/v3/webhook.controller";
import { scanAndShareWebhook } from "../controllers/v3/opd.controller";
import { handleRunningTokenStatus } from "../controllers/v3/status.controller";
import * as CareContextCallback from "../controllers/v3/carecontext.callback.controller";
import * as DiscoveryController from "../controllers/v3/discovery.controller";
import { SmsNotificationService } from "../services/sms.notification.service";
import { GET_URL } from "../utils/constant";
import {
  validateAbdmWebhook,
  webhookRateLimiter,
} from "../middlewares/abdm.webhook.auth";
import { validateAndCorrelate } from "../middlewares/abdm.correlation.middleware";

const webook = Router();

// Apply ABDM webhook auth + rate limiting.
// validateAbdmWebhook internally checks path prefixes — only ABDM callback
// routes (/api/v3/hip/*, /api/v3/hiu/*, etc.) are validated.
// App routes like /api/login pass through untouched.
webook.use(webhookRateLimiter);
webook.use(validateAbdmWebhook);

// Correlation validation: validates payload schema (Zod), classifies event type,
// and checks consent correlation for artefact-producing routes.
webook.use(validateAndCorrelate);

// ============================================
// Callback URL check (for debugging: verify ABDM can reach this server)
// ============================================
webook.get("/api/v3/hip/callback-urls", (_req, res) => {
  const base = GET_URL || "(ABDM_CALLBACK_URL not set)";
  const b =
    base !== "(ABDM_CALLBACK_URL not set)" ? base.replace(/\/$/, "") : null;
  res.json({
    message: "Use these to verify ABDM callback registration and reachability.",
    baseUrl: base,
    healthInformationRequest: b
      ? `${b}/api/v3/hip/health-information/request`
      : null,
    discover: b
      ? [
          `${b}/api/v3/care-contexts/discover`,
          `${b}/api/v3/hip/patient/care-context/discover`,
          `${b}/api/v3/hip/patient/care-context/on-discover`,
        ]
      : null,
    linkInit: b
      ? [
          `${b}/api/v3/links/link/init`,
          `${b}/api/v3/hip/link/care-context/init`,
        ]
      : null,
    linkConfirm: b
      ? [
          `${b}/api/v3/links/link/confirm`,
          `${b}/api/v3/hip/link/care-context/confirm`,
        ]
      : null,
    note: "Register the exact URL your sandbox expects. Discovery may use discover or on-discover path. Ensure baseUrl is public.",
  });
});

// ============================================
// HIP Initiated Linking Callbacks (ABDM M2 - Phase 1-3)
// ============================================

// Phase 1: Callback for POST /hiecm/v3/token/generate-token
webook.post(
  "/api/v3/hip/token/on-generate-token",
  CareContextCallback.onGenerateToken,
);

// Phase 2: Callback for POST /hiecm/hip/v3/link/carecontext
webook.post("/api/v3/link/on_carecontext", CareContextCallback.onCareContext);

// Phase 3: Callback for POST /hiecm/hip/v3/link/context/notify
webook.post(
  "/api/v3/links/context/on-notify",
  CareContextCallback.onContextNotify,
);

// ============================================
// Discovery & User-Initiated Linking (ABDM M2)
// ============================================

// Discovery: ABDM forwards user's discovery request to HIP
webook.post("/api/v3/care-contexts/discover", DiscoveryController.onDiscover);
// Alias for user's specific path (sandbox may use discover or on-discover as callback)
webook.post(
  "/api/v3/hip/patient/care-context/discover",
  DiscoveryController.onDiscover,
);
// Some ABDM configs send discover request to .../on-discover (HIP discover callback)
webook.post(
  "/api/v3/hip/patient/care-context/on-discover",
  DiscoveryController.onDiscover,
);

// Link Init: User selected contexts, HIP must send OTP
webook.post("/api/v3/links/link/init", DiscoveryController.onLinkInit);
// Alias from M2 Doc (Page 87): /api/v3/hip/link/care-context/init
webook.post(
  "/api/v3/hip/link/care-context/init",
  DiscoveryController.onLinkInit,
);

// Link Confirm: User entered OTP, HIP verifies and links
webook.post("/api/v3/links/link/confirm", DiscoveryController.onLinkConfirm);
// Alias from M2 Doc (Page 103): /api/v3/hip/link/care-context/confirm
webook.post(
  "/api/v3/hip/link/care-context/confirm",
  DiscoveryController.onLinkConfirm,
);

// ============================================
// Consent Callbacks (ALL using v3 handlers)
// ============================================

// Consent Init callback: ABDM confirms our consent request was received
webook.post("/api/v3/hiu/consent/request/on-init", handleConsentOnInit);

// HIP Consent Notify: ABDM notifies consent GRANTED/REVOKED/DENIED/EXPIRED
// This now sends the required on-notify ACK back to ABDM
webook.post("/api/v3/consent/request/hip/notify", handleConsentHipNotify);
webook.post("/api/v3/hiu/consent/request/notify", handleConsentHipNotify);
// Alias: ABDM may send HIU consent notifications (including REVOKED) to on-notify path
webook.post("/api/v3/hiu/consent/request/on-notify", handleConsentHipNotify);

// Consent Fetch callback: ABDM returns full artefact details
webook.post("/:requestid/api/v3/hiu/consent/on-fetch", handleConsentOnFetch);
webook.post("/api/v3/hiu/consent/on-fetch", handleConsentOnFetch); // Fallback route for ABDM callbacks without requestid in path

// Consent Status callback: ABDM returns consent status
webook.post("/api/v3/hiu/consent/request/on-status", handleConsentOnStatus);

// ============================================
// SMS Notification Callback (ABDM M2)
// ============================================
webook.post("/api/v3/patients/sms/on-notify", (req, res) => {
  SmsNotificationService.handleSmsOnNotify(req.body);
  res.status(200).json({ status: "success", message: "Acknowledged" });
});

// Also handle v0.5 callback path
webook.post("/v0.5/patients/sms/on-notify", (req, res) => {
  SmsNotificationService.handleSmsOnNotify(req.body);
  res.status(200).json({ status: "success", message: "Acknowledged" });
});

// ============================================
// Data Flow Callbacks (Health Information)
// ============================================
webook.post("/api/v3/hip/health-information/request", healthInformation);

// Health Information on-notify callback - ABDM acknowledges our health-info/notify
webook.post("/api/v3/hip/health-information/on-notify", (req, res) => {
  // This is ABDM's acknowledgment that our health information transfer notification was received
  // The actual data push already completed successfully at this point
  res.status(200).json({ status: "Acknowledged" });
});

// ============================================
// HIU Data Flow Callbacks (When WE request data FROM other hospitals)
// ============================================
import {
  onHealthInformationRequest as hiuOnRequest,
  onHealthInformationTransfer as hiuOnTransfer,
  onDiscover as hiuOnDiscover,
  onLinkInit as hiuOnInit,
  onLinkConfirm as hiuOnConfirm,
} from "../controllers/v3/hiu.controller";

// HIU on-request: ABDM acknowledges our data request
webook.post("/api/v3/hiu/health-information/on-request", hiuOnRequest);

// HIU transfer: ABDM pushes encrypted data to us
webook.post("/api/v3/hiu/health-information/transfer", hiuOnTransfer);

// HIU on-discover: ABDM returns patient search results
webook.post("/api/v3/care-contexts/on-discover", hiuOnDiscover);
// Alias to match user's expectation/configuration
webook.post("/api/v3/patient/care-context/on-discover", hiuOnDiscover);

// HIU on-init: ABDM acknowledges auth init
webook.post("/api/v3/hiu/patient/care-context/on-init", hiuOnInit);

// HIU on-confirm: ABDM acknowledges auth confirm
webook.post("/api/v3/hiu/patient/care-context/on-confirm", hiuOnConfirm);

// ============================================
// Patient Share Callbacks (Section 3)
// ============================================
webook.post("/api/v3/hip/patient/share", scanAndShareWebhook);

// ============================================
// Running Token Status
// ============================================
webook.post(
  "/api/v3/hip/patient/running-token/status",
  handleRunningTokenStatus,
);
webook.post("/api/v3/hiu/running-token/on-status", (req, res) => {
  res.status(202).json({
    status: "Accepted",
    message: "Request received and processing",
  });
});

export default webook;
