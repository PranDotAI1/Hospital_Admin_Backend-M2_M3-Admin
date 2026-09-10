import { Schema, model, Document, Types } from "mongoose";

export interface IDispenseItem {
  medication_id?: string;
  drug_name: string;
  batch_number: string;
  expiry_date: string;
  prescribed_qty: number;
  dispensed_qty: number;
  is_verified?: boolean;
}

export interface ISafetyChecklist {
  dose_checked?: boolean;
  allergy_verified?: boolean;
  counseling_given?: boolean;
  stock_verified?: boolean;
}

export interface IDispensedBy {
  user_id?: string;
  name: string;
  role?: string;
}

export interface IPharmacyDispense extends Document {
  dispense_id: string;
  receipt_number: string;
  visit_id: Types.ObjectId;
  patient_id: Types.ObjectId;
  hospital_id?: Types.ObjectId;
  status: "PENDING" | "DISPENSED" | "PARTIAL";
  pharmacist_notes?: string;
  safety_checklist?: ISafetyChecklist;
  items: IDispenseItem[];
  dispensed_at: Date;
  dispensed_by: IDispensedBy;
  createdAt?: Date;
  updatedAt?: Date;
}

const DispenseItemSchema = new Schema<IDispenseItem>(
  {
    medication_id: { type: String },
    drug_name: { type: String, required: true, trim: true },
    batch_number: { type: String, required: true, trim: true },
    expiry_date: { type: String, required: true, trim: true },
    prescribed_qty: { type: Number, required: true, default: 1 },
    dispensed_qty: { type: Number, required: true, default: 1 },
    is_verified: { type: Boolean, default: true },
  },
  { _id: false },
);

const SafetyChecklistSchema = new Schema<ISafetyChecklist>(
  {
    dose_checked: { type: Boolean, default: true },
    allergy_verified: { type: Boolean, default: true },
    counseling_given: { type: Boolean, default: true },
    stock_verified: { type: Boolean, default: true },
  },
  { _id: false },
);

const DispensedBySchema = new Schema<IDispensedBy>(
  {
    user_id: { type: Schema.Types.Mixed },
    name: { type: String, default: "Pharmacist" },
    role: { type: String, default: "Registered Pharmacist" },
  },
  { _id: false },
);

const PharmacyDispenseSchema = new Schema<IPharmacyDispense>(
  {
    dispense_id: { type: String, required: true, unique: true, trim: true },
    receipt_number: { type: String, required: true, unique: true, trim: true },
    visit_id: { type: Schema.Types.ObjectId, required: true },
    patient_id: { type: Schema.Types.ObjectId, required: true, index: true },
    hospital_id: { type: Schema.Types.ObjectId, index: true },
    status: {
      type: String,
      enum: ["PENDING", "DISPENSED", "PARTIAL"],
      default: "DISPENSED",
      index: true,
    },
    pharmacist_notes: { type: String, trim: true },
    safety_checklist: { type: SafetyChecklistSchema, default: () => ({}) },
    items: { type: [DispenseItemSchema], default: [] },
    dispensed_at: { type: Date, default: Date.now },
    dispensed_by: { type: DispensedBySchema, required: true },
  },
  {
    timestamps: true,
    collection: "pharmacy_dispenses",
  },
);

PharmacyDispenseSchema.index({ visit_id: 1 }, { unique: true });
PharmacyDispenseSchema.index({ createdAt: -1 });

export const PharmacyDispenseModel = model<IPharmacyDispense>(
  "PharmacyDispense",
  PharmacyDispenseSchema,
  "pharmacy_dispenses",
);
