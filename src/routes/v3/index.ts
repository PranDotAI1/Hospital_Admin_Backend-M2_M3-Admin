import { Router } from "express";
import {
  consentRequestInitiate,
  userOnboardingByĂbha,
} from "../../controllers/v3/registrationOnAbha.controller";
import { setBridgeUrlforTest } from "../../controllers/v3/testing.controller";
import {
  consentInitRequest,
  getConsentRequests,
  getConsentStatus,
  getConsentArtefacts,
  fetchArtefactDetails,
} from "../../controllers/v3/Consent.controller";

const router = Router();

// ============================================
// ABHA Routes
// ============================================
router.post("/registration", userOnboardingByĂbha);
router.post("/request/init", userOnboardingByĂbha);

// ============================================
// Consent Management
// ============================================

// Initiate a new consent request
router.post("/consent-int", consentInitRequest);

// List all consent requests (with pagination + filters)
router.get("/consent-requests", getConsentRequests);

// Check consent status from ABDM
router.post("/get-consent-status", getConsentStatus);

// List consent artefacts (with pagination + filters)
router.get("/consent-artefacts", getConsentArtefacts);

// Manually fetch full artefact details from ABDM
router.post("/consent-artefact/:artefactId/fetch", fetchArtefactDetails);

// Legacy route: consent initiate from M3 onboarding flow
router.post("/consent-request-initiate", consentRequestInitiate);

// ============================================
// Testing
// ============================================
router.post("/test-bridge-url", setBridgeUrlforTest);

export default router;
