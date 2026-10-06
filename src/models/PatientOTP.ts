import mongoose, { Schema, Document } from "mongoose";

export interface IPatientOTP extends Document {
  mobile: string;
  otp: string;
  txnId: string;
  attempts: number;
  isVerified: boolean;
  channel: "sms" | "whatsapp" | "email";
  email?: string;
  createdAt: Date;
  expiresAt: Date;
}

const PatientOTPSchema = new Schema<IPatientOTP>(
  {
    mobile: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    otp: {
      type: String,
      required: true,
      trim: true,
    },
    txnId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    channel: {
      type: String,
      enum: ["sms", "whatsapp", "email"],
      default: "sms",
    },
    email: {
      type: String,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
    collection: "patient_otps",
  },
);

export const PatientOTPModel = mongoose.model<IPatientOTP>(
  "PatientOTP",
  PatientOTPSchema,
);
