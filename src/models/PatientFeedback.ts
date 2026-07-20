import { Schema, model, Document, Types } from "mongoose";

export interface IPatientFeedback extends Document {
  visitId:     Types.ObjectId;
  patientId:   Types.ObjectId;
  doctorId?:   Types.ObjectId;
  hospitalId:  Types.ObjectId;
  score:       number;
  npsScore?:   number;
  comments?:   string;
  submittedBy: "PATIENT" | "RECEPTIONIST";
  submittedAt: Date;
  createdAt?:  Date;
  updatedAt?:  Date;
}

const PatientFeedbackSchema = new Schema<IPatientFeedback>(
  {
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "ScanShareVisit",
      required: true,
      unique: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: false,
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    npsScore: {
      type: Number,
      min: 0,
      max: 10,
    },
    comments: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    submittedBy: {
      type: String,
      enum: ["PATIENT", "RECEPTIONIST"],
      required: true,
      default: "PATIENT",
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "patient_feedbacks",
  }
);

PatientFeedbackSchema.index({ hospitalId: 1, submittedAt: -1 });
PatientFeedbackSchema.index({ patientId: 1, submittedAt: -1 });
PatientFeedbackSchema.index({ doctorId: 1, submittedAt: -1 });

export const PatientFeedbackModel = model<IPatientFeedback>(
  "PatientFeedback",
  PatientFeedbackSchema
);
