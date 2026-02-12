import mongoose, { Schema, Document } from "mongoose";

export interface IMergeLog extends Document {
  masterPatientId: mongoose.Types.ObjectId;
  mergedPatientId: mongoose.Types.ObjectId;
  initiatedBy: string;
  mergedAt: Date;
  details?: Record<string, any>;
}

const MergeLogSchema: Schema = new Schema(
  {
    masterPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    mergedPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    initiatedBy: { type: String, default: "system" },
    mergedAt: { type: Date, default: Date.now },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export const MergeLogModel = mongoose.model<IMergeLog>(
  "MergeLog",
  MergeLogSchema,
);
