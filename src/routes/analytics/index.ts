import { Router } from "express";
import physicianRouter from "./analytics.routes";
import patientRouter from "./patient.routes";
import dashboardRouter from "./dashboard.routes";
import departmentRouter from "./department.routes";
import laboratoryRouter from "./laboratory.routes";
import staffEfficiencyRouter from "./staffEfficiency.routes";

const router = Router();

router.use("/physicians", physicianRouter);
router.use("/patients", patientRouter);
router.use("/dashboard", dashboardRouter);
router.use("/departments", departmentRouter);
router.use("/laboratory", laboratoryRouter);
router.use("/staff-efficiency", staffEfficiencyRouter);

export default router;
