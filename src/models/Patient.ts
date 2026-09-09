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
  abhaAddress?: string; // ABHA address this token was issued for
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
  abdmLinkTokenRequestId?: string; // correlate error callbacks

  isMerged?: boolean;
  mergedToPatient?: Types.ObjectId;
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
    abdmLinkTokenRequestId: { type: String }, // correlate ABDM error callbacks
    isMerged: { type: Boolean, default: false },
    mergedToPatient: { type: Schema.Types.ObjectId, ref: "Patient" },
  },
  {
    collection: "Patients",
    strict: true,
    timestamps: { createdAt: false, updatedAt: true },
  },
);

// --- Pre-validate & Pre-save Data Integrity & Sanitization Hooks ---
PatientSchema.pre("validate", function (next) {
  const sanitizeText = (val: unknown): string | undefined => {
    if (typeof val !== "string") return undefined;
    let s = val.replace(/\[object\s+Object\]/gi, "").trim();
    s = s.replace(/<[^>]*>/g, "").replace(/javascript:|on\w+\s*=/gi, "").replace(/[<>]/g, "");
    return s.trim() || undefined;
  };

  if (this.f_name) {
    const cleaned = sanitizeText(this.f_name);
    if (!cleaned) {
      return next(new Error("First name cannot be empty or contain invalid object/script tags"));
    }
    this.f_name = cleaned;
  }

  if (this.m_name) {
    this.m_name = sanitizeText(this.m_name);
  }

  if (this.l_name) {
    this.l_name = sanitizeText(this.l_name);
  }

  // Ensure full name is clean and does not contain [object Object]
  const computed = [this.f_name, this.m_name, this.l_name].filter(Boolean).join(" ");
  this.name = computed || sanitizeText(this.name) || "Patient";

  if (this.mobile) {
    const cleanMobile = sanitizeText(this.mobile);
    if (!cleanMobile || !/^[6-9]\d{9}$/.test(cleanMobile)) {
      return next(new Error("Valid 10-digit mobile number starting with 6-9 is required"));
    }
    this.mobile = cleanMobile;
  }

  if (this.dob) {
    const cleanDob = sanitizeText(this.dob);
    this.dob = cleanDob;
  }

  if (this.aadhaarNumber) {
    const digits = this.aadhaarNumber.replace(/\D/g, "");
    if (digits.length === 12) {
      this.aadhaarNumber = `XXXX-XXXX-${digits.slice(8, 12)}`;
    }
  }

  if (this.address) this.address = sanitizeText(this.address);
  if (this.allergies) this.allergies = sanitizeText(this.allergies);
  if (this.existingMedicalConditions)
    this.existingMedicalConditions = sanitizeText(this.existingMedicalConditions);
  if (this.ongoingMedications)
    this.ongoingMedications = sanitizeText(this.ongoingMedications);

  next();
});

// Sanitize fields during findOneAndUpdate / update operations
PatientSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const update = this.getUpdate() as any;
  if (!update) return next();

  const sanitizeText = (val: unknown): string | undefined => {
    if (typeof val !== "string") return undefined;
    let s = val.replace(/\[object\s+Object\]/gi, "").trim();
    s = s.replace(/<[^>]*>/g, "").replace(/javascript:|on\w+\s*=/gi, "").replace(/[<>]/g, "");
    return s.trim() || undefined;
  };

  const sanitizeOps = (ops: any) => {
    if (!ops) return;
    if (ops.f_name !== undefined) ops.f_name = sanitizeText(ops.f_name);
    if (ops.m_name !== undefined) ops.m_name = sanitizeText(ops.m_name);
    if (ops.l_name !== undefined) ops.l_name = sanitizeText(ops.l_name);
    if (ops.name !== undefined) ops.name = sanitizeText(ops.name);
    if (ops.mobile !== undefined) {
      const cleanMob = sanitizeText(ops.mobile);
      if (cleanMob && /^[6-9]\d{9}$/.test(cleanMob)) {
        ops.mobile = cleanMob;
      } else {
        delete ops.mobile;
      }
    }
    if (ops.dob !== undefined) ops.dob = sanitizeText(ops.dob);
    if (ops.aadhaarNumber !== undefined && typeof ops.aadhaarNumber === "string") {
      const digits = ops.aadhaarNumber.replace(/\D/g, "");
      if (digits.length === 12) {
        ops.aadhaarNumber = `XXXX-XXXX-${digits.slice(8, 12)}`;
      }
    }
  };

  if (update.$set) sanitizeOps(update.$set);
  sanitizeOps(update);

  next();
});

PatientSchema.index({ ABHANumber: 1 }, { sparse: true });
PatientSchema.index({ abhaaddress: 1 }, { unique: true, sparse: true });
PatientSchema.index({ mobile: 1 });
PatientSchema.index({ uhid: 1 }, { unique: true, sparse: true });
PatientSchema.index({ isMerged: 1, status: 1, updatedAt: -1 });

export const PatientModel = model<IPatient>("Patient", PatientSchema);
