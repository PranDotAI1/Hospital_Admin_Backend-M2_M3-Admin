import { Router } from "express";
import { auth, checkToken } from "../middlewares/user.authentication";
import { requirePermission } from "../middlewares/permissions";
import { MODULES, ACTIONS } from "../utils/permissions.constants";
import { upsertUtilization, listUtilization, getLatestUtilization } from "../controllers/resources.controller";

const router = Router();

router.post(
  "/utilization",
  auth(),
  requirePermission(MODULES.RESOURCE_MANAGEMENT, ACTIONS.CREATE),
  upsertUtilization
);

router.get("/utilization/latest", checkToken, getLatestUtilization);

router.get(
  "/utilization",
  auth(),
  requirePermission(MODULES.RESOURCE_MANAGEMENT, ACTIONS.VIEW),
  listUtilization
);

export default router;
