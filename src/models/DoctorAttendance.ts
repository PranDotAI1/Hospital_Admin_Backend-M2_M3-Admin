import { Document, Schema, model, Types } from "mongoose";
import { ATTENDANCE_STATUS } from "../utils/constant";

export type AttendanceStatusType =
  (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export interface IDoctorAttendance extends Document {
  doctorId: Types.ObjectId;
  date: Date; // calendar date (start of day in hospital TZ)
  checkIn?: Date;
  checkOut?: Date;
  status: AttendanceStatusType;
  totalMinutes?: number;
  remark?: string;
  created_by?: string;
  updated_by?: string;
}

const DoctorAttendanceSchema = new Schema<IDoctorAttendance>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    checkIn: { type: Date, required: false },
    checkOut: { type: Date, required: false },
    status: {
      type: String,
      required: true,
      enum: Object.values(ATTENDANCE_STATUS),
      default: ATTENDANCE_STATUS.PRESENT,
    },
    totalMinutes: { type: Number, required: false, min: 0 },
    remark: { type: String, required: false, trim: true },
    created_by: { type: String, trim: true, required: false },
    updated_by: { type: String, trim: true, required: false },
  },
  {
    timestamps: true,
    collection: "doctor_attendances",
  },
);

DoctorAttendanceSchema.index({ doctorId: 1, date: 1 }, { unique: true });
DoctorAttendanceSchema.index({ date: 1, status: 1 });

export const DoctorAttendanceModel = model<IDoctorAttendance>(
  "DoctorAttendance",
  DoctorAttendanceSchema,
);
