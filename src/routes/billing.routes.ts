import express from "express";
import { DayCareBillingController } from "../controllers/billing.controller";
import { checkToken } from "../middlewares/user.authentication";
import { requirePermission, requireAnyPermission } from "../middlewares/permission.middleware";
import { PERMISSIONS } from "../utils/permissions";
import { validate } from "../middlewares/validate";
import { createBillingSchema, updateBillingSchema } from "../validations/clinical.schema";

const router = express.Router();

router.post("/", checkToken, requirePermission(PERMISSIONS.BILLING_CREATE), validate(createBillingSchema), DayCareBillingController.createDayCareBilling);
router.get("/", checkToken, requireAnyPermission(PERMISSIONS.BILLING_READ, PERMISSIONS.BILLING_CREATE), DayCareBillingController.getAllDayCareBillings);
router.get("/:id", checkToken, requirePermission(PERMISSIONS.BILLING_READ), DayCareBillingController.getDayCareBilling);
router.get("/visit/:visitId", checkToken, requirePermission(PERMISSIONS.BILLING_READ), DayCareBillingController.getBillingByVisitId);
router.put("/:id", checkToken, requirePermission(PERMISSIONS.BILLING_CREATE), validate(updateBillingSchema), DayCareBillingController.updateDayCareBilling);

export default router;
