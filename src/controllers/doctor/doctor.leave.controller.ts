import { Request, Response } from "express";
import { Types } from "mongoose";
import { DoctorLeaveModel } from "../../models/DoctorLeave";
import { DoctorModel } from "../../models/Doctor";
import {
  successResponse,
  errorResponse,
  successListResponse,
  buildPaginationMeta,
} from "../../utils/common";
import {
  STATUS_CODE,
  LEAVE_TYPE,
  LEAVE_REQUEST_STATUS,
} from "../../utils/constant";

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const getParamId = (req: Request): string =>
  Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");

const getParamLeaveId = (req: Request): string =>
  Array.isArray(req.params.leaveId) ? (req.params.leaveId[0] ?? "") : (req.params.leaveId ?? "");

/** POST /doctors/:id/leave - Apply for leave */
export const createLeave = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const body = req.body as {
      fromDate?: string;
      toDate?: string;
      type?: string;
      reason?: string;
    };

    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const fromDate = body.fromDate ? new Date(body.fromDate) : null;
    const toDate = body.toDate ? new Date(body.toDate) : null;
    const type = (body.type || "").toUpperCase();
    const reason = body.reason?.trim();

    if (!fromDate || isNaN(fromDate.getTime())) {
      return errorResponse(res, "Valid fromDate is required", STATUS_CODE.BAD_REQUEST);
    }
    if (!toDate || isNaN(toDate.getTime())) {
      return errorResponse(res, "Valid toDate is required", STATUS_CODE.BAD_REQUEST);
    }
    if (fromDate > toDate) {
      return errorResponse(res, "fromDate must be before or equal to toDate", STATUS_CODE.BAD_REQUEST);
    }
    if (!Object.values(LEAVE_TYPE).includes(type as any)) {
      return errorResponse(res, "type must be ANNUAL, SICK, or OTHER", STATUS_CODE.BAD_REQUEST);
    }

    const doc = await DoctorLeaveModel.create({
      doctorId: new Types.ObjectId(id),
      fromDate,
      toDate,
      type,
      status: LEAVE_REQUEST_STATUS.PENDING,
      reason: reason || undefined,
      created_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
    });

    return successResponse(
      res,
      {
        id: doc._id,
        fromDate: doc.fromDate,
        toDate: doc.toDate,
        type: doc.type,
        status: doc.status,
      },
      "Leave request submitted",
      STATUS_CODE.CREATED
    );
  } catch (error: any) {
    console.error("createLeave error:", error);
    return errorResponse(res, error.message || "Failed to create leave request", STATUS_CODE.ERROR);
  }
};

/** GET /doctors/:id/leave - List leave requests */
export const listLeave = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 20));

    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const match: Record<string, unknown> = { doctorId: new Types.ObjectId(id) };
    if (status && Object.values(LEAVE_REQUEST_STATUS).includes(status as any)) {
      match.status = status;
    }

    const skip = (page - 1) * limit;
    const [list, total] = await Promise.all([
      DoctorLeaveModel.find(match).sort({ fromDate: -1 }).skip(skip).limit(limit).lean(),
      DoctorLeaveModel.countDocuments(match),
    ]);

    return successListResponse(res, list, buildPaginationMeta(total, page, limit));
  } catch (error: any) {
    console.error("listLeave error:", error);
    return errorResponse(res, error.message || "Failed to list leave", STATUS_CODE.ERROR);
  }
};

/** PATCH /doctors/:id/leave/:leaveId - Approve or reject (admin) */
export const updateLeaveStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const leaveId = getParamLeaveId(req);
    const body = req.body as { status?: string; rejectionReason?: string };

    if (!id || !isValidObjectId(id) || !leaveId || !isValidObjectId(leaveId)) {
      return errorResponse(res, "Valid doctor id and leaveId are required", STATUS_CODE.BAD_REQUEST);
    }

    const newStatus = (body.status || "").toUpperCase();
    if (
      newStatus !== LEAVE_REQUEST_STATUS.APPROVED &&
      newStatus !== LEAVE_REQUEST_STATUS.REJECTED
    ) {
      return errorResponse(res, "status must be APPROVED or REJECTED", STATUS_CODE.BAD_REQUEST);
    }

    const leave = await DoctorLeaveModel.findOne({
      _id: new Types.ObjectId(leaveId),
      doctorId: new Types.ObjectId(id),
      status: LEAVE_REQUEST_STATUS.PENDING,
    });

    if (!leave) {
      return errorResponse(res, "Leave request not found or already processed", STATUS_CODE.NOT_FOUND);
    }

    const update: Record<string, unknown> = {
      status: newStatus,
      approvedBy: (req as any).user?.id || (req as any).user?._id?.toString?.(),
      approvedAt: new Date(),
      updated_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
    };
    if (newStatus === LEAVE_REQUEST_STATUS.REJECTED && body.rejectionReason) {
      update.rejectionReason = String(body.rejectionReason).trim();
    }

    await DoctorLeaveModel.findByIdAndUpdate(leave._id, { $set: update });

    return successResponse(res, { id: leave._id, status: newStatus }, `Leave ${newStatus.toLowerCase()}`);
  } catch (error: any) {
    console.error("updateLeaveStatus error:", error);
    return errorResponse(res, error.message || "Failed to update leave", STATUS_CODE.ERROR);
  }
};

/** GET /doctors/:id/leave/stats - Leave stats (approved days by type) */
export const leaveStats = async (req: Request, res: Response): Promise<void> => {
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

    let start = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    let end = to ? new Date(to) : new Date();
    if (isNaN(start.getTime())) start = new Date(new Date().getFullYear(), 0, 1);
    if (isNaN(end.getTime())) end = new Date();

    const stats = await DoctorLeaveModel.aggregate([
      {
        $match: {
          doctorId: new Types.ObjectId(id),
          status: LEAVE_REQUEST_STATUS.APPROVED,
          $or: [
            { fromDate: { $gte: start, $lte: end } },
            { toDate: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $addFields: {
          daysInThisLeave: {
            $add: [
              1,
              { $floor: { $divide: [{ $subtract: ["$toDate", "$fromDate"] }, 86400000] } },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$type",
          totalDays: { $sum: "$daysInThisLeave" },
          count: { $sum: 1 },
        },
      },
    ]);

    const annual = stats.find((s) => s._id === LEAVE_TYPE.ANNUAL);
    const sick = stats.find((s) => s._id === LEAVE_TYPE.SICK);
    const other = stats.find((s) => s._id === LEAVE_TYPE.OTHER);

    return successResponse(res, {
      from: start,
      to: end,
      annualDays: Math.round(annual?.totalDays ?? 0),
      sickDays: Math.round(sick?.totalDays ?? 0),
      otherDays: Math.round(other?.totalDays ?? 0),
      totalLeaveDays:
        Math.round(annual?.totalDays ?? 0) +
        Math.round(sick?.totalDays ?? 0) +
        Math.round(other?.totalDays ?? 0),
    });
  } catch (error: any) {
    console.error("leaveStats error:", error);
    return errorResponse(res, error.message || "Failed to get leave stats", STATUS_CODE.ERROR);
  }
};
