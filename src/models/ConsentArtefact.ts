import { Schema, model, Document, Types } from "mongoose";

export enum ConsentArtefactStatus {
  GRANTED = "GRANTED",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
  DENIED = "DENIED",
}

export interface IConsentCareContext {
  patientReference: string;
  careContextReference: string;
}

export interface IConsentPermission {
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
}

export interface IConsentArtefact extends Document {
  artefactId: string;

  consentRequestId: string;

  status: ConsentArtefactStatus;

  patientAbhaAddress: string;

  hipId: string;

  hiuId?: string;

  careContexts: IConsentCareContext[];

  hiTypes: string[];

  permission: IConsentPermission;

  purpose?: {
    code: string;
    text: string;
    refUri?: string;
  };

  requester?: {
    name: string;
    identifier?: {
      type: string;
      value: string;
      system: string;
    };
  };

  signature?: string;

  grantedAt?: Date;

  revokedAt?: Date;

  expiryDate?: Date;

  lastFetchedAt?: Date;

  rawConsentDetail?: any;

  createdAt: Date;
  updatedAt: Date;
}

const ConsentCareContextSchema = new Schema(
  {
    patientReference: { type: String, required: true },
    careContextReference: { type: String, required: true },
  },
  { _id: false },
);

const ConsentPermissionSchema = new Schema(
  {
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
  { _id: false },
);

const ConsentArtefactSchema = new Schema<IConsentArtefact>(
  {
    artefactId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    consentRequestId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ConsentArtefactStatus),
      required: true,
      default: ConsentArtefactStatus.GRANTED,
      index: true,
    },
    patientAbhaAddress: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    hipId: {
      type: String,
      required: true,
      trim: true,
    },
    hiuId: {
      type: String,
      trim: true,
    },
    careContexts: {
      type: [ConsentCareContextSchema],
      default: [],
    },
    hiTypes: {
      type: [String],
      default: [],
    },
    permission: {
      type: ConsentPermissionSchema,
      required: true,
    },
    purpose: {
      code: { type: String },
      text: { type: String },
      refUri: { type: String },
    },
    requester: {
      name: { type: String },
      identifier: {
        type: { type: String },
        value: { type: String },
        system: { type: String },
      },
    },
    signature: { type: String },
    grantedAt: { type: Date },
    revokedAt: { type: Date },
    expiryDate: { type: Date },
    lastFetchedAt: { type: Date },
    rawConsentDetail: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: "consent_artefacts",
  },
);

ConsentArtefactSchema.index({ patientAbhaAddress: 1, status: 1 });
ConsentArtefactSchema.index({ consentRequestId: 1, status: 1 });
ConsentArtefactSchema.index({ expiryDate: 1 }, { sparse: true });

export const ConsentArtefactModel = model<IConsentArtefact>(
  "ConsentArtefact",
  ConsentArtefactSchema,
);
