import { Schema, model, Document, Types } from "mongoose";

export interface IPatientVisitRef {
  visitId: Types.ObjectId;
  tokenNumber: string;
  visitDate: Date;
  visitStatus: string;
  department?: string;
  doctorName?: string;
}

export interface IPatientInsurance {
  provider?: string;
  policyNumber?: string;
  addedOn?: Date;
}

export interface IPatient extends Document {
  f_name: string;
  m_name?: string;
  l_name?: string;
  name?: string;
  mobile: string;
  dob: string;
  address?: string;
  ABHANumber: string;
  abhaaddress?: string;
  gender?: string;
  status?: string;
  pincode?: string;
  createdAt: Date;

  aadhaarNumber?: string;
  visits?: IPatientVisitRef[];
  lastVisitDate?: Date;
  totalVisits?: number;
  insurance?: IPatientInsurance[];
  email?: string;
  bloodGroup?: string;
  emergencyContact?: string;
}

const PatientVisitRefSchema = new Schema<IPatientVisitRef>(
  {
    visitId: { type: Schema.Types.ObjectId, ref: "OPDVisit", required: true },
    tokenNumber: { type: String, required: true },
    visitDate: { type: Date, required: true },
    visitStatus: { type: String, required: true },
    department: { type: String },
    doctorName: { type: String },
  },
  { _id: false }
);

const PatientInsuranceSchema = new Schema<IPatientInsurance>(
  {
    provider: { type: String, trim: true },
    policyNumber: { type: String, trim: true },
    addedOn: { type: Date, default: Date.now },
  },
  { _id: false }
);

const PatientSchema = new Schema<IPatient>(
  {
    f_name: {
      type: String,
      required: true,
      trim: true,
    },
    m_name: {
      type: String,
      trim: true,
    },
    l_name: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    ABHANumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    abhaaddress: {
      type: String,
      trim: true,
      index: true,
    },
    gender: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      trim: true,
    },
    pincode: {
      type: String,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },

    aadhaarNumber: {
      type: String,
      trim: true,
    },
    visits: {
      type: [PatientVisitRefSchema],
      default: [],
    },
    lastVisitDate: {
      type: Date,
    },
    totalVisits: {
      type: Number,
      default: 0,
    },
    insurance: {
      type: [PatientInsuranceSchema],
      default: [],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    bloodGroup: {
      type: String,
      trim: true,
    },
    emergencyContact: {
      type: String,
      trim: true,
    },
  },
  {
    collection: "Patients",
    strict: true,
    timestamps: { createdAt: false, updatedAt: true },
  }
);

PatientSchema.index({ ABHANumber: 1 }, { unique: true });
PatientSchema.index({ abhaaddress: 1 });
PatientSchema.index({ mobile: 1 });

export const PatientModel = model<IPatient>("Patient", PatientSchema);
