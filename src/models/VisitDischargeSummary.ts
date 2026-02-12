import { Schema, model, Document, Types } from "mongoose";

export interface IDischargeMedication {
  medicine: string;
  dosage: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
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
  },
  { _id: false },
);

const VisitDischargeSummarySchema = new Schema<IVisitDischargeSummary>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, required: true, index: true },
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
  },
  { timestamps: true },
);

export const VisitDischargeSummaryModel = model<IVisitDischargeSummary>(
  "VisitDischargeSummary",
  VisitDischargeSummarySchema,
  "visit_discharge_summaries",
);
