import mongoose, { Schema, Document } from "mongoose";

export interface IVisitDayCareBilling extends Document {
  patient: mongoose.Types.ObjectId;
  visitId: mongoose.Types.ObjectId;
  uhid: string; // From Patient or Visit
  billings: Array<{
    code: string;
    particulars: string;
    mrp?: number;      // Maximum Retail Price per unit
    rate: number;      // Actual charged rate per unit
    unit: number;      // Quantity
    discount?: number; // Discount amount (₹) on this line
    cgst?: number;     // CGST percentage (e.g. 9 for 9%)
    sgst?: number;     // SGST percentage (e.g. 9 for 9%)
    cgstAmount?: number;  // Computed CGST amount
    sgstAmount?: number;  // Computed SGST amount
    taxableAmount?: number; // rate*unit - discount (pre-tax)
    amount: number;    // Final payable = taxableAmount + cgstAmount + sgstAmount
  }>;
  totalAmount: number;  // = totalGross (final payable total)
  totalNet: number;     // Sum of taxable amounts (pre-tax, post-discount)
  totalGross: number;   // Sum of final payable amounts (post-tax)
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
        mrp: { type: Number },
        rate: { type: Number },
        unit: { type: Number },
        discount: { type: Number, default: 0 },
        cgst: { type: Number, default: 0 },
        sgst: { type: Number, default: 0 },
        cgstAmount: { type: Number, default: 0 },
        sgstAmount: { type: Number, default: 0 },
        taxableAmount: { type: Number, default: 0 },
        amount: { type: Number },
      },
    ],
    totalAmount: { type: Number, default: 0 },
    totalNet: { type: Number, default: 0 },
    totalGross: { type: Number, default: 0 },
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
