import express from "express";
import {
  initiateDataFetch,
  retryFailedConsents,
  onHealthInformationRequest,
  onHealthInformationTransfer,
  getExternalRecords,
  getExternalRecordById,
  searchPatient,
} from "../controllers/v3/hiu.controller";

import { checkToken } from "../middlewares/user.authentication";

const router = express.Router();

// Frontend API: Initiate Patient Search
// POST /api/v3/hiu/patient/search
router.post("/patient/search", checkToken, searchPatient);

// Frontend API: Initiate Data Fetch
// POST /api/v3/hiu/health-information/fetch
router.post("/health-information/fetch", checkToken, initiateDataFetch);

// Frontend API: Retry all failed consents
// POST /api/v3/hiu/health-information/retry
router.post("/health-information/retry", checkToken, retryFailedConsents);

// ABDM Callbacks
// POST /api/v3/hiu/health-information/on-request
router.post("/health-information/on-request", onHealthInformationRequest);

// POST /api/v3/hiu/health-information/transfer
router.post("/health-information/transfer", onHealthInformationTransfer);

// ============================================================================
// External Records API (Records from OTHER hospitals)
// ============================================================================

// GET /api/v3/hiu/patient/:patientId/external-records
// Returns paginated list of external health records
router.get(
  "/patient/:patientId/external-records",
  checkToken,
  getExternalRecords,
);

// GET /api/v3/hiu/patient/:patientId/external-records/:recordId
// Returns single external record with full FHIR bundle
router.get(
  "/patient/:patientId/external-records/:recordId",
  checkToken,
  getExternalRecordById,
);

export default router;
