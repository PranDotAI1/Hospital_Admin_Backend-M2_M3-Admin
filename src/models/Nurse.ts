import { Document, Schema, model, Types } from "mongoose";
import type { ModulePermissions } from "../utils/permissions.constants";

export const NURSE_STATUS = {
  ACTIVE: "ACTIVE",
  ON_LEAVE: "ON_LEAVE",
  RETIRED: "RETIRED",
  INACTIVE: "INACTIVE",
} as const;

export type NurseStatusType =
  (typeof NURSE_STATUS)[keyof typeof NURSE_STATUS];

export interface INurse extends Document {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialization: string;
  department: Types.ObjectId;
  licenseNumber?: string;
  experience?: number;
  qualification: string;
  isActive: boolean;

  shift?: "DAY" | "NIGHT" | "ROTATION";
  assignedDoctorId?: Types.ObjectId;
  certifications?: string;
  roleType?: string;

  gender?: string;
  age?: number;
  profileImage?: string;

  hospital_id?: Types.ObjectId;
  assignedHospitalUnitIds?: Types.ObjectId[];

  status: NurseStatusType;

  accessLevel?: "FULL" | "LIMITED" | "VIEW_ONLY";
  permissions?: Map<string, ModulePermissions>;

  timeZone?: string;

  created_by?: string;
  updated_by?: string;
}

const NurseSchema = new Schema<INurse>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    licenseNumber: { type: String, required: false, trim: true },
    experience: { type: Number, required: false, min: 0 },
    qualification: { type: String, required: true, trim: true },
    
    shift: {
      type: String,
      enum: ["DAY", "NIGHT", "ROTATION"],
      required: false,
    },
    assignedDoctorId: { type: Schema.Types.ObjectId, ref: "Doctor", required: false },
    certifications: { type: String, trim: true, required: false },
    roleType: { type: String, trim: true, required: false },
    isActive: { type: Boolean, default: true },

    gender: { type: String, trim: true },
    age: { type: Number, min: 0 },
    profileImage: { type: String, trim: true },

    hospital_id: { type: Schema.Types.ObjectId, ref: "Hospital" },
    assignedHospitalUnitIds: [{ type: Schema.Types.ObjectId, ref: "HospitalUnit" }],

    status: {
      type: String,
      enum: Object.values(NURSE_STATUS),
      default: NURSE_STATUS.ACTIVE,
    },

    accessLevel: {
      type: String,
      enum: ["FULL", "LIMITED", "VIEW_ONLY"],
      required: false,
      default: "LIMITED",
    },
    permissions: {
      type: Map,
      of: new Schema(
        {
          view: { type: Boolean, default: false },
          create: { type: Boolean, default: false },
          edit: { type: Boolean, default: false },
          delete: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      required: false,
      default: undefined,
    },

    timeZone: { type: String, required: false, default: "Asia/Kolkata" },

    created_by: { type: String },
    updated_by: { type: String },
  },
  {
    timestamps: true,
  }
);

export const NurseModel = model<INurse>("Nurse", NurseSchema);
