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
      required: false,
      trim: true,
      default: null,
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

// NOTE: NO self-referencing guard here. PHR consents (purpose.code=PATRQT) are initiated
// by the patient's PHR app, not by our system — there is no local ConsentRequest.
// So artefactId === consentRequestId is EXPECTED and CORRECT for PHR consents.

export const PHRConsentArtefactModel = model<IConsentArtefact>(
  "PHRConsentArtefact",
  PHRConsentArtefactSchema,
);
