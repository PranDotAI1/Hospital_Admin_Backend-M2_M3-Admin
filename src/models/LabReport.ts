import { Schema, model, Document, Types } from "mongoose";

export interface ILabReportParameter {
  parameterName: string;
  parameterValue: string;
  unit: string;
  referenceRange: string;
  flag: "Normal" | "High" | "Low" | "";
  section?: string;
  /** LOINC code for this parameter (used in ABDM FHIR Observation.code) */
  loincCode?: string;
  loincDisplay?: string;
}

/**
 * A single test-type entry within a centralized lab report.
 * One LabReport document can contain multiple test types (e.g. CBC, Blood Sugar).
 */
export interface ILabTestEntry {
  testType: string;
  sampleId: string;
  reportDate: Date;
  reportTime?: string;
  analystName: string;
  equipmentId?: string;
  captureTime?: Date;
  observations?: string;
  equipmentStatus?: string;
  status: "draft" | "final";
  parameters: ILabReportParameter[];
  loincCode?: string;
  loincDisplay?: string;
}

/**
 * Centralized lab report: one document per patient+visit.
 * All test types for the same visit are stored as entries in `tests[]`.
 */
export interface ILabReport extends Document {
  patientId: Types.ObjectId;
  visitId?: Types.ObjectId;
  createdBy?: string;
  /** Overall record status — becomes "final" when all tests are finalized */
  status: "draft" | "final";
  tests: ILabTestEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

const LabReportParameterSchema = new Schema<ILabReportParameter>(
  {
    parameterName: { type: String, required: true, trim: true },
    parameterValue: { type: String, default: "", trim: true },
    unit: { type: String, default: "", trim: true },
    referenceRange: { type: String, default: "", trim: true },
    flag: {
      type: String,
      enum: ["Normal", "High", "Low", ""],
      default: "",
    },
    section: { type: String, trim: true },
    loincCode: { type: String, trim: true },
    loincDisplay: { type: String, trim: true },
  },
  { _id: false },
);

const LabTestEntrySchema = new Schema<ILabTestEntry>(
  {
    testType: { type: String, required: true, trim: true, lowercase: true },
    sampleId: { type: String, required: true, trim: true },
    reportDate: { type: Date, required: true },
    reportTime: { type: String, trim: true },
    analystName: { type: String, required: true, trim: true },
    equipmentId: { type: String, trim: true },
    captureTime: { type: Date },
    observations: { type: String, trim: true },
    equipmentStatus: { type: String, trim: true },
    status: { type: String, enum: ["draft", "final"], default: "draft" },
    parameters: { type: [LabReportParameterSchema], default: [] },
    loincCode: { type: String, trim: true },
    loincDisplay: { type: String, trim: true },
  },
  { _id: false },
);

const LabReportSchema = new Schema<ILabReport>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Patient",
      index: true,
    },
    visitId: { type: Schema.Types.ObjectId, index: true },
    createdBy: { type: String, trim: true },
    status: {
      type: String,
      enum: ["draft", "final"],
      default: "draft",
    },
    tests: { type: [LabTestEntrySchema], default: [] },
  },
  { timestamps: true },
);

/** One centralized record per patient+visit */
LabReportSchema.index({ patientId: 1, visitId: 1 });

export const LabReportModel = model<ILabReport>(
  "LabReport",
  LabReportSchema,
  "lab_reports",
);
