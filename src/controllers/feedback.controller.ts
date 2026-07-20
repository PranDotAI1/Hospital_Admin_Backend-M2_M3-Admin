import { Request, Response } from "express";
import { Types } from "mongoose";
import { PatientFeedbackModel } from "../models/PatientFeedback";
import { ScanShareVisitModel } from "../models/ScanShareVisit";
import { successResponse, errorResponse, successListResponse, buildPaginationMeta } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { invalidateEndpoint } from "../utils/analytics.cache";
import { parseTableParams } from "../utils/analytics.helpers";

const CTRL = "[feedback]";

export const submitFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { visitId, score, npsScore, comments, submittedBy } = req.body;

    if (!visitId || !score) {
      return errorResponse(res, "visitId and score are required", STATUS_CODE.BAD_REQUEST);
    }
    if (![1, 2, 3, 4, 5].includes(Number(score))) {
      return errorResponse(res, "score must be between 1 and 5", STATUS_CODE.BAD_REQUEST);
    }
    if (!Types.ObjectId.isValid(visitId)) {
      return errorResponse(res, "Invalid visitId", STATUS_CODE.BAD_REQUEST);
    }

    const visit = await ScanShareVisitModel.findById(visitId).lean();
    if (!visit) {
      return errorResponse(res, "Visit not found", STATUS_CODE.NOT_FOUND);
    }
    const existing = await PatientFeedbackModel.findOne({ visitId: new Types.ObjectId(visitId) });
    if (existing) {
      return errorResponse(res, "Feedback already submitted for this visit", STATUS_CODE.CONFLICT ?? 409);
    }

    const feedback = await PatientFeedbackModel.create({
      visitId:     new Types.ObjectId(visitId),
      patientId:   visit.patientId,
      doctorId:    visit.doctorId,
      hospitalId:  req.body.hospitalId || (req as any).user?.hospitalId,
      score:       Number(score),
      npsScore:    npsScore ? Number(npsScore) : undefined,
      comments:    comments?.trim(),
      submittedBy: submittedBy || "PATIENT",
      submittedAt: new Date(),
    });

    const hospitalId = feedback.hospitalId?.toString();
    if (hospitalId) {
      await invalidateEndpoint(hospitalId, "patient-satisfaction");
    }

    return successResponse(res, { feedbackId: feedback._id }, "Feedback submitted successfully", 201);
  } catch (error: any) {
    if (error.code === 11000) {
      return errorResponse(res, "Feedback already submitted for this visit", 409);
    }
    console.error(`${CTRL} submitFeedback error:`, error);
    return errorResponse(res, error.message || "Failed to submit feedback", STATUS_CODE.ERROR);
  }
};

export const listFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseTableParams(req.query as Record<string, unknown>);
    const hospitalId = (req as any).user?.hospitalId;

    const match: Record<string, unknown> = {};
    if (hospitalId) match.hospitalId = new Types.ObjectId(hospitalId);
    if (req.query.from || req.query.to) {
      match.submittedAt = {
        ...(req.query.from ? { $gte: new Date(req.query.from as string) } : {}),
        ...(req.query.to ? { $lte: new Date(req.query.to as string) } : {}),
      };
    }
    if (req.query.score) match.score = Number(req.query.score as string);
    if (req.query.doctorId && Types.ObjectId.isValid(req.query.doctorId as string)) {
      match.doctorId = new Types.ObjectId(req.query.doctorId as string);
    }

    const [data, total] = await Promise.all([
      PatientFeedbackModel.find(match)
        .sort({ submittedAt: -1 })
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .populate("patientId", "f_name l_name mobile")
        .populate("doctorId", "firstName lastName")
        .lean(),
      PatientFeedbackModel.countDocuments(match),
    ]);

    return successListResponse(res, data, buildPaginationMeta(total, params.page, params.limit));
  } catch (error: any) {
    console.error(`${CTRL} listFeedback error:`, error);
    return errorResponse(res, error.message || "Failed to list feedback", STATUS_CODE.ERROR);
  }
};

export const getFeedbackByVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    const visitId = String(req.params.visitId);
    if (!Types.ObjectId.isValid(visitId)) {
      return errorResponse(res, "Invalid visitId", STATUS_CODE.BAD_REQUEST);
    }

    const feedback = await PatientFeedbackModel.findOne({
      visitId: new Types.ObjectId(visitId),
    }).lean();

    if (!feedback) {
      return errorResponse(res, "No feedback found for this visit", STATUS_CODE.NOT_FOUND);
    }

    return successResponse(res, feedback);
  } catch (error: any) {
    console.error(`${CTRL} getFeedbackByVisit error:`, error);
    return errorResponse(res, error.message || "Failed to get feedback", STATUS_CODE.ERROR);
  }
};
