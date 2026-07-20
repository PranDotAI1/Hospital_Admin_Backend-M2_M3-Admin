import { Schema, model, Document, Types } from "mongoose";

export interface IDischargeMedication {
  medicine: string;
  dosage: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  form?: string;
  route?: string;
  method?: string;
  timing?: {
    frequency: number;
    period: number;
    periodUnit: string;
  };
  durationUnit?: string;
  customInstructions?: string;
  /** SNOMED CT Clinical Drug code (per ABDM ndhm-medicine-codes ValueSet) */
  snomedCode?: string;
  /** SNOMED CT display text for the medicine (e.g. "Acetaminophen 500 mg oral tablet") */
  snomedDisplay?: string;
}

export interface IVisitDischargeSummary extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  admissionDate?: Date;
  dischargeDate?: Date;
  ward?: string;
  bed?: string;
  diagnosis?: string;
  conditionAtDischarge?: string;
  clinicalSummary?: string;
  admissionNotes?: string;
  treatmentGiven?: string;
  investigationsResults?: string;
  followUpInstructions?: string;
  surgicalProcedures?: string;
  surgicalNote?: string;
  doctorSignature?: string;
  dischargeMedications: IDischargeMedication[];

  diseaseCategory?: string;
  outcomeStatus?:   "SURVIVED" | "DECEASED" | "TRANSFERRED";

  createdAt?: Date;
  updatedAt?: Date;
}

const DischargeMedicationSchema = new Schema<IDischargeMedication>(
  {
    medicine: { type: String, required: true, trim: true },
    dosage: { type: String, required: true, trim: true },
    frequency: { type: String, trim: true },
    duration: { type: String, trim: true },
    instructions: { type: String, trim: true },
    form: { type: String, trim: true },
    route: { type: String, trim: true },
    method: { type: String, trim: true },
    timing: {
      frequency: { type: Number },
      period: { type: Number },
      periodUnit: { type: String, trim: true },
    },
    durationUnit: { type: String, trim: true },
    customInstructions: { type: String, trim: true },
    snomedCode: { type: String, trim: true },
    snomedDisplay: { type: String, trim: true },
  },
  { _id: false },
);

const VisitDischargeSummarySchema = new Schema<IVisitDischargeSummary>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true, unique: true },
    patientId: { type: Schema.Types.ObjectId, required: true },
    admissionDate: { type: Date },
    dischargeDate: { type: Date },
    ward: { type: String, trim: true },
    bed: { type: String, trim: true },
    diagnosis: { type: String, trim: true },
    conditionAtDischarge: { type: String, trim: true },
    clinicalSummary: { type: String, trim: true },
    admissionNotes: { type: String, trim: true },
    treatmentGiven: { type: String, trim: true },
    investigationsResults: { type: String, trim: true },
    followUpInstructions: { type: String, trim: true },
    surgicalProcedures: { type: String, trim: true },
    surgicalNote: { type: String, trim: true },
    doctorSignature: { type: String, trim: true },
    dischargeMedications: { type: [DischargeMedicationSchema], default: [] },

    diseaseCategory: { type: String, trim: true },
    outcomeStatus: {
      type: String,
      enum: ["SURVIVED", "DECEASED", "TRANSFERRED"],
    },
  },
  { timestamps: true },
);

VisitDischargeSummarySchema.index({ diseaseCategory: 1, outcomeStatus: 1 });
VisitDischargeSummarySchema.index({ patientId: 1, dischargeDate: -1 });

export const VisitDischargeSummaryModel = model<IVisitDischargeSummary>(
  "VisitDischargeSummary",
  VisitDischargeSummarySchema,
  "visit_discharge_summaries",
);
