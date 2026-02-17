import express from "express";
import { DayCareBillingController } from "../controllers/billing.controller";

const router = express.Router();

router.post("/", DayCareBillingController.createDayCareBilling);
router.get("/", DayCareBillingController.getAllDayCareBillings);
router.get("/:id", DayCareBillingController.getDayCareBilling);
router.put("/:id", DayCareBillingController.updateDayCareBilling);

export default router;
