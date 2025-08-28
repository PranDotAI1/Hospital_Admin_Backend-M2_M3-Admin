import { Router } from "express";
import { consentRequestInitiate, userOnboardingByĂbha } from "../../controllers/v3/registrationOnAbha.controller";
import { setBridgeUrlforTest } from "../../controllers/v3/testing.controller";

const router = Router();

//ABHA Routes
router.post("/registration", userOnboardingByĂbha);
router.post("/request/init", userOnboardingByĂbha);
router.post("/consent-int", consentRequestInitiate);
router.post("/get-consent-status", consentRequestInitiate);

//Callback URL RECEIVED DATA


// For testing url only
router.post("/test-bridge-url", setBridgeUrlforTest);

export default router;