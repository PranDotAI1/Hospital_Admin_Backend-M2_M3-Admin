import { Schema, model, Document } from "mongoose";

export enum VisitStatus {
  PENDING = "PENDING",
  REGISTERED = "REGISTERED",
}

export interface IAddress {
  line: string;
  district: string;
  state: string;
  pincode: string;
}

export interface IInsurance {
  provider?: string;
  policyNumber?: string;
}

export interface IPayment {
  mode?: string;
  amount?: number;
}

export interface IOPDVisit extends Document {
  tokenNumber: string;
  visitStatus: VisitStatus;
  visitDate: Date;
  counterId: string;
  abhaAddress?: string;
  abhaNumber?: string;
  name?: string;
  gender?: string;
  dob?: string;
  mobile?: string;
  address?: IAddress;
  aadhaarNumber?: string;
  hprId?: string;
  latitude?: string;
  longitude?: string;

  department?: string;
  doctorName?: string;
  consultationFee?: number;
  complaint?: string;
  isEmergency?: boolean;
  payment?: IPayment;
  insurance?: IInsurance;
}

const AddressSchema = new Schema<IAddress>(
  {
    line: { type: String, required: false, trim: true },
    district: { type: String, required: false, trim: true },
    state: { type: String, required: false, trim: true },
    pincode: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const InsuranceSchema = new Schema<IInsurance>(
  {
    provider: { type: String, required: false, trim: true },
    policyNumber: { type: String, required: false, trim: true },
  },
  { _id: false },
);

const PaymentSchema = new Schema<IPayment>(
  {
    mode: { type: String, required: false, trim: true },
    amount: { type: Number, required: false, min: 0 },
  },
  { _id: false },
);

const OPDVisitSchema = new Schema<IOPDVisit>(
  {
    tokenNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    visitStatus: {
      type: String,
      enum: Object.values(VisitStatus),
      default: VisitStatus.PENDING,
      required: true,
      index: true,
    },
    visitDate: {
      type: Date,
      default: Date.now,
      required: true,
      index: true,
    },
    counterId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    abhaAddress: { type: String, required: false, trim: true, index: true },
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
  },
  {
    timestamps: true,
    collection: "opd_visits",
  },
);

OPDVisitSchema.index({ visitStatus: 1, visitDate: 1 });
OPDVisitSchema.index({ tokenNumber: 1, visitStatus: 1 });
OPDVisitSchema.index({ abhaAddress: 1, visitDate: 1 });

export const OPDVisitModel = model<IOPDVisit>("OPDVisit", OPDVisitSchema);
