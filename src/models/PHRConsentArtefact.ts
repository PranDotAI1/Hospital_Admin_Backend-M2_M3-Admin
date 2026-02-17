
import {
  ConsentArtefactStatus,
  IConsentArtefact,
  ConsentCareContextSchema,
  ConsentPermissionSchema,
} from "./ConsentArtefact";
import { Schema, model } from "mongoose";

const PHRConsentArtefactSchema = new Schema<IConsentArtefact>(
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
    },
    status: {
      type: String,
      enum: Object.values(ConsentArtefactStatus),
      required: true,
      default: ConsentArtefactStatus.GRANTED,
    },
    patientAbhaAddress: {
      type: String,
      required: true,
      trim: true,
    },
    hipId: { type: String, required: true, trim: true },
    hiuId: { type: String, trim: true },
    careContexts: {
      type: [ConsentCareContextSchema],
      default: [],
    },
    hiTypes: { type: [String], default: [] },
    permission: {
      type: ConsentPermissionSchema,
      required: true,
    },
    purpose: {
      code: { type: String },
      text: { type: String },
      refUri: { type: String },
    },
    requestPurpose: { type: String, enum: ["HIMS", "PHR"] },
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
    deniedAt: { type: Date },
    expiryDate: { type: Date },
    lastFetchedAt: { type: Date },
    rawConsentDetail: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: "phr_consent_artefacts",
  },
);

PHRConsentArtefactSchema.index({ patientAbhaAddress: 1, status: 1 });
// artefactId: unique: true on field already creates index; no duplicate schema.index

export const PHRConsentArtefactModel = model<IConsentArtefact>(
  "PHRConsentArtefact",
  PHRConsentArtefactSchema,
);
