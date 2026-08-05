import { Router } from "express";
import { auth } from "../../middlewares/user.authentication";
import { requirePermission } from "../../middlewares/permissions";
import { MODULES, ACTIONS } from "../../utils/permissions.constants";
import {
  getStaffAllocationEfficiency,
  getLogisticsEfficiency,
  getOperationalCostPerPatient,
  getEquipmentUtilizationRate,
  getTicketResolutionTime,
  getITResourceUsage,
  getFacilityUtilizationRate,
} from "../../controllers/analytics/staffEfficiencyAnalytics.controller";

const router = Router();

const analyticsGuard = [
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
];

router.get("/staff-allocation", ...analyticsGuard, getStaffAllocationEfficiency);

router.get("/logistics-efficiency", ...analyticsGuard, getLogisticsEfficiency);

router.get("/operational-cost", ...analyticsGuard, getOperationalCostPerPatient);

router.get(
  "/equipment-utilization",
  ...analyticsGuard,
  getEquipmentUtilizationRate
);

router.get("/ticket-resolution", ...analyticsGuard, getTicketResolutionTime);

router.get("/it-resource-usage", ...analyticsGuard, getITResourceUsage);

router.get(
  "/facility-utilization",
  ...analyticsGuard,
  getFacilityUtilizationRate
);

export default router;
