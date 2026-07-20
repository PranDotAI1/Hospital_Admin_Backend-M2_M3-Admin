import { Router } from "express";
import { auth } from "../../middlewares/user.authentication";
import { requirePermission } from "../../middlewares/permissions";
import { MODULES, ACTIONS } from "../../utils/permissions.constants";
import {
  getRecoveryRates,
  getComplicationRates,
  getComplicationTypes,
  getSurvivalRates,
  getServiceDelivery,
  getInfectionRates,
  getResourceUtilization,
  getEquipmentUtilization,
  getFacilityUtilization,
  getStaffAllocation,
  getRevenuePerPatient,
  getPatientSafety,
  getIncidentReporting,
} from "../../controllers/analytics/dashboardAnalytics.controller";

const router = Router();

const analyticsGuard = [
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
];

router.get("/recovery-rates", ...analyticsGuard, getRecoveryRates);

router.get("/complication-rates", ...analyticsGuard, getComplicationRates);

router.get("/complication-types", ...analyticsGuard, getComplicationTypes);

router.get("/survival-rates", ...analyticsGuard, getSurvivalRates);

router.get("/service-delivery", ...analyticsGuard, getServiceDelivery);

router.get("/infection-rates", ...analyticsGuard, getInfectionRates);

router.get("/resource-utilization", ...analyticsGuard, getResourceUtilization);

router.get("/equipment-utilization", ...analyticsGuard, getEquipmentUtilization);

router.get("/facility-utilization", ...analyticsGuard, getFacilityUtilization);

router.get("/staff-allocation", ...analyticsGuard, getStaffAllocation);

router.get("/revenue-per-patient", ...analyticsGuard, getRevenuePerPatient);

router.get("/patient-safety", ...analyticsGuard, getPatientSafety);

router.get("/incident-reporting", ...analyticsGuard, getIncidentReporting);

export default router;
