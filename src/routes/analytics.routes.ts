import { Router } from "express";
import { auth } from "../middlewares/user.authentication";
import { requirePermission } from "../middlewares/permissions";
import { MODULES, ACTIONS } from "../utils/permissions.constants";
import {
  getPhysicianAnalyticsSummary,
  getPhysicianAnalyticsTable,
} from "../controllers/analytics/physicianAnalytics.controller";

const router = Router();

router.get(
  "/summary",
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
  getPhysicianAnalyticsSummary,
);

router.get(
  "/table",
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
  getPhysicianAnalyticsTable,
);

export default router;
