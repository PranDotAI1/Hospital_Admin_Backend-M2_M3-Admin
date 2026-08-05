import { Router } from "express";
import { auth } from "../../middlewares/user.authentication";
import { requirePermission } from "../../middlewares/permissions";
import { MODULES, ACTIONS } from "../../utils/permissions.constants";
import {
  getLabProfileTrend,
  getLabPanelAverages,
  getLabScatterDistribution,
} from "../../controllers/analytics/laboratoryAnalytics.controller";

const router = Router();

const analyticsGuard = [
  auth(),
  requirePermission(MODULES.ANALYTICS_DASHBOARD, ACTIONS.VIEW),
];

router.get("/profile-trend", ...analyticsGuard, getLabProfileTrend);

router.get("/panel-averages", ...analyticsGuard, getLabPanelAverages);

router.get(
  "/scatter-distribution",
  ...analyticsGuard,
  getLabScatterDistribution
);

export default router;
