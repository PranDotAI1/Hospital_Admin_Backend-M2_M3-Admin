import { z } from "zod";
import {
  isValidPatientName,
  isValidMobile,
  isValidDob,
  validateAge,
} from "../utils/sanitizer";
import { optionalCleanStringSchema } from "./common.schema";

/**
 * Custom Zod refinement for Human Name fields.
 * Rejects [object Object], HTML/script tags, numbers, and 1-character names.
 */
const patientNameSchema = z
  .string()
  .min(2, { message: "Name must be at least 2 characters" })
  .max(100, { message: "Name must be at most 100 characters" })
  .refine(
    (val) => isValidPatientName(val, { minLength: 2, maxLength: 100, required: true }),
    {
      message:
        "Name contains invalid characters, script tags, numbers, or is too short",
    },
  );

const optionalPatientNameSchema = z
  .string()
  .max(100, { message: "Name must be at most 100 characters" })
  .optional()
  .refine(
    (val) => !val || isValidPatientName(val, { minLength: 1, maxLength: 100, required: false }),
    {
      message: "Name contains invalid characters, script tags, or numbers",
    },
  );

/**
 * Custom Zod refinement for Indian 10-digit Mobile Numbers.
 */
const patientMobileSchema = z
  .string()
  .trim()
  .refine((val) => isValidMobile(val), {
    message: "Valid mobile number is required (10 digits starting with 6-9)",
  });

/**
 * Custom Zod refinement for Date of Birth.
 */
const patientDobSchema = z
  .string()
  .optional()
  .refine((val) => !val || isValidDob(val), {
    message: "Date of birth must be a valid past date in YYYY-MM-DD format",
  });

/**
 * Pure validation for Age — no transforms, no silent normalization.
 * Rejects bad input with descriptive errors.
 */
const patientAgeSchema = z
  .union([z.string(), z.number()])
  .optional()
  .refine(
    (val) => {
      if (val === undefined || val === null || val === "") return true;
      return validateAge(val).valid;
    },
    { message: "Age must be an integer between 0 and 125" },
  );

/**
 * Schema for Patient Registration: POST /patient/register
 *
 * f_name and firstName now use optionalPatientNameSchema (same as m_name/l_name)
 * instead of raw z.string().optional() — they go through full name validation.
 * The top-level .refine() still enforces that at least one first name is present and valid.
 */
export const registerPatientSchema = z.object({
  f_name: optionalPatientNameSchema,
  firstName: optionalPatientNameSchema,
  m_name: optionalPatientNameSchema,
  middleName: optionalPatientNameSchema,
  l_name: optionalPatientNameSchema,
  lastName: optionalPatientNameSchema,
  mobile: patientMobileSchema,
  dob: patientDobSchema,
  age: patientAgeSchema,
  gender: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val ||
        /^(male|female|other|transgender|m|f|o)$/i.test(val.trim()),
      { message: "Gender must be Male, Female, Other, or Transgender" },
    ),
  address: optionalCleanStringSchema(500),
  pincode: z
    .string()
    .optional()
    .refine((val) => !val || /^\d{6}$/.test(val.trim()), {
      message: "Pincode must be 6 digits",
    }),
  email: z
    .string()
    .email({ message: "Invalid email format" })
    .optional()
    .or(z.literal("")),
  bloodGroup: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val ||
        /^(A|B|AB|O)[+-]$/i.test(val.trim()),
      { message: "Invalid blood group (e.g., A+, O-, B+)" },
    ),
  emergencyContact: z
    .string()
    .optional()
    .refine((val) => !val || /^[6-9]\d{9}$/.test(val.trim()), {
      message: "Emergency contact must be a valid 10-digit mobile number",
    }),
  aadhaarNumber: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const digits = val.replace(/\D/g, "");
        return digits.length === 12 || /^[X*]{4}-?[X*]{4}-?\d{4}$/i.test(val.trim());
      },
      { message: "Aadhaar number must be 12 digits" },
    ),
  abhaNumber: optionalCleanStringSchema(20),
  ABHANumber: optionalCleanStringSchema(20),
  abha_number: optionalCleanStringSchema(20),
  abhaAddress: optionalCleanStringSchema(100),
  abhaaddress: optionalCleanStringSchema(100),
  abha_id: optionalCleanStringSchema(100),
  abhaId: optionalCleanStringSchema(100),
  consultingDoctor: optionalCleanStringSchema(100),
  consultingDoctorId: z.string().optional(),
  department: optionalCleanStringSchema(100),
  departmentId: z.string().optional(),
}).refine(
  (data) => {
    const rawFirst = data.f_name || data.firstName;
    return typeof rawFirst === "string" && isValidPatientName(rawFirst, { minLength: 2, maxLength: 100, required: true });
  },
  {
    message: "Valid first name (f_name) is required (minimum 2 letters, no numbers or HTML)",
    path: ["f_name"],
  },
);

/**
 * Schema for Patient Update: PATCH /patient/:id
 */
export const updatePatientSchema = z.object({
  f_name: optionalPatientNameSchema,
  firstName: optionalPatientNameSchema,
  m_name: optionalPatientNameSchema,
  middleName: optionalPatientNameSchema,
  l_name: optionalPatientNameSchema,
  lastName: optionalPatientNameSchema,
  mobile: z
    .string()
    .optional()
    .refine((val) => !val || isValidMobile(val), {
      message: "Mobile must be a valid 10-digit number starting with 6-9",
    }),
  dob: patientDobSchema,
  age: patientAgeSchema,
  gender: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val ||
        /^(male|female|other|transgender|m|f|o)$/i.test(val.trim()),
      { message: "Gender must be Male, Female, Other, or Transgender" },
    ),
  address: optionalCleanStringSchema(500),
  pincode: z
    .string()
    .optional()
    .refine((val) => !val || /^\d{6}$/.test(val.trim()), {
      message: "Pincode must be 6 digits",
    }),
  email: z
    .string()
    .email({ message: "Invalid email format" })
    .optional()
    .or(z.literal("")),
  bloodGroup: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val ||
        /^(A|B|AB|O)[+-]$/i.test(val.trim()),
      { message: "Invalid blood group (e.g., A+, O-, B+)" },
    ),
  emergencyContact: z
    .string()
    .optional()
    .refine((val) => !val || /^[6-9]\d{9}$/.test(val.trim()), {
      message: "Emergency contact must be a valid 10-digit mobile number",
    }),
  aadhaarNumber: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        const digits = val.replace(/\D/g, "");
        return digits.length === 12 || /^[X*]{4}-?[X*]{4}-?\d{4}$/i.test(val.trim());
      },
      { message: "Aadhaar number must be 12 digits" },
    ),
  allergies: optionalCleanStringSchema(500),
  existingMedicalConditions: optionalCleanStringSchema(500),
  ongoingMedications: optionalCleanStringSchema(500),
  insurance: z
    .object({
      provider: optionalCleanStringSchema(100),
      policyNumber: optionalCleanStringSchema(50),
    })
    .optional(),
});

/**
 * Schema for Patient Update and Visit: PATCH /patient/:id/update-and-visit
 */
export const updatePatientAndAddVisitSchema = updatePatientSchema.extend({
  consultingDoctor: optionalCleanStringSchema(100),
  consultingDoctorId: z.string().optional(),
  department: optionalCleanStringSchema(100),
  departmentId: z.string().optional(),
  visitType: optionalCleanStringSchema(100),
  description: optionalCleanStringSchema(1000),
});

/**
 * Schema for Add Visit: POST /patient/:id/visit
 */
export const addVisitSchema = z.object({
  consultingDoctor: optionalCleanStringSchema(100),
  consultingDoctorId: z.string().optional(),
  doctorName: optionalCleanStringSchema(100),
  doctorId: z.string().optional(),
  department: optionalCleanStringSchema(100),
  departmentId: z.string().optional(),
  visitType: optionalCleanStringSchema(100),
  description: optionalCleanStringSchema(1000),
});

/**
 * Schema for Check Existing Patients: POST /patient/check-existing
 *
 * Previously all z.string().optional() with zero validation.
 * Now each field rejects stringified JSON, HTML, control chars, and [object Object].
 */
export const checkExistingPatientsSchema = z.object({
  mobile: z
    .string()
    .optional()
    .refine((val) => !val || isValidMobile(val), {
      message: "Valid 10-digit mobile number starting with 6-9 required",
    }),
  name: optionalCleanStringSchema(200),
  f_name: optionalCleanStringSchema(100),
  firstName: optionalCleanStringSchema(100),
  dob: z
    .string()
    .optional()
    .refine((val) => !val || isValidDob(val), {
      message: "Date of birth must be a valid date in YYYY-MM-DD format",
    }),
  abhaAddress: optionalCleanStringSchema(100),
  abhaNumber: optionalCleanStringSchema(20),
});
