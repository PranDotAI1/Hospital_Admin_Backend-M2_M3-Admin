import mongoose, { Schema, Document } from "mongoose";

export interface ILinkOTP extends Document {
  transactionId: string;
  otp: string;
  patientId: string;
  mobile: string;
  careContextRefs: string[];
  createdAt: Date;
  expiresAt: Date;
}

const LinkOTPSchema: Schema = new Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    otp: { type: String, required: true },
    patientId: { type: String, required: true },
    mobile: { type: String, required: true },
    careContextRefs: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, expires: 60 * 10 }, // TTL index
  },
  { timestamps: true },
);

// LinkOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LinkOTPModel = mongoose.model<ILinkOTP>("LinkOTP", LinkOTPSchema);
