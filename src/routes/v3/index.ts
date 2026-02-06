import { Router } from "express";
import {
  consentRequestInitiate,
  userOnboardingByĂbha,
} from "../../controllers/v3/registrationOnAbha.controller";
import { setBridgeUrlforTest } from "../../controllers/v3/testing.controller";
import {
  consentInitRequest,
  getConsentRequests,
} from "../../controllers/v3/Consent.controller";

const router = Router();

//ABHA Routes
router.post("/registration", userOnboardingByĂbha);
router.post("/request/init", userOnboardingByĂbha);

//REQUEST INIT
router.post("/consent-int", consentInitRequest);
router.get("/consent-requests", getConsentRequests);
router.post("/get-consent-status", consentRequestInitiate);

//Callback URL RECEIVED DATA

// For testing url only
router.post("/test-bridge-url", setBridgeUrlforTest);

export default router;
