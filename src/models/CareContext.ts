import { Schema, model, Document, Types } from "mongoose";

export enum CareContextStatus {
  PENDING = "PENDING",
  LINKING = "LINKING",
  LINKED = "LINKED",
  NOTIFIED = "NOTIFIED",
  FAILED = "FAILED",
}

export enum DataTransferStatus {
  PENDING = "PENDING",
  ACKNOWLEDGED = "ACKNOWLEDGED",
  TRANSFERRED = "TRANSFERRED",
  FAILED = "FAILED",
}

export const HI_TYPES = [
  "Prescription",
  "DiagnosticReport",
  "OPConsultation",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
] as const;

export type HIType = (typeof HI_TYPES)[number];

export interface ICareContext extends Document {
  patientId: Types.ObjectId;
  visitId?: Types.ObjectId;

  careContextReference: string;
  patientReference: string;
  abhaAddress: string;
  display: string;

  hiTypes: HIType[];

  linkingStatus: CareContextStatus;
  linkRequestId?: string;
  linkedAt?: Date;
  linkError?: any;
  linkAttempts: number;
  lastLinkAttemptAt?: Date;

  notifiedAt?: Date;
  notifyError?: any;

  consentId?: string;
  transactionId?: string;
  dataPushUrl?: string;
  dataTransferStatus?: DataTransferStatus;
  dataTransferredAt?: Date;
  dataTransferError?: any;

  facilityId?: string;
  facilityName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const CareContextSchema = new Schema<ICareContext>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "ScanShareVisit",
      required: false,
      index: true,
    },

    careContextReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    patientReference: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    abhaAddress: {
      type: String,
      required: false,
      trim: true,
      index: true,
    },
    display: {
      type: String,
      required: true,
      trim: true,
    },

    hiTypes: {
      type: [String],
      enum: HI_TYPES,
      default: ["OPConsultation"],
    },

    linkingStatus: {
      type: String,
      enum: Object.values(CareContextStatus),
      default: CareContextStatus.PENDING,
      required: true,
      index: true,
    },
    linkRequestId: {
      type: String,
      trim: true,
    },
    linkedAt: {
      type: Date,
    },
    linkError: {
      type: Schema.Types.Mixed,
    },
    linkAttempts: {
      type: Number,
      default: 0,
    },
    lastLinkAttemptAt: {
      type: Date,
    },

    notifiedAt: {
      type: Date,
    },
    notifyError: {
      type: Schema.Types.Mixed,
    },

    consentId: {
      type: String,
      trim: true,
    },
    transactionId: {
      type: String,
      trim: true,
    },
    dataPushUrl: {
      type: String,
      trim: true,
    },
    dataTransferStatus: {
      type: String,
      enum: Object.values(DataTransferStatus),
    },
    dataTransferredAt: {
      type: Date,
    },
    dataTransferError: {
      type: Schema.Types.Mixed,
    },

    facilityId: {
      type: String,
      trim: true,
    },
    facilityName: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "care_contexts",
  },
);

CareContextSchema.index({ patientId: 1, visitId: 1 });
CareContextSchema.index({ abhaAddress: 1, linkingStatus: 1 });
CareContextSchema.index({ linkingStatus: 1, createdAt: -1 });
CareContextSchema.index({ linkRequestId: 1 }, { sparse: true });
CareContextSchema.index({ consentId: 1 }, { sparse: true });
CareContextSchema.index({ transactionId: 1 }, { sparse: true });

export const CareContextModel = model<ICareContext>(
  "CareContext",
  CareContextSchema,
);
