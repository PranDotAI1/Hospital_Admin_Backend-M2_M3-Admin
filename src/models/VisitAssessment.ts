import { Schema, model, Document, Types } from "mongoose";

export interface IImmunizationRecord {
  covid19Dose1Date?: Date;
  covid19Dose2Date?: Date;
  tetanusBoosterDate?: Date;
  fluVaccineDate?: Date;
}

export interface IMedicalHistoryEntry {
  disease?: string;
  duration?: string;
  medications?: string;
}

export interface ISurgicalHistoryEntry {
  surgical?: string;
  surgeonName?: string;
  date?: Date;
  hospital?: string;
}

export interface IAdditionalDetailsEntry {
  type?: string;
  duration?: string;
  units?: string;
  frequency?: string;
  action?: string;
}

export interface IPersonalHistoryEntry {
  diet?: string;
  appetite?: string;
  sleep?: string;
  blader?: string;
  bowel?: string;
}

export interface IVisitAssessment extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  vitals?: Record<string, unknown>;
  immunization?: IImmunizationRecord;
  symptomsComplaints?: string;
  medicalHistory: IMedicalHistoryEntry[];
  surgicalHistory: ISurgicalHistoryEntry[];
  additionalDetails: IAdditionalDetailsEntry[];
  personalHistory: IPersonalHistoryEntry[];
  documentUploads?: string[];
  dataSharingConsent?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const ImmunizationRecordSchema = new Schema<IImmunizationRecord>(
  {
    covid19Dose1Date: { type: Date },
    covid19Dose2Date: { type: Date },
    tetanusBoosterDate: { type: Date },
    fluVaccineDate: { type: Date },
  },
  { _id: false },
);

const MedicalHistoryEntrySchema = new Schema<IMedicalHistoryEntry>(
  {
    disease: { type: String, trim: true },
    duration: { type: String, trim: true },
    medications: { type: String, trim: true },
  },
  { _id: false },
);

const SurgicalHistoryEntrySchema = new Schema<ISurgicalHistoryEntry>(
  {
    surgical: { type: String, trim: true },
    surgeonName: { type: String, trim: true },
    date: { type: Date },
    hospital: { type: String, trim: true },
  },
  { _id: false },
);

const AdditionalDetailsEntrySchema = new Schema<IAdditionalDetailsEntry>(
  {
    type: { type: String, trim: true },
    duration: { type: String, trim: true },
    units: { type: String, trim: true },
    frequency: { type: String, trim: true },
    action: { type: String, trim: true },
  },
  { _id: false },
);

const PersonalHistoryEntrySchema = new Schema<IPersonalHistoryEntry>(
  {
    diet: { type: String, trim: true },
    appetite: { type: String, trim: true },
    sleep: { type: String, trim: true },
    blader: { type: String, trim: true },
    bowel: { type: String, trim: true },
  },
  { _id: false },
);

const VisitAssessmentSchema = new Schema<IVisitAssessment>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, required: true, index: true },
    vitals: { type: Schema.Types.Mixed },
    immunization: { type: ImmunizationRecordSchema },
    symptomsComplaints: { type: String, trim: true },
    medicalHistory: { type: [MedicalHistoryEntrySchema], default: [] },
    surgicalHistory: { type: [SurgicalHistoryEntrySchema], default: [] },
    additionalDetails: { type: [AdditionalDetailsEntrySchema], default: [] },
    personalHistory: { type: [PersonalHistoryEntrySchema], default: [] },
    documentUploads: { type: [String], default: [] },
    dataSharingConsent: { type: Boolean },
  },
  { timestamps: true },
);

export const VisitAssessmentModel = model<IVisitAssessment>(
  "VisitAssessment",
  VisitAssessmentSchema,
  "visit_assessments",
);
