import mongoose, { Schema, Document, Types } from "mongoose";

export interface IExternalHealthRecord extends Document {
  _id: Types.ObjectId;

  patientAbhaAddress: string;
  patientId?: Types.ObjectId; // Link to local Patient if exists

  consentArtefactId: string;
  transactionId: string;
  requestId?: string;

  sourceHipId: string;
  sourceHipName?: string;

  careContextReference: string;
  careContextDisplay?: string;

  fhirBundle: object;
  hiTypes: string[];

  dateRange: {
    from: Date;
    to: Date;
  };

  status: ExternalRecordStatus;
  receivedAt: Date;
  decryptedAt?: Date;

  encryptedDataSize?: number;
  decryptedDataSize?: number;
  errorMessage?: string;

  createdAt: Date;
  updatedAt: Date;
}

export enum ExternalRecordStatus {
  RECEIVED = "RECEIVED",
  DECRYPTING = "DECRYPTING",
  DECRYPTED = "DECRYPTED",
  STORED = "STORED",
  FAILED = "FAILED",
}

const ExternalHealthRecordSchema = new Schema<IExternalHealthRecord>(
  {
    patientAbhaAddress: {
      type: String,
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
    },

    consentArtefactId: {
      type: String,
      required: true,
      index: true,
    },
    transactionId: {
      type: String,
      required: true,
      index: true,
    },
    requestId: {
      type: String,
    },

    sourceHipId: {
      type: String,
      required: true,
      index: true,
    },
    sourceHipName: {
      type: String,
    },

    careContextReference: {
      type: String,
      required: true,
    },
    careContextDisplay: {
      type: String,
    },

    fhirBundle: {
      type: Schema.Types.Mixed,
      required: true,
    },
    hiTypes: [
      {
        type: String,
        enum: [
          "OPConsultation",
          "Prescription",
          "DiagnosticReport",
          "DischargeSummary",
          "ImmunizationRecord",
          "HealthDocumentRecord",
          "WellnessRecord",
        ],
      },
    ],

    dateRange: {
      from: { type: Date },
      to: { type: Date },
    },

    status: {
      type: String,
      enum: Object.values(ExternalRecordStatus),
      default: ExternalRecordStatus.RECEIVED,
      index: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    decryptedAt: {
      type: Date,
    },

    encryptedDataSize: {
      type: Number,
    },
    decryptedDataSize: {
      type: Number,
    },
    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: "external_health_records",
  },
);

ExternalHealthRecordSchema.index({
  patientAbhaAddress: 1,
  receivedAt: -1,
});
ExternalHealthRecordSchema.index({
  transactionId: 1,
  careContextReference: 1,
});

export const ExternalHealthRecordModel = mongoose.model<IExternalHealthRecord>(
  "ExternalHealthRecord",
  ExternalHealthRecordSchema,
);

export default ExternalHealthRecordModel;
