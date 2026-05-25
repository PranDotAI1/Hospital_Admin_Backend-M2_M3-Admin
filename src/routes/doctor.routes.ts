import { Router } from "express";
import { checkToken } from "../middlewares/user.authentication";
import { validate } from "../middlewares/validate";
import { setPasswordRateLimit } from "../middlewares/setPasswordRateLimit";
import { upload } from "../middlewares/upload.middleware";
import {
  bulkImportDoctors,
  exportDoctors,
  exportDoctorsPDF,
  downloadImportTemplate,
} from "../controllers/doctor/doctor.bulk.controller";
import {
  createDoctor,
  listDoctors,
  getDoctor,
  updateDoctor,
  updateDoctorStatus,
  updateDoctorCurrentStatus,
  setPassword,
  resendInvite,
  getAvailableSlots,
  updateAvailableSlots,
} from "../controllers/doctor/doctor.controller";
import {
  checkIn,
  checkOut,
  listAttendance,
  attendanceStats,
} from "../controllers/doctor/doctor.attendance.controller";
import {
  createLeave,
  listLeave,
  updateLeaveStatus,
  leaveStats,
} from "../controllers/doctor/doctor.leave.controller";
import {
  listPatientsLooked,
  patientsLookedStats,
} from "../controllers/doctor/doctor.patients.controller";
import {
  createDoctorSchema,
  doctorIdParamSchema,
  setPasswordSchema,
  updateDoctorStatusSchema,
  updateDoctorCurrentStatusSchema,
  updateAvailableSlotsSchema,
  createLeaveSchema,
} from "../validations/doctor.schema";

const router = Router();

router.post(
  "/set-password",
  setPasswordRateLimit,
  validate(setPasswordSchema, "body"),
  setPassword,
);

router.post(
  "/bulk-import",
  checkToken,
  upload.single("file"),
  bulkImportDoctors,
);

router.get("/export",
  // checkToken,
  exportDoctors);
router.get("/export/pdf",
  // checkToken,
  exportDoctorsPDF);
router.get("/bulk-import/template",
  // checkToken,
  downloadImportTemplate);

router.post(
  "/",
  checkToken,
  validate(createDoctorSchema, "body"),
  createDoctor,
);

router.get("/", checkToken, listDoctors);

router.get(
  "/:id",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  getDoctor,
);

router.put(
  "/:id",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  updateDoctor,
);

router.patch(
  "/:id/status",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  validate(updateDoctorStatusSchema, "body"),
  updateDoctorStatus,
);

router.patch(
  "/:id/current-status",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  validate(updateDoctorCurrentStatusSchema, "body"),
  updateDoctorCurrentStatus,
);

router.post(
  "/:id/invite/resend",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  resendInvite,
);

router.get(
  "/:id/available-slots",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  getAvailableSlots,
);

router.put(
  "/:id/available-slots",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  validate(updateAvailableSlotsSchema, "body"),
  updateAvailableSlots,
);

router.post(
  "/:id/attendance/check-in",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  checkIn,
);

router.post(
  "/:id/attendance/check-out",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  checkOut,
);

router.get(
  "/:id/attendance",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  listAttendance,
);

router.get(
  "/:id/attendance/stats",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  attendanceStats,
);

router.post(
  "/:id/leave",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  validate(createLeaveSchema, "body"),
  createLeave,
);

router.get(
  "/:id/leave",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  listLeave,
);

router.patch(
  "/:id/leave/:leaveId",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  updateLeaveStatus,
);

router.get(
  "/:id/leave/stats",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  leaveStats,
);

router.get(
  "/:id/patients",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  listPatientsLooked,
);

router.get(
  "/:id/patients/stats",
  checkToken,
  validate(doctorIdParamSchema, "params"),
  patientsLookedStats,
);

export default router;
