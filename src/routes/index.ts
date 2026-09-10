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
import {
  login,
  logout,
  refreshSession,
  listActiveSessions,
  revokeSessionHandler,
  revokeOtherSessionsHandler,
} from "../controllers/login.controller";
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
import { requirePermission, requireAnyPermission } from "../middlewares/permission.middleware";
import { PERMISSIONS } from "../utils/permissions";
import {
  loginLimiter,
  refreshLimiter,
  passwordResetLimiter,
} from "../middlewares/rate.limiter";
import { validate } from "../middlewares/validate";
import {
  registerPatientSchema,
  updatePatientSchema,
  updatePatientAndAddVisitSchema,
  addVisitSchema,
  checkExistingPatientsSchema,
} from "../validations/patient.schema";
import {
  loginSchema,
  refreshTokenSchema,
  revokeSessionSchema,
} from "../validations/auth.schema";
import { addUserSchema, updateUserSchema } from "../validations/user.schema";
import { addDepartmentSchema, updateDepartmentSchema } from "../validations/department.schema";
import { addHospitalSchema, updateHospitalSchema } from "../validations/hospital.schema";
import { ROLE } from "../utils/constant";
import {
  listing as roleListing,
  getPermissionsForRole,
  getAllPermissions,
} from "../controllers/api/role.controller";
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
import {
  getPharmacyQueue,
  getEnrichedPrescriptionByVisit,
  dispensePrescription,
  getDispenseByVisit,
} from "../controllers/pharmacy.controller";
import authRoutes from "./v1/auth/auth.routes";

const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to the API");
});

router.get("/testing", (req: any, res: any) => {
  res.send("Welcome to the new API");
});

// Authentication & Password Management Routes
router.use("/", authRoutes);
router.use("/auth", authRoutes);

// onboarding Routes
router.post("/login", loginLimiter, validate(loginSchema), login);
router.post("/refresh-token", refreshLimiter, validate(refreshTokenSchema), refreshSession);
router.get("/logout", checkToken, logout);
router.post("/logout", checkToken, logout);
router.get("/profile", checkToken, userProfile);
router.get("/me", checkToken, userProfile);
router.get("/auth/me", checkToken, userProfile);

// Active Session Management
router.get("/auth/sessions", checkToken, listActiveSessions);
router.post(
  "/auth/sessions/revoke",
  checkToken,
  validate(revokeSessionSchema),
  revokeSessionHandler,
);
router.post(
  "/auth/sessions/revoke-all-others",
  checkToken,
  revokeOtherSessionsHandler,
);

//Hospital Routes
router.get("/hospital", checkToken, listing);
router.post(
  "/hospital",
  checkToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  validate(addHospitalSchema),
  add,
);
router.put(
  "/hospital/:id",
  checkToken,
  requirePermission(PERMISSIONS.HOSPITAL_MANAGE),
  validate(updateHospitalSchema),
  update,
);

//User Routes
router.get("/users", checkToken, requirePermission(PERMISSIONS.USERS_READ), userListing);
router.get("/doctors", checkToken, requireAnyPermission(PERMISSIONS.USERS_READ, PERMISSIONS.OPD_ADD_VISIT, PERMISSIONS.PATIENTS_REGISTER), doctorListing);
router.post(
  "/user/add",
  checkToken,
  requirePermission(PERMISSIONS.USERS_CREATE),
  validate(addUserSchema),
  userAdd,
);
router.put(
  "/user/:id",
  checkToken,
  requirePermission(PERMISSIONS.USERS_UPDATE),
  validate(updateUserSchema),
  userUpdate,
);
router.put(
  "/user/update/password/:id",
  passwordResetLimiter,
  checkToken,
  updatePassword,
);

router.post(
  "/user/new-add",
  checkToken,
  requirePermission(PERMISSIONS.USERS_CREATE),
  validate(addUserSchema),
  userNewAdd,
);

// Role & Permission Routes
router.get("/roles", checkToken, roleListing);
router.get("/roles/:roleId", checkToken, getPermissionsForRole);
router.get("/roles/:roleId/permissions", checkToken, getPermissionsForRole);
router.get("/permissions", checkToken, requirePermission(PERMISSIONS.USERS_ASSIGN_ROLE), getAllPermissions);

// Department Routes
router.get("/departments", checkToken, requirePermission(PERMISSIONS.DEPARTMENT_READ), departmentList);
router.post(
  "/department",
  checkToken,
  requirePermission(PERMISSIONS.DEPARTMENT_MANAGE),
  validate(addDepartmentSchema),
  addDepartment,
);
router.put(
  "/department/:id",
  checkToken,
  requirePermission(PERMISSIONS.DEPARTMENT_MANAGE),
  validate(updateDepartmentSchema),
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

router.get("/opd/pending-tokens", checkToken, requirePermission(PERMISSIONS.OPD_VIEW_QUEUE), getPendingTokens);
router.post("/opd/complete-registration/:id", checkToken, requirePermission(PERMISSIONS.OPD_ADD_VISIT), completeRegistration);
router.post("/internal/next-patient", checkToken, requirePermission(PERMISSIONS.OPD_NEXT_PATIENT), nextPatient);
router.get("/opd/queue-status", checkToken, requirePermission(PERMISSIONS.OPD_VIEW_QUEUE), getQueueStatusDetails);
router.get("/opd/token-details", checkToken, requirePermission(PERMISSIONS.OPD_VIEW_QUEUE), getTokenDetails);
router.post("/opd/update-serving", checkToken, requirePermission(PERMISSIONS.OPD_UPDATE_SERVING), updateCurrentServing);

router.get("/opd/qr-code", generateQrCode);
router.get("/opd/qr-preview", generateQrCodePreview);

router.get("/opd/stats", checkToken, requirePermission(PERMISSIONS.OPD_STATS), getOPDStats);
router.get("/opd/visits", checkToken, requirePermission(PERMISSIONS.OPD_VIEW_QUEUE), getAllVisits);
router.put("/opd/visits/:id/cancel", checkToken, requirePermission(PERMISSIONS.OPD_CANCEL_VISIT), cancelVisit);
router.get(
  "/opd/visits/patient/:abhaAddress",
  checkToken,
  requirePermission(PERMISSIONS.PATIENTS_VIEW_HISTORY),
  getPatientVisitHistory,
);

router.post(
  "/patient/register",
  checkToken,
  requirePermission(PERMISSIONS.PATIENTS_REGISTER),
  validate(registerPatientSchema),
  registerPatient,
);
router.post(
  "/patient/check-existing",
  checkToken,
  requirePermission(PERMISSIONS.PATIENTS_SEARCH),
  validate(checkExistingPatientsSchema),
  checkExistingPatients,
);
router.post("/patient/check-abha", checkToken, requirePermission(PERMISSIONS.PATIENTS_LINK_ABHA), checkAbhaNumber);
router.get("/patient/search", checkToken, requirePermission(PERMISSIONS.PATIENTS_SEARCH), searchPatients);
router.post(
  "/patient/:id/visit",
  checkToken,
  requirePermission(PERMISSIONS.OPD_ADD_VISIT),
  validate(addVisitSchema),
  addVisit,
);
router.patch(
  "/patient/:id",
  checkToken,
  requirePermission(PERMISSIONS.PATIENTS_UPDATE),
  validate(updatePatientSchema),
  updatePatient,
);
router.patch(
  "/patient/:id/update-and-visit",
  checkToken,
  requirePermission(PERMISSIONS.PATIENTS_UPDATE),
  validate(updatePatientAndAddVisitSchema),
  updatePatientAndAddVisit,
);
router.post("/patient/:id/link-abha", checkToken, requirePermission(PERMISSIONS.PATIENTS_LINK_ABHA), linkAbha);
router.post("/patient/link-to-abha", checkToken, requirePermission(PERMISSIONS.PATIENTS_LINK_ABHA), mergeAbhaPatient);
router.get("/patient/:id", checkToken, requirePermission(PERMISSIONS.PATIENTS_READ), getPatient);
router.get("/patients/all", checkToken, requirePermission(PERMISSIONS.PATIENTS_READ), getAllPatients);
router.get("/patients/:id", checkToken, requirePermission(PERMISSIONS.PATIENTS_READ), getPatient);
router.get("/patients", checkToken, requirePermission(PERMISSIONS.PATIENTS_READ), listPatients);
router.post("/patient/:id/notify2", checkToken, requirePermission(PERMISSIONS.SMS_SEND), sendDeepLinkSms);

router.post(
  "/visit/:visitId/clinical/prescription",
  checkToken,
  requirePermission(PERMISSIONS.CLINICAL_PRESCRIPTION_WRITE),
  recordPrescription,
);
router.get(
  "/visit/:visitId/clinical/prescription",
  checkToken,
  requireAnyPermission(PERMISSIONS.CLINICAL_PRESCRIPTION_READ, PERMISSIONS.PHARMACY_VIEW_ORDERS),
  getEnrichedPrescriptionByVisit,
);
router.post("/visit/:visitId/clinical/soap-notes", checkToken, requirePermission(PERMISSIONS.CLINICAL_SOAP_WRITE), recordSoapNotes);
router.get("/visit/:visitId/clinical/soap-notes", checkToken, requirePermission(PERMISSIONS.CLINICAL_SOAP_READ), getSoapNotes);
router.post(
  "/visit/:visitId/clinical/lab-results",
  checkToken,
  requirePermission(PERMISSIONS.LAB_ENTER_RESULTS),
  recordLabResults,
);
router.get("/visit/:visitId/clinical/lab-results", checkToken, requirePermission(PERMISSIONS.LAB_READ), getLabResults);
router.post(
  "/visit/:visitId/clinical/discharge-summary",
  checkToken,
  requirePermission(PERMISSIONS.CLINICAL_DISCHARGE_WRITE),
  recordDischargeSummary,
);
router.get(
  "/visit/:visitId/clinical/discharge-summary",
  checkToken,
  requirePermission(PERMISSIONS.CLINICAL_DISCHARGE_READ),
  getDischargeSummary,
);
router.post(
  "/visit/:visitId/clinical/immunization",
  checkToken,
  requirePermission(PERMISSIONS.CLINICAL_IMMUNIZATION_WRITE),
  recordImmunization,
);

router.post(
  "/visit/:visitId/clinical/assessment",
  checkToken,
  requirePermission(PERMISSIONS.CLINICAL_ASSESSMENT_WRITE),
  upload.array("files"),
  recordAssessment,
);

router.get("/visit/:visitId/clinical/assessment", checkToken, requirePermission(PERMISSIONS.CLINICAL_ASSESSMENT_READ), getAssessment);

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
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.listPending,
);
router.get(
  "/carecontext/patient/:patientId",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.listByPatient,
);
router.get("/carecontext/:id", checkToken, requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT), CareContextController.getById);
router.post(
  "/carecontext/create",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.createCareContext,
);
router.post(
  "/carecontext/:id/link",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.triggerLink,
);
router.post(
  "/carecontext/:id/retry",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.retryLink,
);
router.post(
  "/carecontext/patient/:patientId/link-all",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.linkAllForPatient,
);
router.post(
  "/carecontext/patient/:patientId/set-link-token",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.setLinkTokenForPatient,
);
router.post(
  "/carecontext/:id/notify",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_LINK_CARECONTEXT),
  CareContextController.retryNotify,
);

// Consent Management Routes (for frontend dashboard)
router.post("/consent/init", checkToken, requirePermission(PERMISSIONS.ABDM_CONSENT_INITIATE), consentInitRequest);
router.get("/consent/requests", checkToken, requirePermission(PERMISSIONS.ABDM_CONSENT_READ), getConsentRequests);
router.post("/consent/status", checkToken, requirePermission(PERMISSIONS.ABDM_CONSENT_READ), getConsentStatus);
router.get("/consent/artefacts", checkToken, requirePermission(PERMISSIONS.ABDM_CONSENT_READ), getConsentArtefacts);
router.post(
  "/consent/artefact/:artefactId/fetch",
  checkToken,
  requirePermission(PERMISSIONS.ABDM_CONSENT_READ),
  fetchArtefactDetails,
);

// HIU Routes (Data Fetch from other hospitals)
import hiuRoutes from "./hiu.routes";
router.use("/hiu", hiuRoutes);

// SMS Notification for patients without ABHA address
router.post(
  "/patient/:id/sms-notify",
  checkToken,
  requirePermission(PERMISSIONS.SMS_SEND),
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
router.get("/terminology/medicines", checkToken, requirePermission(PERMISSIONS.TERMINOLOGY_SEARCH), searchMedicinesCtrl);
router.get("/terminology/lab-tests", checkToken, requirePermission(PERMISSIONS.TERMINOLOGY_SEARCH), searchLabTestsCtrl);
router.get("/terminology/procedures", checkToken, requirePermission(PERMISSIONS.TERMINOLOGY_SEARCH), searchProceduresCtrl);
router.get("/terminology/conditions", checkToken, requirePermission(PERMISSIONS.TERMINOLOGY_SEARCH), searchConditionsCtrl);

// ── Lab Test Templates & Structured Lab Reports ──
router.get("/lab-tests/types", checkToken, requirePermission(PERMISSIONS.LAB_VIEW_TEMPLATES), getAvailableTestTypes);
router.get("/lab-tests/parameters/:testType", checkToken, requirePermission(PERMISSIONS.LAB_VIEW_TEMPLATES), getTestParameters);
router.post("/lab-reports/upsert", checkToken, requirePermission(PERMISSIONS.LAB_ENTER_RESULTS), upsertLabTest);
router.get("/lab-reports/visit/:visitId", checkToken, requirePermission(PERMISSIONS.LAB_READ), getVisitLabReport);
router.get("/lab-reports/patient/:patientId", checkToken, requirePermission(PERMISSIONS.LAB_READ), getPatientLabReports);
router.get("/lab-reports/:id", checkToken, requirePermission(PERMISSIONS.LAB_READ), getLabReport);
router.put("/lab-reports/:id/test/:testType", checkToken, requirePermission(PERMISSIONS.LAB_ENTER_RESULTS), updateLabTest);
router.patch("/lab-reports/:id/finalize", checkToken, requirePermission(PERMISSIONS.LAB_FINALIZE), finalizeLabReport);

// ── Pharmacy Dispensing Module ──
router.get("/pharmacy/queue", checkToken, requirePermission(PERMISSIONS.PHARMACY_VIEW_ORDERS), getPharmacyQueue);
router.get("/pharmacy/orders", checkToken, requirePermission(PERMISSIONS.PHARMACY_VIEW_ORDERS), getPharmacyQueue);
router.post("/pharmacy/dispense", checkToken, requirePermission(PERMISSIONS.PHARMACY_DISPENSE), dispensePrescription);
router.get("/pharmacy/dispense/by-visit/:visitId", checkToken, requirePermission(PERMISSIONS.PHARMACY_VIEW_ORDERS), getDispenseByVisit);

export default router;
