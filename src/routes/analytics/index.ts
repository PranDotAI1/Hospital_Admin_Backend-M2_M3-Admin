import { Router } from "express";
import physicianRouter from "../analytics.routes"; 
import patientRouter from "./patient.routes";
import dashboardRouter from "./dashboard.routes";

const router = Router();

router.use("/physicians", physicianRouter);
router.use("/patients",   patientRouter);
router.use("/dashboard",  dashboardRouter);

export default router;
