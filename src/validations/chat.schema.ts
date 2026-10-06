import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const patientLookupSchema = z
  .object({
    mobile: z.string().trim().optional(),
    uhid: z.string().trim().optional(),
  })
  .refine((data) => Boolean(data.mobile || data.uhid), {
    message: "Either mobile number or UHID must be provided for lookup",
    path: ["mobile"],
  });

export const patientRegisterChatSchema = z.object({
  f_name: z.string().trim().min(1, "First name is required").max(100),
  l_name: z.string().trim().max(100).optional(),
  name: z.string().trim().max(200).optional(),
  mobile: z
    .string()
    .trim()
    .min(10, "Mobile must be at least 10 digits")
    .max(15)
    .regex(/^[0-9+\s-]+$/, "Invalid mobile number format"),
  gender: z
    .enum(["M", "F", "O", "Male", "Female", "Other", "MALE", "FEMALE", "OTHER"])
    .optional(),
  dob: z
    .string()
    .trim()
    .regex(dateRegex, "Date of birth must be in YYYY-MM-DD format")
    .optional(),
  age: z.union([z.string(), z.number()]).optional(),
  email: z.string().trim().email("Invalid email format").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  pincode: z.string().trim().max(10).optional(),
});

export const otpSendSchema = z.object({
  mobile: z
    .string()
    .trim()
    .min(10, "Mobile must be at least 10 digits")
    .max(15),
  channel: z.enum(["sms", "whatsapp", "email"]).optional().default("sms"),
  email: z.string().trim().email("Invalid email format").optional(),
});

export const otpVerifySchema = z.object({
  mobile: z.string().trim().min(10, "Mobile must be at least 10 digits"),
  otp: z.string().trim().min(4, "OTP must be at least 4 characters").max(8),
  txnId: z.string().trim().optional(),
});

export const appointmentBookSchema = z.object({
  patientId: z
    .string()
    .trim()
    .regex(objectIdRegex, "Invalid patientId ObjectId format"),
  doctorId: z
    .string()
    .trim()
    .regex(objectIdRegex, "Invalid doctorId ObjectId format"),
  departmentId: z
    .string()
    .trim()
    .regex(objectIdRegex, "Invalid departmentId ObjectId format")
    .optional(),
  appointmentDate: z
    .string()
    .trim()
    .regex(dateRegex, "appointmentDate must be in YYYY-MM-DD format"),
  slot: z.object({
    startTime: z
      .string()
      .trim()
      .regex(timeRegex, "startTime must be in HH:mm (24-hour) format, e.g. 09:30"),
    endTime: z
      .string()
      .trim()
      .regex(timeRegex, "endTime must be in HH:mm (24-hour) format, e.g. 10:00"),
  }),
  consultationFee: z.number().min(0).optional(),
  patientNotes: z.string().trim().max(1000).optional(),
  bookingChannel: z.enum(["CHAT", "PORTAL", "ADMIN"]).optional().default("CHAT"),
});

export const appointmentRescheduleSchema = z.object({
  newDate: z
    .string()
    .trim()
    .regex(dateRegex, "newDate must be in YYYY-MM-DD format"),
  newSlot: z.object({
    startTime: z
      .string()
      .trim()
      .regex(timeRegex, "startTime must be in HH:mm (24-hour) format, e.g. 09:30"),
    endTime: z
      .string()
      .trim()
      .regex(timeRegex, "endTime must be in HH:mm (24-hour) format, e.g. 10:00"),
  }),
  reason: z.string().trim().max(500).optional(),
});

export const appointmentCancelSchema = z.object({
  cancellationReason: z.string().trim().max(500).optional(),
});

export const notificationSendSchema = z.object({
  recipient: z.string().trim().min(1, "Recipient is required"),
  channel: z.enum(["email", "sms", "whatsapp"]).optional().default("email"),
  type: z.string().trim().optional().default("APPOINTMENT_CONFIRMATION"),
  data: z.record(z.string(), z.any()).default({}),
  message: z.string().trim().optional(),
});

export const botTokenSchema = z
  .object({
    session: z.string().trim().optional(),
    service: z.string().trim().optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough()
  .optional()
  .default({});
