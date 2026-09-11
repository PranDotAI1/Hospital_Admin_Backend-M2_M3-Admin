import { z } from "zod";
import {
  containsDangerousHtmlOrScript,
  containsControlChars,
  isObjectSerialization,
  isStringifiedJson,
} from "../utils/sanitizer";

/**
 * Reusable Zod schema for clinical textual observations, diagnosis, notes, and instructions.
 * Strictly rejects:
 * - <script> blocks or any HTML tags (<img...>, <iframe...>, <div...>, etc.)
 * - Event handlers (onload=, onerror=, onclick=)
 * - Pseudo-protocols (javascript:, vbscript:, data:text/html)
 * - Object serialization artifacts ([object Object])
 * - Double-stringified JSON
 *
 * Safely permits:
 * - Mathematical comparisons (BP > 140, weight < 50, HbA1c > 7%)
 */
export const clinicalStringSchema = (maxLength: number = 5000) =>
  z
    .string()
    .max(maxLength, { message: `Maximum ${maxLength} characters allowed` })
    .refine((val) => !isStringifiedJson(val), {
      message: "Value appears to be a JSON-stringified string — send raw value",
    })
    .refine((val) => !containsDangerousHtmlOrScript(val), {
      message: "Value contains forbidden HTML tags, script blocks, or event handlers",
    })
    .refine((val) => !containsControlChars(val), {
      message: "Value contains invisible or control characters",
    })
    .refine((val) => !isObjectSerialization(val), {
      message: "Value contains [object Object] serialization artifact",
    });

export const optionalClinicalStringSchema = (maxLength: number = 5000) =>
  clinicalStringSchema(maxLength).optional();

// ─── SOAP NOTES SCHEMA ───────────────────────────────────────────────────────
export const recordSoapNotesSchema = z.object({
  subjective: optionalClinicalStringSchema(5000),
  objective: optionalClinicalStringSchema(5000),
  assessment: optionalClinicalStringSchema(5000),
  plan: optionalClinicalStringSchema(5000),
});

// ─── PRESCRIPTION SCHEMA ────────────────────────────────────────────────────
const medicationLineSchema = z.object({
  medicine: clinicalStringSchema(200),
  dosage: clinicalStringSchema(100),
  frequency: optionalClinicalStringSchema(100),
  duration: optionalClinicalStringSchema(50),
  instructions: optionalClinicalStringSchema(500),
  form: optionalClinicalStringSchema(100),
  route: optionalClinicalStringSchema(100),
  method: optionalClinicalStringSchema(100),
  durationUnit: optionalClinicalStringSchema(50),
  customInstructions: optionalClinicalStringSchema(500),
  snomedCode: optionalClinicalStringSchema(100),
  snomedDisplay: optionalClinicalStringSchema(200),
  timing: z
    .object({
      frequency: z.number().optional(),
      period: z.number().optional(),
      periodUnit: optionalClinicalStringSchema(50),
    })
    .optional(),
});

export const recordPrescriptionSchema = z.object({
  advice: optionalClinicalStringSchema(3000),
  medications: z.array(medicationLineSchema).optional(),
});

// ─── DISCHARGE SUMMARY SCHEMA ───────────────────────────────────────────────
export const recordDischargeSummarySchema = z.object({
  admissionDate: z.string().optional(),
  dischargeDate: z.string().optional(),
  ward: optionalClinicalStringSchema(100),
  bed: optionalClinicalStringSchema(50),
  diagnosis: optionalClinicalStringSchema(2000),
  conditionAtDischarge: optionalClinicalStringSchema(1000),
  clinicalSummary: optionalClinicalStringSchema(10000),
  admissionNotes: optionalClinicalStringSchema(5000),
  treatmentGiven: optionalClinicalStringSchema(5000),
  investigationsResults: optionalClinicalStringSchema(5000),
  followUpInstructions: optionalClinicalStringSchema(5000),
  surgicalProcedures: optionalClinicalStringSchema(5000),
  surgicalNote: optionalClinicalStringSchema(5000),
  doctorSignature: optionalClinicalStringSchema(200),
  dischargeMedications: z.array(z.any()).optional(),
});

// ─── LAB RESULTS SCHEMA ─────────────────────────────────────────────────────
export const recordLabResultsSchema = z.object({
  testName: optionalClinicalStringSchema(200),
  results: z.any().optional(),
  notes: optionalClinicalStringSchema(5000),
  status: optionalClinicalStringSchema(50),
});

// ─── PHARMACY DISPENSE SCHEMA ───────────────────────────────────────────────
export const pharmacyDispenseSchema = z.object({
  visit_id: z.string().min(1, "visit_id is required"),
  patient_id: z.string().optional(),
  pharmacist_notes: optionalClinicalStringSchema(2000),
  safety_checklist: z
    .object({
      dose_checked: z.boolean().optional(),
      allergy_verified: z.boolean().optional(),
      counseling_given: z.boolean().optional(),
      stock_verified: z.boolean().optional(),
    })
    .optional(),
  items: z.array(
    z.object({
      medication_id: optionalClinicalStringSchema(100),
      drug_name: clinicalStringSchema(200),
      batch_number: optionalClinicalStringSchema(100),
      expiry_date: optionalClinicalStringSchema(50),
      prescribed_qty: z.coerce.number().min(0),
      dispensed_qty: z.coerce.number().min(0),
      is_verified: z.boolean().optional(),
    })
  ).min(1, "At least one medication item is required"),
});

// ─── IMMUNIZATION SCHEMA ──────────────────────────────────────────────────────
const immunizationDoseSchema = z.object({
  date: z.string().optional(),
  manufacturer: optionalClinicalStringSchema(200),
  lotNumber: optionalClinicalStringSchema(100),
  doseNumber: z.union([z.number(), z.string()]).optional(),
}).optional();

export const recordImmunizationSchema = z.object({
  // Legacy flat date fields
  covid19Dose1Date: z.string().optional(),
  covid19Dose2Date: z.string().optional(),
  tetanusBoosterDate: z.string().optional(),
  fluVaccineDate: z.string().optional(),
  // Nested v2 dose objects
  covid19Dose1: immunizationDoseSchema,
  covid19Dose2: immunizationDoseSchema,
  tetanusBooster: immunizationDoseSchema,
  fluVaccine: immunizationDoseSchema,
});

// ─── ASSESSMENT SCHEMA ─────────────────────────────────────────────────────────
// Assessment accepts multipart/form-data (file uploads), so body fields may
// arrive as JSON strings. The controller's parseIfString() handles that.
// This schema validates the parsed structure to reject XSS in text fields.
const medicalHistoryEntrySchema = z.object({
  condition: optionalClinicalStringSchema(200),
  diagnosedYear: z.union([z.string(), z.number()]).optional(),
  status: optionalClinicalStringSchema(50),
  medication: optionalClinicalStringSchema(300),
  notes: optionalClinicalStringSchema(1000),
}).passthrough();

const surgicalHistoryEntrySchema = z.object({
  procedure: optionalClinicalStringSchema(300),
  year: z.union([z.string(), z.number()]).optional(),
  hospital: optionalClinicalStringSchema(200),
  surgeon: optionalClinicalStringSchema(200),
  notes: optionalClinicalStringSchema(1000),
  complications: optionalClinicalStringSchema(500),
}).passthrough();

export const recordAssessmentSchema = z.object({
  vitals: z.any().optional(),
  immunization: z.any().optional(), // validated separately in controller
  symptomsComplaints: optionalClinicalStringSchema(5000),
  medicalHistory: z.union([
    z.array(medicalHistoryEntrySchema),
    z.string(), // may arrive as JSON string from form-data
  ]).optional(),
  surgicalHistory: z.union([
    z.array(surgicalHistoryEntrySchema),
    z.string(),
  ]).optional(),
  physicalActivity: z.any().optional(),
  lifestyle: z.any().optional(),
  womenHealth: z.any().optional(),
});

// ─── LAB REPORT UPSERT SCHEMA ──────────────────────────────────────────────────
const labParameterSchema = z.object({
  parameterName: clinicalStringSchema(200),
  parameterValue: z.union([z.string(), z.number(), z.null()]).optional(),
  unit: optionalClinicalStringSchema(50),
  normalRange: optionalClinicalStringSchema(100),
  loincCode: optionalClinicalStringSchema(50),
  loincDisplay: optionalClinicalStringSchema(200),
  interpretation: optionalClinicalStringSchema(200),
  isAbnormal: z.boolean().optional(),
}).passthrough();

export const labReportUpsertSchema = z.object({
  patientId: z.string().min(1, "patientId is required"),
  visitId: z.string().optional(),
  sampleId: z.string().min(1, "sampleId is required"),
  testType: z.string().min(1, "testType is required"),
  equipmentId: optionalClinicalStringSchema(100),
  captureTime: z.string().optional(),
  reportDate: z.string().min(1, "reportDate is required"),
  reportTime: z.string().optional(),
  analystName: clinicalStringSchema(200),
  observations: optionalClinicalStringSchema(5000),
  equipmentStatus: optionalClinicalStringSchema(50),
  createdBy: z.string().optional(),
  loincCode: optionalClinicalStringSchema(50),
  loincDisplay: optionalClinicalStringSchema(200),
  parameters: z.array(labParameterSchema).min(1, "At least one parameter is required"),
});

// ─── LAB REPORT UPDATE TEST SCHEMA ──────────────────────────────────────────────
export const labReportUpdateTestSchema = z.object({
  parameters: z.array(labParameterSchema).optional(),
  observations: optionalClinicalStringSchema(5000),
  reportDate: z.string().optional(),
  reportTime: z.string().optional(),
  analystName: optionalClinicalStringSchema(200),
  equipmentId: optionalClinicalStringSchema(100),
  equipmentStatus: optionalClinicalStringSchema(50),
  captureTime: z.string().optional(),
  sampleId: optionalClinicalStringSchema(100),
});

// ─── BILLING SCHEMA ────────────────────────────────────────────────────────────
const billingLineSchema = z.object({
  description: optionalClinicalStringSchema(500),
  procedureName: optionalClinicalStringSchema(300),
  name: optionalClinicalStringSchema(300),
  rate: z.coerce.number().min(0).optional(),
  mrp: z.coerce.number().min(0).optional(),
  unit: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  cgst: z.coerce.number().min(0).max(100).optional(),
  sgst: z.coerce.number().min(0).max(100).optional(),
  amount: z.coerce.number().optional(),
  hsnCode: optionalClinicalStringSchema(20),
}).passthrough();

export const createBillingSchema = z.object({
  visitId: z.string().min(1, "visitId is required"),
  billings: z.array(billingLineSchema).optional(),
  totalAmount: z.coerce.number().optional(),
  date: z.string().optional(),
  status: optionalClinicalStringSchema(50),
});

export const updateBillingSchema = z.object({
  billings: z.array(billingLineSchema).optional(),
  totalAmount: z.coerce.number().optional(),
  date: z.string().optional(),
  status: optionalClinicalStringSchema(50),
}).passthrough();

// ─── PASSWORD UPDATE SCHEMA ────────────────────────────────────────────────────
export const updatePasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
  currentPassword: z.string().optional(),
});
