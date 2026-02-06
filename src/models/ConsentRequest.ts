import { Schema, model, Document } from "mongoose";

export interface IConsentRequest extends Document {
  consentRequestId: string;
  requestId: string;
  status:
    | "INITIATED"
    | "REQUESTED"
    | "GRANTED"
    | "DENIED"
    | "REVOKED"
    | "EXPIRED";
  patientAbhaId: string;

  patientName?: string;
  abhaAddress?: string;
  abhaNumber?: string;
  gender?: string;
  dob?: string | Date;
  facilityName?: string;

  hiuId: string;
  requester: {
    name: string;
    identifier: {
      type: string;
      value: string;
      system: string;
    };
  };
  purpose: {
    code: string;
    text: string;
    refUri?: string;
  };
  hiTypes: string[];
  permission: {
    accessMode: string;
    dateRange: {
      from: Date;
      to: Date;
    };
    dataEraseAt: Date;
    frequency: {
      unit: string;
      value: number;
      repeats: number;
    };
  };
  consentArtefacts: string[]; // List of Consent Artefact IDs
  createdAt: Date;
  updatedAt: Date;
  error?: any;
}

const ConsentRequestSchema = new Schema<IConsentRequest>(
  {
    consentRequestId: { type: String, unique: true, sparse: true },
    requestId: { type: String, required: true },
    status: {
      type: String,
      enum: [
        "INITIATED",
        "REQUESTED",
        "GRANTED",
        "DENIED",
        "REVOKED",
        "EXPIRED",
      ],
      default: "INITIATED",
    },
    patientAbhaId: { type: String, required: true },

    patientName: { type: String },
    abhaAddress: { type: String },
    abhaNumber: { type: String },
    gender: { type: String },
    dob: { type: Schema.Types.Mixed },
    facilityName: { type: String },

    hiuId: { type: String, required: true },
    requester: {
      name: { type: String },
      identifier: {
        type: { type: String },
        value: { type: String },
        system: { type: String },
      },
    },
    purpose: {
      code: { type: String },
      text: { type: String },
      refUri: { type: String },
    },
    hiTypes: [{ type: String }],
    permission: {
      accessMode: { type: String, default: "VIEW" },
      dateRange: {
        from: { type: Date },
        to: { type: Date },
      },
      dataEraseAt: { type: Date },
      frequency: {
        unit: { type: String },
        value: { type: Number },
        repeats: { type: Number },
      },
    },
    consentArtefacts: [{ type: String }],
    error: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: "consent_requests",
  },
);

export const ConsentRequestModel = model<IConsentRequest>(
  "ConsentRequest",
  ConsentRequestSchema,
);
