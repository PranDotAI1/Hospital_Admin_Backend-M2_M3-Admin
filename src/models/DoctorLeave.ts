import { Document, Schema, model, Types } from "mongoose";
import {
  LEAVE_TYPE,
  LEAVE_REQUEST_STATUS,
} from "../utils/constant";

export type LeaveType = (typeof LEAVE_TYPE)[keyof typeof LEAVE_TYPE];
export type LeaveRequestStatusType =
  (typeof LEAVE_REQUEST_STATUS)[keyof typeof LEAVE_REQUEST_STATUS];

export interface IDoctorLeave extends Document {
  doctorId: Types.ObjectId;
  fromDate: Date;
  toDate: Date;
  type: LeaveType;
  status: LeaveRequestStatusType;
  reason?: string;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  created_by?: string;
  updated_by?: string;
}

const DoctorLeaveSchema = new Schema<IDoctorLeave>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    fromDate: { type: Date, required: true, index: true },
    toDate: { type: Date, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: Object.values(LEAVE_TYPE),
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(LEAVE_REQUEST_STATUS),
      default: LEAVE_REQUEST_STATUS.PENDING,
    },
    reason: { type: String, required: false, trim: true },
    approvedBy: { type: String, trim: true, required: false },
    approvedAt: { type: Date, required: false },
    rejectionReason: { type: String, trim: true, required: false },
    created_by: { type: String, trim: true, required: false },
    updated_by: { type: String, trim: true, required: false },
  },
  {
    timestamps: true,
    collection: "doctor_leaves",
  },
);

DoctorLeaveSchema.index({ doctorId: 1, fromDate: 1, toDate: 1 });
DoctorLeaveSchema.index({ status: 1, fromDate: 1 });

export const DoctorLeaveModel = model<IDoctorLeave>(
  "DoctorLeave",
  DoctorLeaveSchema,
);
