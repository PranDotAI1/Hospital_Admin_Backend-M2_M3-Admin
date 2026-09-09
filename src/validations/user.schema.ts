import { z } from "zod";
import {
  emailSchema,
  passwordSchema,
  mongoIdSchema,
  optionalCleanStringSchema,
  cleanStringSchema,
} from "./common.schema";

/**
 * Schema for User Add: POST /user/add and POST /user/new-add
 *
 * Validates all fields that get written to MongoDB via UserModel.create().
 * Previously: raw req.body went directly into MongoDB — an attacker could write
 * arbitrary fields including role_id, is_super_admin, password, etc.
 */
export const addUserSchema = z.object({
  // Required fields
  email: emailSchema,
  password: passwordSchema,

  // Name fields — at least one is required
  name: optionalCleanStringSchema(200),
  f_name: optionalCleanStringSchema(100),
  m_name: optionalCleanStringSchema(100),
  l_name: optionalCleanStringSchema(100),
  firstName: optionalCleanStringSchema(100),
  middleName: optionalCleanStringSchema(100),
  lastName: optionalCleanStringSchema(100),

  // Contact
  mobile: z
    .string()
    .optional()
    .refine((val) => !val || /^[6-9]\d{9}$/.test(val.trim()), {
      message: "Mobile must be a valid 10-digit number starting with 6-9",
    }),
  contact: optionalCleanStringSchema(20),

  // Role & org
  role_id: z.number().int().min(1).max(10).optional(),
  department_id: z.string().regex(/^[a-fA-F0-9]{24}$/, { message: "Invalid department ID" }).optional(),
  hospital_id: z.string().regex(/^[a-fA-F0-9]{24}$/, { message: "Invalid hospital ID" }).optional(),

  // Profile
  age: z.number().int().min(0).max(125).optional(),
  gender: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val || /^(male|female|other|m|f|o)$/i.test(val.trim()),
      { message: "Gender must be Male, Female, or Other" },
    ),
  shift: optionalCleanStringSchema(50),
  aadhaar: optionalCleanStringSchema(20),
  reg_no: optionalCleanStringSchema(50),
  pan: optionalCleanStringSchema(20),
  specialize: z.array(z.object({
    name: cleanStringSchema(100),
  })).optional(),
  status: z.number().int().min(0).max(10).optional(),
}).refine(
  (data) => {
    // At least one name field must be present
    return !!(data.name || data.f_name || data.firstName);
  },
  {
    message: "At least one name field (name, f_name, or firstName) is required",
    path: ["name"],
  },
);

export type AddUserInput = z.infer<typeof addUserSchema>;

/**
 * Schema for User Update: PUT /user/:id
 *
 * All fields optional — the controller's ALLOWED_UPDATE_FIELDS allowlist
 * already restricts which fields can be updated. This schema validates
 * the VALUES of those fields.
 */
export const updateUserSchema = z.object({
  name: optionalCleanStringSchema(200),
  f_name: optionalCleanStringSchema(100),
  m_name: optionalCleanStringSchema(100),
  l_name: optionalCleanStringSchema(100),
  firstName: optionalCleanStringSchema(100),
  middleName: optionalCleanStringSchema(100),
  lastName: optionalCleanStringSchema(100),
  mobile: z
    .string()
    .optional()
    .refine((val) => !val || /^[6-9]\d{9}$/.test(val.trim()), {
      message: "Mobile must be a valid 10-digit number starting with 6-9",
    }),
  contact: optionalCleanStringSchema(20),
  email: z
    .string()
    .email({ message: "Invalid email format" })
    .optional(),
  age: z.number().int().min(0).max(125).optional(),
  gender: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val || /^(male|female|other|m|f|o)$/i.test(val.trim()),
      { message: "Gender must be Male, Female, or Other" },
    ),
  shift: optionalCleanStringSchema(50),
  department_id: z.string().regex(/^[a-fA-F0-9]{24}$/, { message: "Invalid department ID" }).optional(),
  hospital_id: z.string().regex(/^[a-fA-F0-9]{24}$/, { message: "Invalid hospital ID" }).optional(),
  status: z.number().int().min(0).max(10).optional(),
  is_active: z.boolean().optional(),
  address: optionalCleanStringSchema(500),
  aadhaar: optionalCleanStringSchema(20),
  reg_no: optionalCleanStringSchema(50),
  pan: optionalCleanStringSchema(20),
  specialize: z.array(z.object({
    name: cleanStringSchema(100),
  })).optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
