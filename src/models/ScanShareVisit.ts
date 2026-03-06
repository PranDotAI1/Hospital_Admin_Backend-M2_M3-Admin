import { Schema, model, Document, Types } from "mongoose";

export enum ScanShareVisitStatus {
  PENDING = "PENDING",
  REGISTERED = "REGISTERED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  MISSED = "MISSED",
}

export interface IScanShareVisitAddress {
  line: string;
  district: string;
  state: string;
  pincode: string;
}

export interface IScanShareVisitInsurance {
  provider?: string;
  policyNumber?: string;
}

export interface IScanShareVisitPayment {
  mode?: string;
  amount?: number;
}

export interface IScanShareVisit extends Document {
  tokenNumber: string;
  visitStatus: ScanShareVisitStatus;
  visitDate: Date;
  counterId: string;
  abhaAddress?: string;
  abhaNumber?: string;
  name?: string;
  gender?: string;
  dob?: string;
  mobile?: string;
  address?: IScanShareVisitAddress;
  aadhaarNumber?: string;
  hprId?: string;
  latitude?: string;
  longitude?: string;

  department?: string;
  doctorName?: string;
  consultationFee?: number;
  complaint?: string;
  isEmergency?: boolean;
  payment?: IScanShareVisitPayment;
  insurance?: IScanShareVisitInsurance;

  patientId?: Types.ObjectId;
}

const AddressSchema = new Schema<IScanShareVisitAddress>(
  {
    line: { type: String, required: false, trim: true },
    district: { type: String, required: false, trim: true },
    state: { type: String, required: false, trim: true },
    pincode: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const InsuranceSchema = new Schema<IScanShareVisitInsurance>(
  {
    provider: { type: String, required: false, trim: true },
    policyNumber: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const PaymentSchema = new Schema<IScanShareVisitPayment>(
  {
    mode: { type: String, required: false, trim: true },
    amount: { type: Number, required: false, min: 0 },
  },
  { _id: false },
);

const ScanShareVisitSchema = new Schema<IScanShareVisit>(
  {
    tokenNumber: {
      type: String,
      required: true,
      trim: true,
    },
    visitStatus: {
      type: String,
      enum: Object.values(ScanShareVisitStatus),
      default: ScanShareVisitStatus.PENDING,
      required: true,
    },
    visitDate: {
      type: Date,
      default: Date.now,
      required: true,
    },
    counterId: {
      type: String,
      required: true,
      trim: true,
    },

    abhaAddress: { type: String, required: false, trim: true },
    abhaNumber: { type: String, required: false, trim: true },
    name: { type: String, required: false, trim: true },
    gender: { type: String, required: false, trim: true },
    dob: { type: String, required: false, trim: true },
    mobile: { type: String, required: false, trim: true },
    address: { type: AddressSchema, required: false },
    aadhaarNumber: { type: String, required: false, trim: true },
    hprId: { type: String, required: false, trim: true },
    latitude: { type: String, required: false, trim: true },
    longitude: { type: String, required: false, trim: true },

    department: { type: String, required: false, trim: true },
    doctorName: { type: String, required: false, trim: true },
    consultationFee: { type: Number, required: false, min: 0 },
    complaint: { type: String, required: false, trim: true },
    isEmergency: { type: Boolean, required: false, default: false },
    payment: { type: PaymentSchema, required: false },
    insurance: { type: InsuranceSchema, required: false },

    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: false },
  },
  {
    timestamps: true,
    collection: "scan_share_visits",
  },
);

ScanShareVisitSchema.index({ visitDate: 1, createdAt: -1 });
ScanShareVisitSchema.index({ visitStatus: 1, visitDate: 1, createdAt: -1 });
ScanShareVisitSchema.index({ tokenNumber: 1, visitStatus: 1 });
ScanShareVisitSchema.index({ abhaAddress: 1, createdAt: -1 });
ScanShareVisitSchema.index({ patientId: 1 });

export const ScanShareVisitModel = model<IScanShareVisit>(
  "ScanShareVisit",
  ScanShareVisitSchema,
);
