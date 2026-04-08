import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
import {
  addDepartment,
  departmentList,
  updateDepartment,
} from "../controllers/department.controller";
import { add, listing, update } from "../controllers/hospital.controller";
import { login, logout } from "../controllers/login.controller";
import {
  abhauserListing,
  updatePassword,
  userAdd,
  userListing,
  userNewAdd,
  userNotifyResponse,
  userProfile,
  userUpdate,
  doctorListing,
} from "../controllers/user.controller";
import {
  tokenGeneration,
  userV2Onboard,
} from "../controllers/v2/abha.controller";
import { linkTokenGeneration } from "../controllers/v2/webhook.controller";
import { checkToken, requireRole } from "../middlewares/user.authentication";
import { loginLimiter } from "../middlewares/rate.limiter";
import { ROLE } from "../utils/constant";
import {
  getPendingTokens,
  completeRegistration,
  nextPatient,
  getQueueStatusDetails,
  getTokenDetails,
  updateCurrentServing,
  generateQrCode,
  generateQrCodePreview,
  getOPDStats,
  getAllVisits,
  cancelVisit,
  getPatientVisitHistory,
} from "../controllers/v3/opd.controller";

import {
  registerPatient,
  linkAbha,
  mergeAbhaPatient,
  getPatient,
  listPatients,
  getAllPatients,
  sendDeepLinkSms,
  addVisit,
  searchPatients,
  checkExistingPatients,
  checkAbhaNumber,
  updatePatient,
  updatePatientAndAddVisit,
} from "../controllers/v3/patient.controller";
import {
  recordPrescription,
  recordSoapNotes,
  recordLabResults,
  recordDischargeSummary,
  recordImmunization,
  getPrescription,
  getSoapNotes,
  getLabResults,
  getDischargeSummary,
  getAssessment,
  recordAssessment,
} from "../controllers/v3/visit.clinical.controller";
import {
  searchMedicines as searchMedicinesCtrl,
  searchLabTests as searchLabTestsCtrl,
  searchProcedures as searchProceduresCtrl,
  searchConditions as searchConditionsCtrl,
} from "../controllers/terminology.controller";
import {
  getAvailableTestTypes,
  getTestParameters,
  upsertLabTest,
  getVisitLabReport,
  getLabReport,
  updateLabTest,
  getPatientLabReports,
  finalizeLabReport,
} from "../controllers/v3/lab-report.controller";
const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to the API");
});

router.get("/testing", (req: any, res: any) => {
  res.send("Welcome to the new API");
});
// onboarding Routes
router.post("/login", loginLimiter, login);
router.get("/logout", checkToken, logout);
router.get("/profile", checkToken, userProfile);

//Hospital Routes
router.get("/hospital", checkToken, listing);
router.post(
  "/hospital",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  add,
);
router.put(
  "/hospital/:id",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  update,
);

//User Routes
router.get("/users", checkToken, userListing);
router.get("/doctors", checkToken, doctorListing);
router.post(
  "/user/add",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  userAdd,
);
router.put(
  "/user/:id",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  userUpdate,
);
router.put("/user/update/password/:id", checkToken, updatePassword);

router.post(
  "/user/new-add",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  userNewAdd,
);

// Department Routes
router.get("/departments", checkToken, departmentList);
router.post(
  "/department",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  addDepartment,
);
router.put(
  "/department/:id",
  checkToken,
  requireRole(ROLE.SUPER_ADMIN, ROLE.HOSPITAL_ADMIN),
  updateDepartment,
);

//ABHA Routes
router.post("/registration", checkToken, userV2Onboard);
router.post("/token-generation", checkToken, tokenGeneration);
//router.post("/test-token", tokenGeneration1)

// get ABHA user information
router.get("/abha/user/listing", checkToken, abhauserListing);
router.get("/abha/user/notify-response/:id", checkToken, userNotifyResponse);

//Webhook hit
router.post("/token/generate-token", checkToken, linkTokenGeneration);

router.get("/opd/pending-tokens", checkToken, getPendingTokens);
router.post("/opd/complete-registration/:id", checkToken, completeRegistration);
router.post("/internal/next-patient", checkToken, nextPatient);
router.get("/opd/queue-status", checkToken, getQueueStatusDetails);
router.get("/opd/token-details", checkToken, getTokenDetails);
router.post("/opd/update-serving", checkToken, updateCurrentServing);

router.get("/opd/qr-code", generateQrCode);
router.get("/opd/qr-preview", generateQrCodePreview);

router.get("/opd/stats", checkToken, getOPDStats);
router.get("/opd/visits", checkToken, getAllVisits);
router.put("/opd/visits/:id/cancel", checkToken, cancelVisit);
router.get(
  "/opd/visits/patient/:abhaAddress",
  checkToken,
  getPatientVisitHistory,
);

router.post("/patient/register", checkToken, registerPatient);
router.post("/patient/check-existing", checkToken, checkExistingPatients);
router.post("/patient/check-abha", checkToken, checkAbhaNumber);
router.get("/patient/search", checkToken, searchPatients);
router.post("/patient/:id/visit", checkToken, addVisit);
router.patch("/patient/:id", checkToken, updatePatient);
router.patch("/patient/:id/update-and-visit", checkToken, updatePatientAndAddVisit);
router.post("/patient/:id/link-abha", checkToken, linkAbha);
router.post("/patient/link-to-abha", checkToken, mergeAbhaPatient);
router.get("/patient/:id", checkToken, getPatient);
router.get("/patients/all", checkToken, getAllPatients);
router.get("/patients", checkToken, listPatients);
router.post("/patient/:id/notify2", checkToken, sendDeepLinkSms);

router.post(
  "/visit/:visitId/clinical/prescription",
  checkToken,
  recordPrescription,
);
router.get(
  "/visit/:visitId/clinical/prescription",
  checkToken,
  getPrescription,
);
router.post("/visit/:visitId/clinical/soap-notes", checkToken, recordSoapNotes);
router.get("/visit/:visitId/clinical/soap-notes", checkToken, getSoapNotes);
router.post(
  "/visit/:visitId/clinical/lab-results",
  checkToken,
  recordLabResults,
);
router.get("/visit/:visitId/clinical/lab-results", checkToken, getLabResults);
router.post(
  "/visit/:visitId/clinical/discharge-summary",
  checkToken,
  recordDischargeSummary,
);
router.get(
  "/visit/:visitId/clinical/discharge-summary",
  checkToken,
  getDischargeSummary,
);
router.post(
  "/visit/:visitId/clinical/immunization",
  checkToken,
  recordImmunization,
);

router.post(
  "/visit/:visitId/clinical/assessment",
  checkToken,
  upload.array("files"),
  recordAssessment,
);

router.get("/visit/:visitId/clinical/assessment", checkToken, getAssessment);

import * as CareContextController from "../controllers/v3/carecontext.controller";
import { SmsNotificationService } from "../services/sms.notification.service";

import {
  consentInitRequest,
  getConsentRequests,
  getConsentStatus,
  getConsentArtefacts,
  fetchArtefactDetails,
} from "../controllers/v3/Consent.controller";

router.get(
  "/carecontext/pending",
  checkToken,
  CareContextController.listPending,
);
router.get(
  "/carecontext/patient/:patientId",
  checkToken,
  CareContextController.listByPatient,
);
router.get("/carecontext/:id", checkToken, CareContextController.getById);
router.post(
  "/carecontext/create",
  checkToken,
  CareContextController.createCareContext,
);
router.post(
  "/carecontext/:id/link",
  checkToken,
  CareContextController.triggerLink,
);
router.post(
  "/carecontext/:id/retry",
  checkToken,
  CareContextController.retryLink,
);
router.post(
  "/carecontext/patient/:patientId/link-all",
  checkToken,
  CareContextController.linkAllForPatient,
);
router.post(
  "/carecontext/patient/:patientId/set-link-token",
  checkToken,
  CareContextController.setLinkTokenForPatient,
);
router.post(
  "/carecontext/:id/notify",
  checkToken,
  CareContextController.retryNotify,
);

// Consent Management Routes (for frontend dashboard)
router.post("/consent/init", checkToken, consentInitRequest);
router.get("/consent/requests", checkToken, getConsentRequests);
router.post("/consent/status", checkToken, getConsentStatus);
router.get("/consent/artefacts", checkToken, getConsentArtefacts);
router.post(
  "/consent/artefact/:artefactId/fetch",
  checkToken,
  fetchArtefactDetails,
);

// HIU Routes (Data Fetch from other hospitals)
import hiuRoutes from "./hiu.routes";
router.use("/hiu", hiuRoutes);

// SMS Notification for patients without ABHA address
router.post(
  "/patient/:id/sms-notify",
  checkToken,
  async (req: any, res: any) => {
    try {
      const { PatientModel } = await import("../models/Patient");
      const patient = await PatientModel.findById(req.params.id);
      if (!patient) {
        return res
          .status(404)
          .json({ status: "error", message: "Patient not found" });
      }
      if (!patient.mobile) {
        return res
          .status(400)
          .json({ status: "error", message: "Patient has no mobile number" });
      }
      if (patient.abhaaddress) {
        return res.status(400).json({
          status: "error",
          message:
            "Patient already has ABHA address. Use HIP-initiated linking instead.",
        });
      }
      const success = await SmsNotificationService.sendSmsNotification(
        patient.mobile,
      );
      return res.status(200).json({
        status: success ? "success" : "error",
        message: success
          ? "SMS notification sent to patient"
          : "Failed to send SMS notification",
      });
    } catch (error: any) {
      return res.status(500).json({ status: "error", message: error.message });
    }
  },
);

import dayCareBillingRoutes from "./billing.routes";

router.use("/billing", dayCareBillingRoutes);

// ── ABDM Clinical Terminology Search (SNOMED CT + LOINC) ──
router.get("/terminology/medicines", checkToken, searchMedicinesCtrl);
router.get("/terminology/lab-tests", checkToken, searchLabTestsCtrl);
router.get("/terminology/procedures", checkToken, searchProceduresCtrl);
router.get("/terminology/conditions", checkToken, searchConditionsCtrl);

// ── Lab Test Templates & Structured Lab Reports ──
router.get("/lab-tests/types", checkToken, getAvailableTestTypes);
router.get("/lab-tests/parameters/:testType", checkToken, getTestParameters);
router.post("/lab-reports/upsert", checkToken, upsertLabTest);
router.get("/lab-reports/visit/:visitId", checkToken, getVisitLabReport);
router.get("/lab-reports/patient/:patientId", checkToken, getPatientLabReports);
router.get("/lab-reports/:id", checkToken, getLabReport);
router.put("/lab-reports/:id/test/:testType", checkToken, updateLabTest);
router.patch("/lab-reports/:id/finalize", checkToken, finalizeLabReport);

export default router;
