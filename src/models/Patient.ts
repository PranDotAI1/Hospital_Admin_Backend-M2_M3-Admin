import { Schema, model, Document, Types } from "mongoose";

export interface IPatientVisitRef {
  visitId?: Types.ObjectId;
  tokenNumber?: string;
  visitDate: Date;
  visitStatus: string;
  department?: string;
  departmentId?: Types.ObjectId;
  doctorName?: string;
  doctorId?: Types.ObjectId;
  consultationFee?: number;
  visitType?: string;
  description?: string;
}

export interface IPatientInsurance {
  provider?: string;
  policyNumber?: string;
  addedOn?: Date;
}

export interface IAbdmLinkToken {
  token: string;
  issuedAt: Date;
  expiresAt: Date;
  status: "ACTIVE" | "EXPIRED";
  abhaAddress?: string;
}

export interface IPatientSocialProfile {
  education?:           "NONE" | "PRIMARY" | "SECONDARY" | "GRADUATE" | "POSTGRADUATE";
  employment?:          "EMPLOYED" | "UNEMPLOYED" | "SELF_EMPLOYED" | "STUDENT" | "RETIRED";
  incomeLevel?:         "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH";
  housingStability?:    "OWNED" | "RENTED" | "HOMELESS" | "SHELTER";
  foodSecurity?:        "SECURE" | "INSECURE";
  accessToHealthcare?:  "GOOD" | "LIMITED" | "NO_ACCESS";
  hasCriminalSafetyRisk?: boolean;
  updatedAt?:           Date;
  updatedBy?:           Types.ObjectId;
}

export interface IPatient extends Document {
  uhid?: string;
  f_name: string;
  m_name?: string;
  l_name?: string;
  name?: string;
  mobile: string;
  dob?: string;
  age?: string;
  address?: string;
  ABHANumber?: string;
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
  abhaLinkedAt?: Date;
  allergies?: string;
  existingMedicalConditions?: string;
  ongoingMedications?: string;
  lastVisitedDoctor?: string;
  profilePhoto?: string;

  abdmLinkToken?: IAbdmLinkToken;
  abdmLinkTokenRequestedAt?: Date;

  isMerged?: boolean;
  mergedToPatient?: Types.ObjectId;

  socialProfile?: IPatientSocialProfile;

  hospitalId?: Types.ObjectId;
}

const PatientVisitRefSchema = new Schema<IPatientVisitRef>(
  {
    visitId: { type: Schema.Types.ObjectId },
    tokenNumber: { type: String },
    visitDate: { type: Date, required: true },
    visitStatus: { type: String, required: true },
    department: { type: String },
    departmentId: {
      type: Schema.Types.ObjectId,
      required: false,
      ref: "Department",
    },
    doctorName: { type: String },
    doctorId: { type: Schema.Types.ObjectId, required: false, ref: "Doctor" },
    consultationFee: { type: Number, min: 0 },
    visitType: { type: String },
    description: { type: String },
  },
  { _id: false },
);

const PatientInsuranceSchema = new Schema<IPatientInsurance>(
  {
    provider: { type: String, trim: true },
    policyNumber: { type: String, trim: true },
    addedOn: { type: Date, default: Date.now },
  },
  { _id: false },
);

const PatientSchema = new Schema<IPatient>(
  {
    uhid: {
      type: String,
      trim: true,
    },
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
      required: false,
      trim: true,
    },
    age: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    ABHANumber: {
      type: String,
      required: false,
      trim: true,
    },
    abhaaddress: {
      type: String,
      trim: true,
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
    abhaLinkedAt: {
      type: Date,
    },
    allergies: { type: String, trim: true },
    existingMedicalConditions: { type: String, trim: true },
    ongoingMedications: { type: String, trim: true },
    lastVisitedDoctor: {
      type: String,
      trim: true,
    },
    profilePhoto: {
      type: String,
    },
    // ABDM Link Token for Care Context linking
    abdmLinkToken: {
      token: { type: String, trim: true },
      issuedAt: { type: Date },
      expiresAt: { type: Date },
      status: { type: String, enum: ["ACTIVE", "EXPIRED"] },
      abhaAddress: { type: String, trim: true }, // ABHA address this token was issued for
    },
    abdmLinkTokenRequestedAt: { type: Date },
    isMerged: { type: Boolean, default: false },
    mergedToPatient: { type: Schema.Types.ObjectId, ref: "Patient" },

    socialProfile: {
      education:           { type: String, enum: ["NONE", "PRIMARY", "SECONDARY", "GRADUATE", "POSTGRADUATE"] },
      employment:          { type: String, enum: ["EMPLOYED", "UNEMPLOYED", "SELF_EMPLOYED", "STUDENT", "RETIRED"] },
      incomeLevel:         { type: String, enum: ["VERY_LOW", "LOW", "MEDIUM", "HIGH"] },
      housingStability:    { type: String, enum: ["OWNED", "RENTED", "HOMELESS", "SHELTER"] },
      foodSecurity:        { type: String, enum: ["SECURE", "INSECURE"] },
      accessToHealthcare:  { type: String, enum: ["GOOD", "LIMITED", "NO_ACCESS"] },
      hasCriminalSafetyRisk: { type: Boolean },
      updatedAt:           { type: Date },
      updatedBy:           { type: Schema.Types.ObjectId, ref: "User" },
    },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital" },
  },
  {
    collection: "Patients",
    strict: true,
    timestamps: { createdAt: false, updatedAt: true },
  },
);

PatientSchema.index({ ABHANumber: 1 }, { sparse: true });
PatientSchema.index({ abhaaddress: 1 }, { unique: true, sparse: true });
PatientSchema.index({ mobile: 1 });
PatientSchema.index({ uhid: 1 }, { unique: true, sparse: true });
PatientSchema.index({ isMerged: 1, status: 1, updatedAt: -1 });
PatientSchema.index({ hospitalId: 1 });                           // analytics hospital filter
PatientSchema.index({ hospitalId: 1, "socialProfile.employment": 1 }); // SDOH aggregation

export const PatientModel = model<IPatient>("Patient", PatientSchema);
