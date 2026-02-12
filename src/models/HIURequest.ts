import mongoose, { Schema, Document } from "mongoose";

export interface IHIURequest extends Document {
  requestId: string;
  transactionId?: string;

  patientAbhaAddress: string;
  consentArtefactId: string;

  dateRange: {
    from: Date;
    to: Date;
  };

  keyMaterial: {
    privateKey: string;
    publicKey: string;
    nonce: string;
  };

  status: HIURequestStatus;

  callbacks: Array<{
    type: string;
    timestamp: Date;
    body: any;
  }>;

  error?: any;
  createdAt: Date;
  updatedAt: Date;
}

export enum HIURequestStatus {
  INITIATED = "INITIATED",
  REQUESTED = "REQUESTED",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  TRANSFERRED = "TRANSFERRED",
  FAILED = "FAILED",
}

const HIURequestSchema = new Schema<IHIURequest>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    transactionId: {
      type: String,
      index: true,
    },
    patientAbhaAddress: {
      type: String,
      required: true,
    },
    consentArtefactId: {
      type: String,
      required: true,
    },
    dateRange: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
    },
    keyMaterial: {
      privateKey: { type: String, required: true }, // Encrypt in production!
      publicKey: { type: String, required: true },
      nonce: { type: String, required: true },
    },
    status: {
      type: String,
      enum: Object.values(HIURequestStatus),
      default: HIURequestStatus.INITIATED,
    },
    callbacks: [
      {
        type: { type: String },
        timestamp: { type: Date, default: Date.now },
        body: { type: Schema.Types.Mixed },
      },
    ],
    error: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    collection: "hiu_requests",
  },
);

export const HIURequestModel = mongoose.model<IHIURequest>(
  "HIURequest",
  HIURequestSchema,
);

export default HIURequestModel;
