import { Document, Schema, model, Types } from "mongoose";
import { DOCTOR_STATUS, DOCTOR_CURRENT_STATUS } from "../utils/constant";

export type DoctorStatusType =
  (typeof DOCTOR_STATUS)[keyof typeof DOCTOR_STATUS];
export type DoctorCurrentStatusType =
  (typeof DOCTOR_CURRENT_STATUS)[keyof typeof DOCTOR_CURRENT_STATUS];

export interface IAvailableSlot {
  day: string;
  startTime: string;
  endTime: string;
  _id?: Types.ObjectId;
}

export interface IDoctor extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialization: string;
  department: Types.ObjectId;
  licenseNumber: string;
  experience: number;
  qualification: string;
  consultationFee: number;
  availableSlots: IAvailableSlot[];
  isActive: boolean;

  gender?: string;
  age?: number;
  profileImage?: string;

  primarySpecializationId?: Types.ObjectId;
  additionalSpecializationIds?: Types.ObjectId[];

  hospital_id?: Types.ObjectId;
  assignedHospitalUnitIds?: Types.ObjectId[];

  assignedPatientIds?: Types.ObjectId[];

  status: DoctorStatusType;
  currentStatus: DoctorCurrentStatusType;
  currentStatusUpdatedAt?: Date;
  currentVisitId?: Types.ObjectId;

  inviteToken?: string;
  inviteTokenExpires?: Date;
  inviteSentAt?: Date;

  accessLevel?: "FULL" | "LIMITED" | "VIEW_ONLY";
  permissions?: Record<
    string,
    { view?: boolean; create?: boolean; edit?: boolean; delete?: boolean }
  >;

  timeZone?: string;

  created_by?: string;
  updated_by?: string;
}

const AvailableSlotSchema = new Schema<IAvailableSlot>(
  {
    day: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
    },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const DoctorSchema = new Schema<IDoctor>(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      trim: true,
    },
    specialization: {
      type: String,
      required: [true, "Specialization is required"],
      trim: true,
    },
    department: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: [true, "Department is required"],
    },
    licenseNumber: {
      type: String,
      required: [true, "License number is required"],
      trim: true,
    },
    experience: {
      type: Number,
      required: [true, "Experience is required"],
      min: 0,
    },
    qualification: {
      type: String,
      required: [true, "Qualification is required"],
      trim: true,
    },
    consultationFee: {
      type: Number,
      required: [true, "Consultation fee is required"],
      min: 0,
    },
    availableSlots: {
      type: [AvailableSlotSchema],
      required: [true, "Available slots are required"],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },

    gender: { type: String, required: false, trim: true },
    age: { type: Number, required: false, min: 0 },
    profileImage: { type: String, required: false, trim: true },

    primarySpecializationId: {
      type: Schema.Types.ObjectId,
      ref: "Specialize",
      required: false,
    },
    additionalSpecializationIds: [
      { type: Schema.Types.ObjectId, ref: "Specialize" },
    ],

    hospital_id: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: false,
    },
    assignedHospitalUnitIds: [{ type: Schema.Types.ObjectId, ref: "Hospital" }],

    assignedPatientIds: [{ type: Schema.Types.ObjectId, ref: "Patient" }],

    status: {
      type: String,
      required: true,
      enum: Object.values(DOCTOR_STATUS),
      default: DOCTOR_STATUS.ACTIVE,
    },
    currentStatus: {
      type: String,
      required: true,
      enum: Object.values(DOCTOR_CURRENT_STATUS),
      default: DOCTOR_CURRENT_STATUS.OFF_DUTY,
    },
    currentStatusUpdatedAt: { type: Date, required: false },
    currentVisitId: {
      type: Schema.Types.ObjectId,
      ref: "ScanShareVisit",
      required: false,
    },

    inviteToken: { type: String, required: false, select: false },
    inviteTokenExpires: { type: Date, required: false, select: false },
    inviteSentAt: { type: Date, required: false, select: false },

    accessLevel: {
      type: String,
      enum: ["FULL", "LIMITED", "VIEW_ONLY"],
      required: false,
      default: "FULL",
    },
    permissions: { type: Schema.Types.Mixed, required: false },

    timeZone: { type: String, required: false, default: "Asia/Kolkata" },

    created_by: { type: String, trim: true, required: false },
    updated_by: { type: String, trim: true, required: false },
  },
  {
    timestamps: true,
    collection: "doctor_v1",
  }
);

DoctorSchema.index({ email: 1 }, { unique: true });
DoctorSchema.index({ licenseNumber: 1 }, { unique: true, sparse: true });
DoctorSchema.index({ department: 1, status: 1 });
DoctorSchema.index({ status: 1, currentStatus: 1 });
DoctorSchema.index({ specialization: 1 });
DoctorSchema.index({ isActive: 1 });
DoctorSchema.index({
  firstName: "text",
  lastName: "text",
  email: "text",
  licenseNumber: "text",
  specialization: "text",
});

DoctorSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

DoctorSchema.set("toJSON", { virtuals: true });
DoctorSchema.set("toObject", { virtuals: true });

export const DoctorModel = model<IDoctor>("Doctor", DoctorSchema);
