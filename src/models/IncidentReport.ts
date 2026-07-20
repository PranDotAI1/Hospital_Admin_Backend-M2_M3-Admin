import { Schema, model, Document, Types } from "mongoose";

export type IncidentType =
  | "CUTS_AND_PUNCTURES"
  | "MULTIPLE_TRAUMA"
  | "FRACTURES"
  | "BRUISES"
  | "SORENESS_PAIN"
  | "SPRAINS_AND_STRAINS"
  | "MEDICATION_ERROR"
  | "COMPLAINT"
  | "SURGICAL_SITE_INFECTION"
  | "VAP"
  | "BLOODSTREAM_INFECTION"
  | "C_DIFF_INFECTION";

export type IncidentSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";

export const INFECTION_INCIDENT_TYPES: IncidentType[] = [
  "SURGICAL_SITE_INFECTION",
  "VAP",
  "BLOODSTREAM_INFECTION",
  "C_DIFF_INFECTION",
];

export const PHYSICAL_INCIDENT_TYPES: IncidentType[] = [
  "CUTS_AND_PUNCTURES",
  "MULTIPLE_TRAUMA",
  "FRACTURES",
  "BRUISES",
  "SORENESS_PAIN",
  "SPRAINS_AND_STRAINS",
];

export interface IIncidentReport extends Document {
  type:            IncidentType;
  description:     string;
  severity:        IncidentSeverity;
  patientId?:      Types.ObjectId;
  visitId?:        Types.ObjectId;
  doctorId?:       Types.ObjectId;
  reportedBy:      Types.ObjectId;
  reportedAt:      Date;
  hospitalId:      Types.ObjectId;
  wardLocation?:   string;
  isResolved:      boolean;
  resolvedAt?:     Date;
  resolvedBy?:     Types.ObjectId;
  resolutionNotes?: string;
  createdAt?:      Date;
  updatedAt?:      Date;
}

const IncidentReportSchema = new Schema<IIncidentReport>(
  {
    type: {
      type: String,
      enum: [
        "CUTS_AND_PUNCTURES",
        "MULTIPLE_TRAUMA",
        "FRACTURES",
        "BRUISES",
        "SORENESS_PAIN",
        "SPRAINS_AND_STRAINS",
        "MEDICATION_ERROR",
        "COMPLAINT",
        "SURGICAL_SITE_INFECTION",
        "VAP",
        "BLOODSTREAM_INFECTION",
        "C_DIFF_INFECTION",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    severity: {
      type: String,
      enum: ["MINOR", "MODERATE", "MAJOR", "CRITICAL"],
      required: true,
      default: "MINOR",
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: false,
    },
    visitId: {
      type: Schema.Types.ObjectId,
      ref: "ScanShareVisit",
      required: false,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: false,
    },
    reportedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    wardLocation: {
      type: String,
      trim: true,
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
    resolvedAt: {
      type: Date,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: "incident_reports",
  }
);

IncidentReportSchema.index({ hospitalId: 1, reportedAt: -1 });
IncidentReportSchema.index({ type: 1, hospitalId: 1, reportedAt: -1 });
IncidentReportSchema.index({ isResolved: 1, hospitalId: 1, reportedAt: -1 });
IncidentReportSchema.index({ visitId: 1 }, { sparse: true });
IncidentReportSchema.index({ patientId: 1 }, { sparse: true });

export const IncidentReportModel = model<IIncidentReport>(
  "IncidentReport",
  IncidentReportSchema
);
