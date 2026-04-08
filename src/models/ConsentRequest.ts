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
  mobile?: string;
  authMethods?: string[];
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

  /** What was originally requested — maps to the ABDM consent/init payload. */
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

  consentArtefacts: string[];

  /** HIMS = for our hospital to fetch and hold; PHR = for patient's PHR (pull records). Defaults to HIMS. */
  requestPurpose: "HIMS" | "PHR";

  /** Consolidated approved consent details — populated when ABDM returns the artefact (GRANTED). */
  approved?: {
    dateRange?: {
      from: Date;
      to: Date;
    };
    hiTypes?: string[];
    accessMode?: string;
    dataEraseAt?: Date;
    expiryDate?: Date;
  };

  grantedAt?: Date;

  /** @deprecated Use approved.expiryDate instead */
  consentExpiryOn?: Date;

  /** @deprecated Use approved.hiTypes instead */
  approvedHiTypes?: string[];
  /** @deprecated Use approved.dateRange instead */
  approvedDateRange?: {
    from: Date;
    to: Date;
  };

  revokedAt?: Date;
  deniedAt?: Date;

  lastCheckedAt?: Date;

  error?: any;

  createdAt: Date;
  updatedAt: Date;
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
    mobile: { type: String },
    authMethods: [{ type: String }],
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
    requestPurpose: { type: String, enum: ["HIMS", "PHR"], default: "HIMS" },

    // Consolidated approved consent details from ABDM artefact
    approved: {
      dateRange: {
        from: { type: Date },
        to: { type: Date },
      },
      hiTypes: [{ type: String }],
      accessMode: { type: String },
      dataEraseAt: { type: Date },
      expiryDate: { type: Date },
    },

    grantedAt: { type: Date },
    consentExpiryOn: { type: Date },
    approvedHiTypes: [{ type: String }],
    approvedDateRange: {
      from: { type: Date },
      to: { type: Date },
    },
    revokedAt: { type: Date },
    deniedAt: { type: Date },
    lastCheckedAt: { type: Date },
    error: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: "consent_requests",
  },
);

ConsentRequestSchema.index({ patientAbhaId: 1, status: 1 });
ConsentRequestSchema.index({ consentRequestId: 1, status: 1 });

export const ConsentRequestModel = model<IConsentRequest>(
  "ConsentRequest",
  ConsentRequestSchema,
);
