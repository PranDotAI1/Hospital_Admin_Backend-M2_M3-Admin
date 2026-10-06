import { Request, Response } from "express";
import { Types } from "mongoose";
import { DoctorModel } from "../../models/Doctor";
import { DepartmentModel } from "../../models/Department";
import { AppointmentModel } from "../../models/Appointment";
import { STATUS_CODE } from "../../utils/constant";
import { escapeRegex } from "../../utils/sanitizer";

const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const clean = timeStr.trim().toUpperCase();
  const isPM = clean.includes("PM");
  const isAM = clean.includes("AM");
  const parts = clean.replace(/(AM|PM)/g, "").trim().split(":");
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1] ? parseInt(parts[1], 10) : 0;

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

const minutesToHHmm = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const getDoctors = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 30));
    const offset = (page - 1) * limit;

    const { department, name, language, specialization } = req.query;

    const filter: Record<string, any> = { isActive: true };

    if (department) {
      const deptStr = String(department).trim();
      if (Types.ObjectId.isValid(deptStr)) {
        filter.department = new Types.ObjectId(deptStr);
      } else {
        const matchingDept = await DepartmentModel.findOne({
          name: { $regex: new RegExp(`^${escapeRegex(deptStr)}$`, "i") },
        }).select("_id");
        if (matchingDept) {
          filter.department = matchingDept._id;
        } else {
          return res.status(STATUS_CODE.SUCCESS).json({
            status: "success",
            success: true,
            data: [],
            total: 0,
            page,
            limit,
          });
        }
      }
    }

    if (name) {
      const escapedName = escapeRegex(String(name).trim());
      filter.$or = [
        { firstName: { $regex: escapedName, $options: "i" } },
        { lastName: { $regex: escapedName, $options: "i" } },
      ];
    }

    if (specialization) {
      filter.specialization = {
        $regex: escapeRegex(String(specialization).trim()),
        $options: "i",
      };
    }

    if (language) {
      const escapedLang = escapeRegex(String(language).trim());
      filter.$or = [
        ...(filter.$or || []),
        { languages: { $regex: escapedLang, $options: "i" } },
      ];
    }

    const [doctors, total] = await Promise.all([
      DoctorModel.find(filter)
        .select("_id firstName lastName specialization consultationFee department languages availableSlots isActive")
        .populate("department", "name description department_id")
        .sort({ firstName: 1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      DoctorModel.countDocuments(filter),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Doctors retrieved successfully",
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      data: doctors,
    });
  } catch (error: any) {
    console.error("[CHAT_DOCTORS_LIST_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to retrieve doctors" : error.message,
    });
  }
};

export const getDoctorById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid doctor ID format",
      });
    }

    const doctor = await DoctorModel.findById(id)
      .populate("department", "name description department_id")
      .lean();

    if (!doctor || doctor.isActive === false) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Doctor not found or inactive",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Doctor profile retrieved successfully",
      data: doctor,
    });
  } catch (error: any) {
    console.error("[CHAT_DOCTOR_GET_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to retrieve doctor profile" : error.message,
    });
  }
};

export const getDoctorSlots = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const dateStr = req.query.date as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid doctor ID format",
      });
    }

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Valid query parameter 'date' in YYYY-MM-DD format is required",
      });
    }

    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    if (isNaN(targetDate.getTime())) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid date value provided",
      });
    }

    const [year, month, day] = dateStr.split("-").map(Number);
    const localTargetDate = new Date(year, month - 1, day);
    const dayOfWeek = DAY_NAMES[localTargetDate.getDay()];

    const doctor = await DoctorModel.findById(id).lean();
    if (!doctor || doctor.isActive === false) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        success: false,
        message: "Doctor not found or inactive",
      });
    }

    const daySchedules = ((doctor as any).availableSlots || []).filter((s: any) => {
      const d = s.day?.trim().toLowerCase();
      return d === dayOfWeek.toLowerCase() || d === dayOfWeek.slice(0, 3).toLowerCase();
    });

    if (daySchedules.length === 0) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        success: true,
        data: {
          doctorId: doctor._id,
          doctorName: `${doctor.firstName} ${doctor.lastName}`,
          date: dateStr,
          day: dayOfWeek,
          availableSlots: [],
          message: `Dr. ${doctor.firstName} ${doctor.lastName} is not scheduled for consultations on ${dayOfWeek}s`,
        },
      });
    }

    const bookedAppointments = await AppointmentModel.find({
      doctorId: new Types.ObjectId(id),
      appointmentDate: dateStr,
      status: { $in: ["BOOKED", "CONFIRMED", "RESCHEDULED"] },
    })
      .select("slot.startTime slot.endTime")
      .lean();

    const bookedStartTimes = new Set(
      bookedAppointments.map((appt) => appt.slot?.startTime),
    );

    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffsetMs);
    const todayISTStr = istNow.toISOString().slice(0, 10);
    const isToday = dateStr === todayISTStr;
    const currentMinutesIST = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

    const slotDurationMinutes = 30;
    const emptySlots: { startTime: string; endTime: string }[] = [];

    for (const schedule of daySchedules) {
      const scheduleStart = parseTimeToMinutes(schedule.startTime);
      const scheduleEnd = parseTimeToMinutes(schedule.endTime);

      let currentSlotStart = scheduleStart;
      while (currentSlotStart + slotDurationMinutes <= scheduleEnd) {
        const currentSlotEnd = currentSlotStart + slotDurationMinutes;
        const startTimeStr = minutesToHHmm(currentSlotStart);
        const endTimeStr = minutesToHHmm(currentSlotEnd);

        const isAlreadyBooked = bookedStartTimes.has(startTimeStr);
        const hasPassedToday = isToday && currentSlotStart <= currentMinutesIST;

        if (!isAlreadyBooked && !hasPassedToday) {
          emptySlots.push({
            startTime: startTimeStr,
            endTime: endTimeStr,
          });
        }

        currentSlotStart += slotDurationMinutes;
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      data: {
        doctorId: doctor._id,
        doctorName: `${doctor.firstName} ${doctor.lastName}`,
        specialization: doctor.specialization,
        consultationFee: doctor.consultationFee,
        date: dateStr,
        day: dayOfWeek,
        slotDurationMinutes,
        totalSlotsAvailable: emptySlots.length,
        availableSlots: emptySlots,
      },
    });
  } catch (error: any) {
    console.error("[CHAT_DOCTOR_SLOTS_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to calculate doctor slots" : error.message,
    });
  }
};
