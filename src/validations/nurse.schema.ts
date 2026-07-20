import { z } from "zod";
import {
  mongoIdSchema,
  emailSchema,
  phoneSchema,
  requiredString,
} from "./common.schema";
import { permissionsSchema } from "./doctor.schema";

export const createNurseSchema = z.object({
  firstName: requiredString,
  lastName: requiredString,
  email: emailSchema,
  phone: phoneSchema.optional(),
  specialization: requiredString,
  department: mongoIdSchema,
  licenseNumber: z.string().trim().optional(),
  experience: z.number().min(0).optional(),
  qualification: requiredString,

  shift: z.enum(["DAY", "NIGHT", "ROTATION"]).optional(),
  assignedDoctorId: mongoIdSchema.optional(),
  certifications: z.string().trim().optional(),
  roleType: z.string().trim().optional(),

  gender: z.string().trim().optional(),
  age: z.number().int().min(0).optional(),
  profileImage: z.string().trim().url().optional(),
  hospital_id: mongoIdSchema.optional(),
  assignedHospitalUnitIds: z.array(mongoIdSchema).optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "RETIRED", "INACTIVE"]).optional(),
  accessLevel: z.enum(["FULL", "LIMITED", "VIEW_ONLY"]).optional(),
  permissions: permissionsSchema,
  timeZone: z.string().trim().optional(),
});
