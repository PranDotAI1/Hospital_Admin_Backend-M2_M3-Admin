import { Schema, model, Document } from "mongoose";

export interface IScanShareDailyQueue extends Document {
  date: string;
  counterId: string;
  lastIssuedToken: number;
  currentServingToken: number;
  avgServiceTime: number;
}

const ScanShareDailyQueueSchema = new Schema<IScanShareDailyQueue>(
  {
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"],
    },
    counterId: {
      type: String,
      required: true,
      trim: true,
    },
    lastIssuedToken: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    currentServingToken: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    avgServiceTime: {
      type: Number,
      required: true,
      default: 10,
      min: 0,
    },
  },
  {
    timestamps: true,
    collection: "scan_share_daily_queue",
  },
);

ScanShareDailyQueueSchema.index({ date: 1, counterId: 1 }, { unique: true });

export const ScanShareDailyQueueModel = model<IScanShareDailyQueue>(
  "ScanShareDailyQueue",
  ScanShareDailyQueueSchema,
);
