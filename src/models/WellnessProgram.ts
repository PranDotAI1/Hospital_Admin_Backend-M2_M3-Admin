import { Schema, model, Document, Types } from "mongoose";

export type WellnessProgramStatus = "ENROLLED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
export type WellnessProgramType =
  | "CHRONIC_DISEASE_MANAGEMENT"
  | "MENTAL_HEALTH"
  | "NUTRITION"
  | "SMOKING_CESSATION"
  | "PHYSICAL_REHABILITATION"
  | "DIABETES_MANAGEMENT"
  | "CARDIAC_WELLNESS"
  | "OTHER";

export interface IWellnessProgram extends Document {
  patientId:    Types.ObjectId;
  hospitalId:   Types.ObjectId;
  programName:  string;
  programType:  WellnessProgramType;
  enrolledAt:   Date;
  scheduledDate: Date;
  completedAt?:  Date;
  status:        WellnessProgramStatus;
  enrolledBy?:   Types.ObjectId;
  notes?:        string;
  createdAt?:    Date;
  updatedAt?:    Date;
}

const WellnessProgramSchema = new Schema<IWellnessProgram>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    programName: {
      type: String,
      required: true,
      trim: true,
    },
    programType: {
      type: String,
      enum: [
        "CHRONIC_DISEASE_MANAGEMENT",
        "MENTAL_HEALTH",
        "NUTRITION",
        "SMOKING_CESSATION",
        "PHYSICAL_REHABILITATION",
        "DIABETES_MANAGEMENT",
        "CARDIAC_WELLNESS",
        "OTHER",
      ],
      required: true,
    },
    enrolledAt: {
      type: Date,
      default: Date.now,
    },
    scheduledDate: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: ["ENROLLED", "COMPLETED", "NO_SHOW", "CANCELLED"],
      default: "ENROLLED",
      required: true,
    },
    enrolledBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "wellness_programs",
  }
);

WellnessProgramSchema.index({ hospitalId: 1, scheduledDate: 1, status: 1 });

WellnessProgramSchema.index({ patientId: 1, enrolledAt: -1 });

WellnessProgramSchema.index({ status: 1, scheduledDate: 1 });

export const WellnessProgramModel = model<IWellnessProgram>(
  "WellnessProgram",
  WellnessProgramSchema
);
