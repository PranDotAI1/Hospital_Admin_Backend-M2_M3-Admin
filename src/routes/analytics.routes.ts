import { Router } from "express";
import { checkToken } from "../middlewares/user.authentication";
import {
  getPhysicianAnalyticsSummary,
  getPhysicianAnalyticsTable,
} from "../controllers/analytics/physicianAnalytics.controller";

const router = Router();

router.get("/summary", checkToken, getPhysicianAnalyticsSummary);

router.get("/table", checkToken, getPhysicianAnalyticsTable);

export default router;
