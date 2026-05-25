import { Request, Response } from "express";
import { Types } from "mongoose";
import { DoctorAttendanceModel } from "../../models/DoctorAttendance";
import { DoctorModel } from "../../models/Doctor";
import {
  successResponse,
  errorResponse,
  successListResponse,
  buildPaginationMeta,
} from "../../utils/common";
import { STATUS_CODE, ATTENDANCE_STATUS } from "../../utils/constant";

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const getParamId = (req: Request): string =>
  Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

/** POST /doctors/:id/attendance/check-in - Record check-in (creates/updates today's attendance) */
export const checkIn = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const now = new Date();
    const date = startOfDay(now);

    let att = await DoctorAttendanceModel.findOne({
      doctorId: new Types.ObjectId(id),
      date,
    });

    if (att) {
      if (att.checkIn) {
        return errorResponse(res, "Already checked in today", STATUS_CODE.CONFLICT);
      }
      att.checkIn = now;
      att.status = ATTENDANCE_STATUS.PRESENT;
      att.updated_by = (req as any).user?.id || (req as any).user?._id?.toString?.();
      await att.save();
    } else {
      att = await DoctorAttendanceModel.create({
        doctorId: new Types.ObjectId(id),
        date,
        checkIn: now,
        status: ATTENDANCE_STATUS.PRESENT,
        created_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
      });
    }

    return successResponse(
      res,
      {
        id: att._id,
        date: att.date,
        checkIn: att.checkIn,
        status: att.status,
      },
      "Checked in",
      STATUS_CODE.CREATED
    );
  } catch (error: any) {
    console.error("checkIn error:", error);
    return errorResponse(res, error.message || "Check-in failed", STATUS_CODE.ERROR);
  }
};

/** POST /doctors/:id/attendance/check-out - Record check-out, set totalMinutes */
export const checkOut = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const now = new Date();
    const date = startOfDay(now);

    const att = await DoctorAttendanceModel.findOne({
      doctorId: new Types.ObjectId(id),
      date,
    });

    if (!att) {
      return errorResponse(res, "No check-in found for today", STATUS_CODE.NOT_FOUND);
    }
    if (!att.checkIn) {
      return errorResponse(res, "Check-in time missing", STATUS_CODE.BAD_REQUEST);
    }
    if (att.checkOut) {
      return errorResponse(res, "Already checked out today", STATUS_CODE.CONFLICT);
    }

    att.checkOut = now;
    att.totalMinutes = Math.round((now.getTime() - (att.checkIn as Date).getTime()) / 60000);
    att.updated_by = (req as any).user?.id || (req as any).user?._id?.toString?.();
    await att.save();

    return successResponse(
      res,
      {
        id: att._id,
        date: att.date,
        checkIn: att.checkIn,
        checkOut: att.checkOut,
        totalMinutes: att.totalMinutes,
        status: att.status,
      },
      "Checked out"
    );
  } catch (error: any) {
    console.error("checkOut error:", error);
    return errorResponse(res, error.message || "Check-out failed", STATUS_CODE.ERROR);
  }
};

/** GET /doctors/:id/attendance - List attendance for date range */
export const listAttendance = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const from = req.query.from as string;
    const to = req.query.to as string;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 20));

    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    let start = startOfDay(new Date());
    let end = endOfDay(new Date());
    if (from) {
      const f = new Date(from);
      if (!isNaN(f.getTime())) start = startOfDay(f);
    }
    if (to) {
      const t = new Date(to);
      if (!isNaN(t.getTime())) end = endOfDay(t);
    }
    if (start > end) {
      return errorResponse(res, "from must be before to", STATUS_CODE.BAD_REQUEST);
    }

    const skip = (page - 1) * limit;
    const [list, total] = await Promise.all([
      DoctorAttendanceModel.find({
        doctorId: new Types.ObjectId(id),
        date: { $gte: start, $lte: end },
      })
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DoctorAttendanceModel.countDocuments({
        doctorId: new Types.ObjectId(id),
        date: { $gte: start, $lte: end },
      }),
    ]);

    return successListResponse(res, list, buildPaginationMeta(total, page, limit));
  } catch (error: any) {
    console.error("listAttendance error:", error);
    return errorResponse(res, error.message || "Failed to list attendance", STATUS_CODE.ERROR);
  }
};

/** GET /doctors/:id/attendance/stats - Leave stats, present days, etc. */
export const attendanceStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const from = req.query.from as string;
    const to = req.query.to as string;

    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    let start = startOfDay(new Date());
    let end = endOfDay(new Date());
    if (from) {
      const f = new Date(from);
      if (!isNaN(f.getTime())) start = startOfDay(f);
    }
    if (to) {
      const t = new Date(to);
      if (!isNaN(t.getTime())) end = endOfDay(t);
    }

    const stats = await DoctorAttendanceModel.aggregate([
      {
        $match: {
          doctorId: new Types.ObjectId(id),
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalMinutes: { $sum: { $ifNull: ["$totalMinutes", 0] } },
        },
      },
    ]);

    const present = stats.find((s) => s._id === ATTENDANCE_STATUS.PRESENT);
    const absent = stats.find((s) => s._id === ATTENDANCE_STATUS.ABSENT);
    const halfDay = stats.find((s) => s._id === ATTENDANCE_STATUS.HALF_DAY);
    const leave = stats.find((s) => s._id === ATTENDANCE_STATUS.LEAVE);
    const off = stats.find((s) => s._id === ATTENDANCE_STATUS.OFF);

    return successResponse(res, {
      from: start,
      to: end,
      presentDays: present?.count ?? 0,
      absentDays: absent?.count ?? 0,
      halfDayDays: halfDay?.count ?? 0,
      leaveDays: leave?.count ?? 0,
      offDays: off?.count ?? 0,
      totalWorkMinutes: (present?.totalMinutes ?? 0) + (halfDay?.totalMinutes ?? 0),
    });
  } catch (error: any) {
    console.error("attendanceStats error:", error);
    return errorResponse(res, error.message || "Failed to get attendance stats", STATUS_CODE.ERROR);
  }
};
