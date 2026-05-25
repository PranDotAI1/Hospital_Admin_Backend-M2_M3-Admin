import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import { DoctorModel } from "../../models/Doctor";
import {
  successResponse,
  errorResponse,
  successListResponse,
  buildPaginationMeta,
} from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const getParamId = (req: Request): string =>
  Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");

/** GET /doctors/:id/patients - Patients the doctor has looked (OPD visits with doctorId) */
export const listPatientsLooked = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    const from = req.query.from as string;
    const to = req.query.to as string;
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 20));
    const status = req.query.status as string | undefined;

    if (!id || !isValidObjectId(id)) {
      return errorResponse(res, "Valid doctor id is required", STATUS_CODE.BAD_REQUEST);
    }

    const doctor = await DoctorModel.findById(id).select("_id");
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const start = from ? new Date(from) : new Date(0);
    const end = to ? new Date(to) : new Date();
    if (isNaN(start.getTime())) {
      return errorResponse(res, "Invalid from date", STATUS_CODE.BAD_REQUEST);
    }
    if (isNaN(end.getTime())) {
      return errorResponse(res, "Invalid to date", STATUS_CODE.BAD_REQUEST);
    }

    const match: Record<string, unknown> = {
      doctorId: new Types.ObjectId(id),
      visitDate: { $gte: start, $lte: end },
    };
    if (status && Object.values(ScanShareVisitStatus).includes(status as ScanShareVisitStatus)) {
      match.visitStatus = status;
    }

    const skip = (page - 1) * limit;
    const [list, total] = await Promise.all([
      ScanShareVisitModel.find(match)
        .sort({ visitDate: -1 })
        .skip(skip)
        .limit(limit)
        .select("tokenNumber visitDate visitStatus name mobile complaint department doctorName consultationFee")
        .lean(),
      ScanShareVisitModel.countDocuments(match),
    ]);

    return successListResponse(res, list, buildPaginationMeta(total, page, limit));
  } catch (error: any) {
    console.error("listPatientsLooked error:", error);
    return errorResponse(res, error.message || "Failed to list patients", STATUS_CODE.ERROR);
  }
};

/** GET /doctors/:id/patients/stats - Count of patients looked (optionally by period) */
export const patientsLookedStats = async (req: Request, res: Response): Promise<void> => {
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

    const start = from ? new Date(from) : new Date(0);
    const end = to ? new Date(to) : new Date();
    if (isNaN(start.getTime())) {
      return errorResponse(res, "Invalid from date", STATUS_CODE.BAD_REQUEST);
    }
    if (isNaN(end.getTime())) {
      return errorResponse(res, "Invalid to date", STATUS_CODE.BAD_REQUEST);
    }

    const [totalCount, completedCount] = await Promise.all([
      ScanShareVisitModel.countDocuments({
        doctorId: new Types.ObjectId(id),
        visitDate: { $gte: start, $lte: end },
      }),
      ScanShareVisitModel.countDocuments({
        doctorId: new Types.ObjectId(id),
        visitDate: { $gte: start, $lte: end },
        visitStatus: ScanShareVisitStatus.COMPLETED,
      }),
    ]);

    return successResponse(res, {
      from: start,
      to: end,
      totalVisits: totalCount,
      completedVisits: completedCount,
    });
  } catch (error: any) {
    console.error("patientsLookedStats error:", error);
    return errorResponse(res, error.message || "Failed to get patient stats", STATUS_CODE.ERROR);
  }
};
