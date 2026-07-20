import { z } from "zod";
import {
  mongoIdSchema,
  emailSchema,
  phoneSchema,
  requiredString,
  optionalString,
} from "./common.schema";

const availableSlotSchema = z.object({
  day: z.enum([
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]),
  startTime: z.string().trim().min(1),
  endTime: z.string().trim().min(1),
});

const modulePermissionSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
});

export const permissionsSchema = z
  .record(z.string(), modulePermissionSchema)
  .optional();

export const updatePermissionsSchema = z.object({
  permissions: z.record(z.string(), modulePermissionSchema),
});

export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;

export const createDoctorSchema = z.object({
  fullName: optionalString,
  firstName: requiredString,
  lastName: requiredString,
  email: emailSchema,
  phone: phoneSchema.optional(),
  specialization: requiredString,
  // department: mongoIdSchema, 
  licenseNumber: requiredString,
  experience: z.number().min(0),
  qualification: requiredString,
  consultationFee: z.number().min(0),
  availableSlots: z.array(availableSlotSchema).optional(),

  gender: z.string().trim().optional(),
  age: z.number().int().min(0).optional(),
  profileImage: z.string().trim().url().optional(),
  primarySpecializationId: mongoIdSchema.optional(),
  additionalSpecializationIds: z.array(mongoIdSchema).optional(),
  hospital_id: mongoIdSchema.optional(),
  assignedHospitalUnitIds: z.array(mongoIdSchema).optional(),
  assignedPatientIds: z.array(mongoIdSchema).optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "RETIRED"]).optional(),
  accessLevel: z.enum(["FULL", "LIMITED", "VIEW_ONLY"]).optional(),
  permissions: permissionsSchema,
  timeZone: z.string().trim().optional(),
});

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;

export const updateDoctorSchema = createDoctorSchema.partial();

export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;

export const doctorIdParamSchema = z.object({
  id: mongoIdSchema,
});

export const setPasswordSchema = z.object({
  token: z
    .string()
    .length(64, "Invalid link format")
    .regex(/^[a-fA-F0-9]{64}$/, "Invalid link format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const updateDoctorStatusSchema = z.object({
  status: z.enum(["ACTIVE", "ON_LEAVE", "RETIRED"]),
});

export const updateDoctorCurrentStatusSchema = z.object({
  currentStatus: z.enum([
    "AVAILABLE",
    "CONSULTING",
    "ON_BREAK",
    "LEAVE",
    "OFF_DUTY",
    "NOT_AVAILABLE",
  ]),
  currentVisitId: mongoIdSchema.optional(),
});

export const updateAvailableSlotsSchema = z.object({
  availableSlots: z.array(availableSlotSchema).optional(),
  timeZone: z.string().trim().optional(),
});

export const listDoctorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  department: mongoIdSchema.optional(),
  specialization: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "RETIRED"]).optional(),
  currentStatus: z
    .enum([
      "AVAILABLE",
      "CONSULTING",
      "ON_BREAK",
      "LEAVE",
      "OFF_DUTY",
      "NOT_AVAILABLE",
    ])
    .optional(),
  accessLevel: z.enum(["FULL", "LIMITED", "VIEW_ONLY"]).optional(),
  search: z.string().trim().optional(),
  isActive: z.enum(["true", "false"]).optional(),
});

export const createLeaveSchema = z.object({
  fromDate: z.string().min(1).or(z.coerce.date()),
  toDate: z.string().min(1).or(z.coerce.date()),
  type: z.enum(["ANNUAL", "SICK", "OTHER"]),
  reason: z.string().trim().optional(),
});

export const updateLeaveStatusSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().trim().optional(),
});

export const doctorLeaveIdParamSchema = z.object({
  id: mongoIdSchema,
  leaveId: mongoIdSchema,
});
