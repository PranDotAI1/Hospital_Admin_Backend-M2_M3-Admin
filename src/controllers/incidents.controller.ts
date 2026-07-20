import { Request, Response } from "express";
import { Types } from "mongoose";
import { IncidentReportModel } from "../models/IncidentReport";
import { successResponse, errorResponse, successListResponse, buildPaginationMeta } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { invalidateEndpoint } from "../utils/analytics.cache";
import { parseTableParams } from "../utils/analytics.helpers";

const CTRL = "[incidents]";

const VALID_TYPES = [
  "CUTS_AND_PUNCTURES", "MULTIPLE_TRAUMA", "FRACTURES", "BRUISES",
  "SORENESS_PAIN", "SPRAINS_AND_STRAINS", "MEDICATION_ERROR", "COMPLAINT",
  "SURGICAL_SITE_INFECTION", "VAP", "BLOODSTREAM_INFECTION", "C_DIFF_INFECTION",
];

const VALID_SEVERITIES = ["MINOR", "MODERATE", "MAJOR", "CRITICAL"];

export const reportIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, description, severity, patientId, visitId, doctorId, wardLocation } = req.body;

    if (!type || !VALID_TYPES.includes(type)) {
      return errorResponse(res, `type is required. Valid types: ${VALID_TYPES.join(", ")}`, STATUS_CODE.BAD_REQUEST);
    }
    if (!description?.trim()) {
      return errorResponse(res, "description is required", STATUS_CODE.BAD_REQUEST);
    }
    if (severity && !VALID_SEVERITIES.includes(severity)) {
      return errorResponse(res, `severity must be one of: ${VALID_SEVERITIES.join(", ")}`, STATUS_CODE.BAD_REQUEST);
    }

    const reportedBy = (req as any).user?._id || (req as any).user?.id;
    const hospitalId = (req as any).user?.hospitalId;
    if (!reportedBy) {
      return errorResponse(res, "Authentication required", STATUS_CODE.UNAUTHORIZED ?? 401);
    }

    const incident = await IncidentReportModel.create({
      type,
      description: description.trim(),
      severity: severity || "MINOR",
      patientId: patientId && Types.ObjectId.isValid(patientId) ? new Types.ObjectId(patientId) : undefined,
      visitId:   visitId && Types.ObjectId.isValid(visitId) ? new Types.ObjectId(visitId) : undefined,
      doctorId:  doctorId && Types.ObjectId.isValid(doctorId) ? new Types.ObjectId(doctorId) : undefined,
      reportedBy: new Types.ObjectId(reportedBy),
      reportedAt: new Date(),
      hospitalId: hospitalId ? new Types.ObjectId(hospitalId.toString()) : undefined,
      wardLocation: wardLocation?.trim(),
      isResolved: false,
    });

    const hospId = hospitalId?.toString();
    await Promise.all([
      invalidateEndpoint(hospId, "dashboard-infection-rates"),
      invalidateEndpoint(hospId, "dashboard-incident-reporting"),
      invalidateEndpoint(hospId, "dashboard-patient-safety"),
    ]);

    return successResponse(res, { incidentId: incident._id }, "Incident reported successfully", 201);
  } catch (error: any) {
    console.error(`${CTRL} reportIncident error:`, error);
    return errorResponse(res, error.message || "Failed to report incident", STATUS_CODE.ERROR);
  }
};

export const listIncidents = async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseTableParams(req.query as Record<string, unknown>);
    const hospitalId = (req as any).user?.hospitalId;

    const match: Record<string, unknown> = {};
    if (hospitalId) match.hospitalId = new Types.ObjectId(hospitalId);
    if (req.query.type) match.type = req.query.type as string;
    if (req.query.severity) match.severity = req.query.severity as string;
    if (req.query.isResolved !== undefined) match.isResolved = (req.query.isResolved as string) === "true";
    if (req.query.from || req.query.to) {
      match.reportedAt = {
        ...(req.query.from ? { $gte: new Date(req.query.from as string) } : {}),
        ...(req.query.to ? { $lte: new Date(req.query.to as string) } : {}),
      };
    }
    if (req.query.patientId && Types.ObjectId.isValid(req.query.patientId as string)) {
      match.patientId = new Types.ObjectId(req.query.patientId as string);
    }

    const [data, total] = await Promise.all([
      IncidentReportModel.find(match)
        .sort({ reportedAt: -1 })
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .populate("patientId", "f_name l_name mobile")
        .populate("reportedBy", "name email")
        .populate("resolvedBy", "name email")
        .lean(),
      IncidentReportModel.countDocuments(match),
    ]);

    return successListResponse(res, data, buildPaginationMeta(total, params.page, params.limit));
  } catch (error: any) {
    console.error(`${CTRL} listIncidents error:`, error);
    return errorResponse(res, error.message || "Failed to list incidents", STATUS_CODE.ERROR);
  }
};

export const getIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      return errorResponse(res, "Invalid incident ID", STATUS_CODE.BAD_REQUEST);
    }

    const incident = await IncidentReportModel.findById(id)
      .populate("patientId", "f_name l_name mobile")
      .populate("reportedBy", "name email")
      .populate("resolvedBy", "name email")
      .lean();

    if (!incident) {
      return errorResponse(res, "Incident not found", STATUS_CODE.NOT_FOUND);
    }

    return successResponse(res, incident);
  } catch (error: any) {
    console.error(`${CTRL} getIncident error:`, error);
    return errorResponse(res, error.message || "Failed to get incident", STATUS_CODE.ERROR);
  }
};

export const resolveIncident = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { resolutionNotes } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return errorResponse(res, "Invalid incident ID", STATUS_CODE.BAD_REQUEST);
    }

    const resolvedBy = (req as any).user?._id || (req as any).user?.id;

    const incident = await IncidentReportModel.findByIdAndUpdate(
      id,
      {
        $set: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedBy: resolvedBy ? new Types.ObjectId(resolvedBy) : undefined,
          resolutionNotes: resolutionNotes?.trim(),
        },
      },
      { new: true }
    ).lean();

    if (!incident) {
      return errorResponse(res, "Incident not found", STATUS_CODE.NOT_FOUND);
    }

    return successResponse(res, incident, "Incident resolved successfully");
  } catch (error: any) {
    console.error(`${CTRL} resolveIncident error:`, error);
    return errorResponse(res, error.message || "Failed to resolve incident", STATUS_CODE.ERROR);
  }
};

export const getIncidentsByVisit = async (req: Request, res: Response): Promise<void> => {
  try {
    const visitId = String(req.params.visitId);
    if (!Types.ObjectId.isValid(visitId)) {
      return errorResponse(res, "Invalid visitId", STATUS_CODE.BAD_REQUEST);
    }

    const incidents = await IncidentReportModel.find({
      visitId: new Types.ObjectId(visitId),
    }).lean();

    return successResponse(res, incidents);
  } catch (error: any) {
    console.error(`${CTRL} getIncidentsByVisit error:`, error);
    return errorResponse(res, error.message || "Failed to get visit incidents", STATUS_CODE.ERROR);
  }
};
