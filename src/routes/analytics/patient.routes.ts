import { Router } from "express";
import { auth } from "../../middlewares/user.authentication";
import { requirePermission } from "../../middlewares/permissions";
import { MODULES, ACTIONS } from "../../utils/permissions.constants";
import {
  getAgeDistribution,
  getVisitIntervals,
  getPatientSatisfaction,
  getPrimaryDiagnosis,
  getSecondaryDiagnosis,
  getSocialDeterminants,
  getDiagnosticTesting,
  getWellnessTraining,
  getInsuranceCoverage,
} from "../../controllers/analytics/patientAnalytics.controller";

const router = Router();

const analyticsGuard = [
  auth(),
  // requirePermission(MODULES.ANALYTICS_PATIENT, ACTIONS.VIEW),
];

router.get("/age-distribution", ...analyticsGuard, getAgeDistribution);
router.get("/visit-intervals", ...analyticsGuard, getVisitIntervals);
router.get("/satisfaction", ...analyticsGuard, getPatientSatisfaction);
router.get("/primary-diagnosis", ...analyticsGuard, getPrimaryDiagnosis);
router.get("/secondary-diagnosis", ...analyticsGuard, getSecondaryDiagnosis);
router.get("/social-determinants", ...analyticsGuard, getSocialDeterminants);
router.get("/diagnostic-testing", ...analyticsGuard, getDiagnosticTesting);
router.get("/wellness-training", ...analyticsGuard, getWellnessTraining);
router.get("/insurance-coverage", ...analyticsGuard, getInsuranceCoverage);

export default router;
