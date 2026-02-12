import { Schema, model, Document, Types } from "mongoose";

export interface ILabReportLine {
  equipmentId?: string;
  testType?: string;
  resultValue?: string;
  measurementUnit?: string;
  captureTime?: Date;
  equipmentStatus?: string;
  sampleId?: string;
  reportDate?: Date;
  reportTime?: string;
  additionalObservations?: string;
  analystName?: string;
}

export interface IVisitLabReport extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  reports: ILabReportLine[];
  createdAt?: Date;
  updatedAt?: Date;
}

const LabReportLineSchema = new Schema<ILabReportLine>(
  {
    equipmentId: { type: String, trim: true },
    testType: { type: String, trim: true },
    resultValue: { type: String, trim: true },
    measurementUnit: { type: String, trim: true },
    captureTime: { type: Date },
    equipmentStatus: { type: String, trim: true },
    sampleId: { type: String, trim: true },
    reportDate: { type: Date },
    reportTime: { type: String, trim: true },
    additionalObservations: { type: String, trim: true },
    analystName: { type: String, trim: true },
  },
  { _id: false },
);

const VisitLabReportSchema = new Schema<IVisitLabReport>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true },
    patientId: { type: Schema.Types.ObjectId, required: true, index: true },
    reports: { type: [LabReportLineSchema], default: [] },
  },
  { timestamps: true },
);

VisitLabReportSchema.index({ visitId: 1 }, { unique: true });

export const VisitLabReportModel = model<IVisitLabReport>(
  "VisitLabReport",
  VisitLabReportSchema,
  "visit_lab_reports",
);
