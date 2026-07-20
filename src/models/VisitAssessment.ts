import { Schema, model, Document, Types } from "mongoose";

export interface IImmunizationEntry {
  date?: Date;
  manufacturer?: string;
  lotNumber?: string;
  doseNumber?: number;
}

export interface IImmunizationRecord {
  covid19Dose1Date?: Date;
  covid19Dose2Date?: Date;
  tetanusBoosterDate?: Date;
  fluVaccineDate?: Date;
  covid19Dose1?: IImmunizationEntry;
  covid19Dose2?: IImmunizationEntry;
  tetanusBooster?: IImmunizationEntry;
  fluVaccine?: IImmunizationEntry;
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

export interface IPhysicalActivity {
  stepsPerDay?: number;
  caloriesBurned?: number;
  sleepDuration?: number;
}

export interface ILifestyle {
  dietType?: string;
  smokingBehavior?: string;
  alcoholBehavior?: string;
}

export interface IWomenHealth {
  ageAtMenarche?: number;
  lastMenstrualPeriod?: Date;
}

export interface IDocumentUpload {
  fileName: string;
  mimeType: string;
  fileData?: Buffer;
  fileUrl?: string;
  uploadDate: Date;
}

export interface IDiagnosisEntry {
  code:    string;
  display: string;
  system:  string;
}

export interface IVisitAssessment extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  vitals?: Record<string, unknown>;
  immunization?: IImmunizationRecord;
  symptomsComplaints?: string;
  medicalHistory: IMedicalHistoryEntry[];
  surgicalHistory: ISurgicalHistoryEntry[];
  physicalActivity?: IPhysicalActivity;
  lifestyle?: ILifestyle;
  womenHealth?: IWomenHealth;
  documentUploads?: IDocumentUpload[];
  dataSharingConsent?: boolean;

  primaryDiagnosis?:   IDiagnosisEntry;
  secondaryDiagnoses?: IDiagnosisEntry[];
  complications?:      string[];
  isReadmission?:      boolean;
  patientDied?:        boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

const ImmunizationEntrySchema = new Schema<IImmunizationEntry>(
  {
    date: { type: Date },
    manufacturer: { type: String, trim: true },
    lotNumber: { type: String, trim: true },
    doseNumber: { type: Number },
  },
  { _id: false },
);

const ImmunizationRecordSchema = new Schema<IImmunizationRecord>(
  {
    covid19Dose1Date: { type: Date },
    covid19Dose2Date: { type: Date },
    tetanusBoosterDate: { type: Date },
    fluVaccineDate: { type: Date },
    covid19Dose1: { type: ImmunizationEntrySchema },
    covid19Dose2: { type: ImmunizationEntrySchema },
    tetanusBooster: { type: ImmunizationEntrySchema },
    fluVaccine: { type: ImmunizationEntrySchema },
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

const PhysicalActivitySchema = new Schema<IPhysicalActivity>(
  {
    stepsPerDay: { type: Number },
    caloriesBurned: { type: Number },
    sleepDuration: { type: Number },
  },
  { _id: false },
);

const LifestyleSchema = new Schema<ILifestyle>(
  {
    dietType: { type: String, trim: true },
    smokingBehavior: { type: String, trim: true },
    alcoholBehavior: { type: String, trim: true },
  },
  { _id: false },
);

const WomenHealthSchema = new Schema<IWomenHealth>(
  {
    ageAtMenarche: { type: Number },
    lastMenstrualPeriod: { type: Date },
  },
  { _id: false },
);

const DocumentUploadSchema = new Schema<IDocumentUpload>(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileData: { type: Buffer },
    fileUrl: { type: String },
    uploadDate: { type: Date, default: Date.now },
  },
  { _id: false },
);

const VisitAssessmentSchema = new Schema<IVisitAssessment>(
  {
    visitId: {
      type: Schema.Types.ObjectId,
      required: true,
      unique: true,
    },
    patientId: { type: Schema.Types.ObjectId, required: true },
    vitals: { type: Schema.Types.Mixed },
    immunization: { type: ImmunizationRecordSchema },
    symptomsComplaints: { type: String, trim: true },
    medicalHistory: { type: [MedicalHistoryEntrySchema], default: [] },
    surgicalHistory: { type: [SurgicalHistoryEntrySchema], default: [] },
    physicalActivity: { type: PhysicalActivitySchema },
    lifestyle: { type: LifestyleSchema },
    womenHealth: { type: WomenHealthSchema },
    documentUploads: { type: [DocumentUploadSchema], default: [] },
    dataSharingConsent: { type: Boolean },

    primaryDiagnosis: {
      code:    { type: String, trim: true },
      display: { type: String, trim: true },
      system:  { type: String, trim: true, default: "ICD-10" },
    },
    secondaryDiagnoses: [
      {
        code:    { type: String, trim: true },
        display: { type: String, trim: true },
        system:  { type: String, trim: true, default: "ICD-10" },
        _id:     false,
      },
    ],
    complications: [{ type: String, trim: true }],
    isReadmission:  { type: Boolean, default: false },
    patientDied:    { type: Boolean, default: false },
  },

  { timestamps: true },
);

VisitAssessmentSchema.index({ patientId: 1 });
VisitAssessmentSchema.index({ "primaryDiagnosis.code": 1 });
VisitAssessmentSchema.index({ visitId: 1, "primaryDiagnosis.code": 1 });

export const VisitAssessmentModel = model<IVisitAssessment>(
  "VisitAssessment",
  VisitAssessmentSchema,
  "visit_assessments",
);
