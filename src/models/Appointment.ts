import { Schema, model, Document, Types } from "mongoose";

export interface IAppointmentSlot {
  startTime: string;
  endTime: string;
}

export type AppointmentStatus =
  | "BOOKED"
  | "CONFIRMED"
  | "RESCHEDULED"
  | "CANCELLED"
  | "COMPLETED";

export type PaymentStatus = "PENDING" | "PAID" | "EXEMPT";

export interface IAppointment extends Document {
  appointmentNumber: string;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  departmentId: Types.ObjectId;
  appointmentDate: string;
  slot: IAppointmentSlot;
  consultationFee?: number;
  status: AppointmentStatus;
  paymentStatus: PaymentStatus;
  bookingChannel: "CHAT" | "PORTAL" | "ADMIN";
  patientNotes?: string;
  cancellationReason?: string;
  cancelledAt?: Date;
  rescheduledFrom?: Types.ObjectId;
  rescheduledTo?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    appointmentNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },
    appointmentDate: {
      type: String,
      required: true,
      trim: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    slot: {
      startTime: { type: String, required: true, trim: true },
      endTime: { type: String, required: true, trim: true },
    },
    consultationFee: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["BOOKED", "CONFIRMED", "RESCHEDULED", "CANCELLED", "COMPLETED"],
      default: "CONFIRMED",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "EXEMPT"],
      default: "PENDING",
    },
    bookingChannel: {
      type: String,
      enum: ["CHAT", "PORTAL", "ADMIN"],
      default: "CHAT",
    },
    patientNotes: {
      type: String,
      trim: true,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
    cancelledAt: {
      type: Date,
    },
    rescheduledFrom: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    rescheduledTo: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
  },
  {
    timestamps: true,
    collection: "appointments",
  },
);

AppointmentSchema.index(
  {
    doctorId: 1,
    appointmentDate: 1,
    "slot.startTime": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["BOOKED", "CONFIRMED", "RESCHEDULED"] },
    },
  },
);

AppointmentSchema.index({ patientId: 1, appointmentDate: -1, "slot.startTime": -1 });

export const AppointmentModel = model<IAppointment>(
  "Appointment",
  AppointmentSchema,
);
