import { Router } from "express";
import { checkToken, auth } from "../middlewares/user.authentication";
import { requirePermission } from "../middlewares/permissions";
import { MODULES, ACTIONS } from "../utils/permissions.constants";
import { submitFeedback, listFeedback, getFeedbackByVisit } from "../controllers/feedback.controller";

const router = Router();

router.post("/", submitFeedback);

router.get(
  "/",
  auth(),
  requirePermission(MODULES.FEEDBACK_MANAGEMENT, ACTIONS.VIEW),
  listFeedback
);

router.get(
  "/visit/:visitId",
  checkToken,
  getFeedbackByVisit
);

export default router;
