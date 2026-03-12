import { Schema, model, Document, Types } from "mongoose";

export interface IMedicationLine {
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
}

export interface IVisitPrescription extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  medications: IMedicationLine[];
  advice?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const MedicationLineSchema = new Schema<IMedicationLine>(
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
  },
  { _id: false },
);

const VisitPrescriptionSchema = new Schema<IVisitPrescription>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true },
    patientId: { type: Schema.Types.ObjectId, required: true },
    medications: { type: [MedicationLineSchema], default: [] },
    advice: { type: String, trim: true },
  },
  { timestamps: true },
);

VisitPrescriptionSchema.index({ visitId: 1 }, { unique: true });

export const VisitPrescriptionModel = model<IVisitPrescription>(
  "VisitPrescription",
  VisitPrescriptionSchema,
  "visit_prescriptions",
);
