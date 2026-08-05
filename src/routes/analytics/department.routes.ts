import { Router } from "express";
import { auth } from "../../middlewares/user.authentication";
import { requirePermission } from "../../middlewares/permissions";
import { MODULES, ACTIONS } from "../../utils/permissions.constants";
import {
  getPatientLoadByDepartment,
  getAvgTimeToDiagnosis,
  getDiagnosticTestUtilization,
  getCaseComplexityIndex,
} from "../../controllers/analytics/departmentAnalytics.controller";

const router = Router();

const analyticsGuard = [
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
];

router.get("/patient-load", ...analyticsGuard, getPatientLoadByDepartment);

router.get("/avg-time-to-diagnosis", ...analyticsGuard, getAvgTimeToDiagnosis);

router.get(
  "/diagnostic-test-utilization",
  ...analyticsGuard,
  getDiagnosticTestUtilization
);

router.get("/case-complexity", ...analyticsGuard, getCaseComplexityIndex);

export default router;
