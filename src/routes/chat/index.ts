import { Router } from "express";
import { validate } from "../../middlewares/validate";
import { requireBotToken } from "../../middlewares/botAuth.middleware";
import {
  botTokenSchema,
  patientLookupSchema,
  patientRegisterChatSchema,
  otpSendSchema,
  otpVerifySchema,
  appointmentBookSchema,
  appointmentRescheduleSchema,
  appointmentCancelSchema,
  notificationSendSchema,
} from "../../validations/chat.schema";

import { generateBotToken } from "../../controllers/chat/auth.controller";
import { getDepartments } from "../../controllers/chat/department.controller";
import {
  getDoctors,
  getDoctorById,
  getDoctorSlots,
} from "../../controllers/chat/doctor.controller";
import {
  lookupPatient,
  registerPatient,
} from "../../controllers/chat/patient.controller";
import { sendOtp, verifyOtp } from "../../controllers/chat/otp.controller";
import {
  bookAppointment,
  getAppointments,
  rescheduleAppointment,
  cancelAppointment,
} from "../../controllers/chat/appointment.controller";
import { sendNotification } from "../../controllers/chat/notification.controller";

const router = Router();

router.post(
  "/auth/token",
  validate(botTokenSchema, "body"),
  generateBotToken,
);
router.post(
  "/token",
  validate(botTokenSchema, "body"),
  generateBotToken,
);

router.use(requireBotToken);

router.get("/departments", getDepartments);

router.get("/doctors", getDoctors);
router.get("/doctors/:id/slots", getDoctorSlots);
router.get("/doctors/:id", getDoctorById);

router.get(
  "/patients/lookup",
  validate(patientLookupSchema, "query"),
  lookupPatient,
);
router.post(
  "/patients/register",
  validate(patientRegisterChatSchema, "body"),
  registerPatient,
);

router.post("/otp/send", validate(otpSendSchema, "body"), sendOtp);
router.post("/otp/verify", validate(otpVerifySchema, "body"), verifyOtp);

router.post(
  "/appointments/book",
  validate(appointmentBookSchema, "body"),
  bookAppointment,
);
router.get("/appointments", getAppointments);
router.patch(
  "/appointments/:id",
  validate(appointmentRescheduleSchema, "body"),
  rescheduleAppointment,
);
router.delete(
  "/appointments/:id",
  validate(appointmentCancelSchema, "body"),
  cancelAppointment,
);

router.post(
  "/notifications/send",
  validate(notificationSendSchema, "body"),
  sendNotification,
);

export default router;
