import { Schema, model, Document } from "mongoose";

export interface ILabTestParameter {
  name: string;
  unit: string;
  referenceRange: string;
  inputType: "number" | "text" | "select";
  options?: string[];
  section?: string;
  /** LOINC code for this individual parameter (used in ABDM FHIR Observation.code) */
  loincCode?: string;
  loincDisplay?: string;
}

export interface ILabTestTemplate extends Document {
  testType: string;
  displayName: string;
  uiType: "table" | "grouped_form" | "simple_form";
  parameters: ILabTestParameter[];
  /** LOINC panel code for this test type (used in ABDM FHIR DiagnosticReport.code) */
  loincCode?: string;
  /** Human-readable display for loincCode */
  loincDisplay?: string;
  /** HL7 v2-0074 category code (e.g. "HM", "UA", "CH") */
  categoryCode?: string;
  /** Display text for the HL7 v2-0074 category code */
  categoryDisplay?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const LabTestParameterSchema = new Schema<ILabTestParameter>(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: "", trim: true },
    referenceRange: { type: String, default: "", trim: true },
    inputType: {
      type: String,
      enum: ["number", "text", "select"],
      default: "number",
    },
    options: { type: [String], default: undefined },
    section: { type: String, trim: true },
    loincCode: { type: String, trim: true },
    loincDisplay: { type: String, trim: true },
  },
  { _id: false },
);

const LabTestTemplateSchema = new Schema<ILabTestTemplate>(
  {
    testType: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: { type: String, required: true, trim: true },
    uiType: {
      type: String,
      enum: ["table", "grouped_form", "simple_form"],
      required: true,
    },
    parameters: { type: [LabTestParameterSchema], required: true },
    loincCode: { type: String, trim: true },
    loincDisplay: { type: String, trim: true },
    categoryCode: { type: String, trim: true },
    categoryDisplay: { type: String, trim: true },
  },
  { timestamps: true },
);

export const LabTestTemplateModel = model<ILabTestTemplate>(
  "LabTestTemplate",
  LabTestTemplateSchema,
  "lab_test_templates",
);
