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
  "Invoice",
] as const;

export type HIType = (typeof HI_TYPES)[number];

export interface ICareContext extends Document {
  patientId: Types.ObjectId;
  visitId?: Types.ObjectId;

  careContextReference: string;
  patientReference: string;
  abhaAddress: string;
  display: string;

  /** Primary HI type for this CareContext (used in ABDM link payload) */
  hiType?: HIType;
  /** All HI types associated with this visit's CareContext */
  hiTypes: HIType[];

  linkingStatus: CareContextStatus;
  linkRequestId?: string;
  linkedAt?: Date;
  linkError?: any;
  linkAttempts: number;
  lastLinkAttemptAt?: Date;

  notifiedAt?: Date;
  notifyRequestId?: string;
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
    },
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "ScanShareVisit",
      required: false,
    },

    careContextReference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    patientReference: {
      type: String,
      required: true,
      trim: true,
    },
    abhaAddress: {
      type: String,
      required: false,
      trim: true,
    },
    display: {
      type: String,
      required: true,
      trim: true,
    },

    hiType: {
      type: String,
      enum: HI_TYPES,
    },
    hiTypes: {
      type: [String],
      enum: HI_TYPES,
      default: [],
    },

    linkingStatus: {
      type: String,
      enum: Object.values(CareContextStatus),
      default: CareContextStatus.PENDING,
      required: true,
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
    notifyRequestId: {
      type: String,
      trim: true,
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

// Ensure hiType and hiTypes stay in sync (hiType = primary / first type).
CareContextSchema.pre("validate", function (next) {
  const doc = this as ICareContext;

  if (doc.hiType && (!Array.isArray(doc.hiTypes) || doc.hiTypes.length === 0)) {
    // hiType set but hiTypes empty → seed hiTypes
    doc.hiTypes = [doc.hiType];
  } else if (
    (!doc.hiType) &&
    Array.isArray(doc.hiTypes) &&
    doc.hiTypes.length > 0
  ) {
    // hiTypes set but no hiType → pick first as primary
    doc.hiType = doc.hiTypes[0] as HIType;
  }

  // Ensure hiType is always present in hiTypes
  if (doc.hiType && Array.isArray(doc.hiTypes) && !doc.hiTypes.includes(doc.hiType)) {
    doc.hiTypes.unshift(doc.hiType);
  }

  return next();
});

// One CareContext per visit (all HI types merged into one context).
CareContextSchema.index({ patientId: 1, visitId: 1 }, { unique: true, sparse: true });
CareContextSchema.index({ abhaAddress: 1, linkingStatus: 1 });
CareContextSchema.index({ linkRequestId: 1 }, { sparse: true });
CareContextSchema.index({ notifyRequestId: 1 }, { sparse: true });
CareContextSchema.index({ consentId: 1 }, { sparse: true });

export const CareContextModel = model<ICareContext>(
  "CareContext",
  CareContextSchema,
);
