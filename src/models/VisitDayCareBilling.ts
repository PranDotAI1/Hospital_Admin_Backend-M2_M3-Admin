import mongoose, { Schema, Document } from "mongoose";

export interface IVisitDayCareBilling extends Document {
  patient: mongoose.Types.ObjectId;
  visitId: mongoose.Types.ObjectId;
  uhid: string; // From Patient or Visit
  billings: Array<{
    code: string;
    particulars: string;
    rate: number;
    unit: number;
    amount: number;
  }>;
  totalAmount: number;
  date: Date;
  status: "Draft" | "Finalized" | "SentToABHA";
  createdAt: Date;
  updatedAt: Date;
}

const VisitDayCareBillingSchema: Schema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    visitId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true, // One billing per visit
    },
    uhid: { type: String, required: true },
    billings: [
      {
        code: { type: String },
        particulars: { type: String },
        rate: { type: Number },
        unit: { type: Number },
        amount: { type: Number },
      },
    ],
    totalAmount: { type: Number, default: 0 },
    date: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["Draft", "Finalized", "SentToABHA"],
      default: "Draft",
    },
  },
  { timestamps: true },
);

// Index for efficient queries (visitId already has unique: true on field)
VisitDayCareBillingSchema.index({ patient: 1 });

export const VisitDayCareBilling = mongoose.model<IVisitDayCareBilling>(
  "VisitDayCareBilling",
  VisitDayCareBillingSchema,
  "visit_day_care_billings",
);
