import mongoose, { Schema, Document } from "mongoose";

export interface IHIUTransferPayload extends Document {
  transactionId: string;
  pageNumber?: number;
  entries: any[];
  keyMaterial: any;
  createdAt: Date;
}

const HIUTransferPayloadSchema = new Schema<IHIUTransferPayload>(
  {
    transactionId: {
      type: String,
      required: true,
      index: true,
    },
    pageNumber: {
      type: Number,
    },
    entries: {
      type: Schema.Types.Mixed,
    },
    keyMaterial: {
      type: Schema.Types.Mixed,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: "1d", // Automatically delete documents after 1 day
    },
  },
  {
    collection: "hiu_transfer_payloads",
  },
);

export const HIUTransferPayloadModel = mongoose.model<IHIUTransferPayload>(
  "HIUTransferPayload",
  HIUTransferPayloadSchema,
);

export default HIUTransferPayloadModel;
