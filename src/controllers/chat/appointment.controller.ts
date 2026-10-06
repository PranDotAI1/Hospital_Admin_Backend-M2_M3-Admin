import { Request, Response } from "express";
import { Types } from "mongoose";
import crypto from "crypto";
import { AppointmentModel } from "../../models/Appointment";
import { DoctorModel } from "../../models/Doctor";
import { PatientModel } from "../../models/Patient";
import { DepartmentModel } from "../../models/Department";
import { UHIDCounterModel } from "../../models/UHIDCounter";
import { STATUS_CODE } from "../../utils/constant";
import { sendConfirmationEmail } from "./notification.controller";

const generateAppointmentNumber = async (dateStr: string): Promise<string> => {
  const cleanDate = dateStr.replace(/-/g, "");
  const counter = await UHIDCounterModel.findOneAndUpdate(
    { _id: `APT_${cleanDate}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  const seq = (counter?.seq || 1).toString().padStart(4, "0");
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `APT-${cleanDate}-${seq}-${rand}`;
};

export const bookAppointment = async (req: Request, res: Response) => {
  try {
    const {
      patientId,
      doctorId,
      departmentId,
      appointmentDate,
      slot,
      consultationFee,
      patientNotes,
      bookingChannel = "CHAT",
    } = req.body;

    const [patient, doctor] = await Promise.all([
      PatientModel.findById(patientId)
        .select("_id uhid name mobile email")
        .lean(),
      DoctorModel.findById(doctorId).lean(),
    ]);

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Patient profile not found",
      });
    }

    if (!doctor || doctor.isActive === false) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Doctor not found or currently unavailable",
      });
    }

    const resolvedDeptId = departmentId || doctor.department;
    if (!resolvedDeptId) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Department ID is required as doctor is not linked to a default department",
      });
    }

    const existingBooking = await AppointmentModel.findOne({
      doctorId: new Types.ObjectId(doctorId),
      appointmentDate,
      "slot.startTime": slot.startTime,
      status: { $in: ["BOOKED", "CONFIRMED", "RESCHEDULED"] },
    }).lean();

    if (existingBooking) {
      return res.status(409).json({
        status: "error",
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message: `The selected time slot (${slot.startTime} - ${slot.endTime}) has already been booked. Please choose another slot.`,
      });
    }

    const finalFee = consultationFee !== undefined ? consultationFee : doctor.consultationFee || 0;

    let newAppointment: any = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      const appointmentNumber = await generateAppointmentNumber(appointmentDate);
      try {
        newAppointment = await AppointmentModel.create({
          appointmentNumber,
          patientId: new Types.ObjectId(patientId),
          doctorId: new Types.ObjectId(doctorId),
          departmentId: new Types.ObjectId(resolvedDeptId),
          appointmentDate,
          slot: {
            startTime: slot.startTime,
            endTime: slot.endTime,
          },
          consultationFee: finalFee,
          status: "CONFIRMED",
          paymentStatus: "PENDING",
          bookingChannel,
          patientNotes: patientNotes || undefined,
        });
        break;
      } catch (err: any) {
        if (err.code === 11000) {
          const isSlotConflict =
            err.keyPattern?.doctorId ||
            err.keyPattern?.["slot.startTime"] ||
            err.message?.includes("slot.startTime");

          if (isSlotConflict) {
            return res.status(409).json({
              status: "error",
              success: false,
              code: "SLOT_ALREADY_BOOKED",
              message: "This slot was just booked by another patient. Please select a different slot.",
            });
          }

          if (attempts >= maxAttempts) {
            return res.status(409).json({
              status: "error",
              success: false,
              code: "APPOINTMENT_NUMBER_CONFLICT",
              message: "Conflict generating appointment reference. Please retry.",
            });
          }
          continue;
        }
        throw err;
      }
    }

    const populatedAppointment = await AppointmentModel.findById(newAppointment._id)
      .populate("doctorId", "firstName lastName specialization consultationFee")
      .populate("departmentId", "name description")
      .populate("patientId", "name uhid mobile email")
      .lean();

    if (populatedAppointment) {
      const p = populatedAppointment.patientId as any;
      const d = populatedAppointment.doctorId as any;
      const dept = populatedAppointment.departmentId as any;

      if (p?.email) {
        sendConfirmationEmail(p.email, {
          patientName: p.name,
          doctorName: `Dr. ${d?.firstName || ""} ${d?.lastName || ""}`.trim(),
          departmentName: dept?.name || "General Consultation",
          appointmentDate: populatedAppointment.appointmentDate,
          slotTime: `${populatedAppointment.slot.startTime} - ${populatedAppointment.slot.endTime}`,
          appointmentNumber: populatedAppointment.appointmentNumber,
          consultationFee: populatedAppointment.consultationFee,
        }).catch((err) => console.warn("[AUTO_EMAIL_DISPATCH_WARN]", err?.message || err));
      }
    }

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      success: true,
      message: "Appointment confirmed successfully",
      appointment: populatedAppointment,
    });
  } catch (error: any) {
    console.error("[CHAT_BOOK_APPOINTMENT_ERROR]", error?.message || error);

    if (error.code === 11000) {
      return res.status(409).json({
        status: "error",
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message: "This slot was just booked by another patient. Please select a different slot.",
      });
    }

    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to book appointment" : error.message,
    });
  }
};

export const getAppointments = async (req: Request, res: Response) => {
  try {
    const patientParam = (req.query.patient_id as string) || (req.query.patientId as string);
    const statusParam = req.query.status as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    if (!patientParam) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "patient_id query parameter is required",
      });
    }

    let targetPatientId: Types.ObjectId | null = null;

    if (Types.ObjectId.isValid(patientParam)) {
      targetPatientId = new Types.ObjectId(patientParam);
    } else {
      const patientDoc = await PatientModel.findOne({
        uhid: patientParam.trim(),
        isMerged: { $ne: true },
      }).select("_id");
      if (patientDoc) {
        targetPatientId = patientDoc._id as Types.ObjectId;
      }
    }

    if (!targetPatientId) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Patient not found with the provided identifier",
      });
    }

    const filter: Record<string, any> = { patientId: targetPatientId };

    const todayStr = new Date().toISOString().slice(0, 10);

    if (statusParam) {
      const s = statusParam.toLowerCase().trim();
      if (s === "upcoming") {
        filter.appointmentDate = { $gte: todayStr };
        filter.status = { $in: ["BOOKED", "CONFIRMED", "RESCHEDULED"] };
      } else if (s === "past") {
        filter.$or = [
          { appointmentDate: { $lt: todayStr } },
          { status: { $in: ["COMPLETED", "CANCELLED"] } },
        ];
      } else {
        filter.status = statusParam.toUpperCase();
      }
    }

    const [appointments, total] = await Promise.all([
      AppointmentModel.find(filter)
        .populate("doctorId", "firstName lastName specialization consultationFee")
        .populate("departmentId", "name description")
        .populate("patientId", "name uhid mobile")
        .sort({ appointmentDate: -1, "slot.startTime": -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      AppointmentModel.countDocuments(filter),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Appointments retrieved successfully",
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: appointments,
    });
  } catch (error: any) {
    console.error("[CHAT_GET_APPOINTMENTS_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to retrieve appointments" : error.message,
    });
  }
};

export const rescheduleAppointment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { newDate, newSlot, reason } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const appointment = await AppointmentModel.findById(id);
    if (!appointment) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status === "CANCELLED") {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Cannot reschedule an already cancelled appointment. Please book a new appointment.",
      });
    }

    if (appointment.status === "COMPLETED") {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Cannot reschedule a completed appointment",
      });
    }

    const slotConflict = await AppointmentModel.findOne({
      _id: { $ne: appointment._id },
      doctorId: appointment.doctorId,
      appointmentDate: newDate,
      "slot.startTime": newSlot.startTime,
      status: { $in: ["BOOKED", "CONFIRMED", "RESCHEDULED"] },
    }).lean();

    if (slotConflict) {
      return res.status(409).json({
        status: "error",
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message: `The target slot (${newSlot.startTime} - ${newSlot.endTime}) on ${newDate} is already booked. Please choose a different slot.`,
      });
    }

    const previousDate = appointment.appointmentDate;
    const previousSlot = `${appointment.slot.startTime} - ${appointment.slot.endTime}`;

    appointment.appointmentDate = newDate;
    appointment.slot = {
      startTime: newSlot.startTime,
      endTime: newSlot.endTime,
    };
    appointment.status = "RESCHEDULED";
    appointment.patientNotes = `[Rescheduled from ${previousDate} (${previousSlot})${reason ? `: ${reason}` : ""}] ${appointment.patientNotes || ""}`.trim();

    await appointment.save();

    const updated = await AppointmentModel.findById(appointment._id)
      .populate("doctorId", "firstName lastName specialization consultationFee")
      .populate("departmentId", "name description")
      .populate("patientId", "name uhid mobile email")
      .lean();

    if (updated) {
      const p = updated.patientId as any;
      const d = updated.doctorId as any;
      const dept = updated.departmentId as any;

      if (p?.email) {
        sendConfirmationEmail(
          p.email,
          {
            patientName: p.name,
            doctorName: `Dr. ${d?.firstName || ""} ${d?.lastName || ""}`.trim(),
            departmentName: dept?.name || "General Consultation",
            appointmentDate: updated.appointmentDate,
            slotTime: `${updated.slot.startTime} - ${updated.slot.endTime}`,
            appointmentNumber: updated.appointmentNumber,
            consultationFee: updated.consultationFee,
          },
          `Appointment Rescheduled - ${updated.appointmentNumber}`,
        ).catch((err) => console.warn("[AUTO_EMAIL_RESCHEDULE_WARN]", err?.message || err));
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Appointment rescheduled successfully",
      appointment: updated,
    });
  } catch (error: any) {
    console.error("[CHAT_RESCHEDULE_APPOINTMENT_ERROR]", error?.message || error);
    if (error.code === 11000) {
      return res.status(409).json({
        status: "error",
        success: false,
        code: "SLOT_ALREADY_BOOKED",
        message: "The requested slot is already taken. Please choose another.",
      });
    }
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to reschedule appointment" : error.message,
    });
  }
};

export const cancelAppointment = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { cancellationReason } = req.body || {};

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid appointment ID format",
      });
    }

    const appointment = await AppointmentModel.findById(id);
    if (!appointment) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Appointment not found",
      });
    }

    if (appointment.status === "CANCELLED") {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        success: true,
        message: "Appointment is already cancelled",
      });
    }

    appointment.status = "CANCELLED";
    appointment.cancelledAt = new Date();
    if (cancellationReason) {
      appointment.cancellationReason = String(cancellationReason).trim();
    }

    await appointment.save();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Appointment cancelled successfully. The slot has been released.",
      appointmentId: appointment._id,
      appointmentNumber: appointment.appointmentNumber,
    });
  } catch (error: any) {
    console.error("[CHAT_CANCEL_APPOINTMENT_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to cancel appointment" : error.message,
    });
  }
};
