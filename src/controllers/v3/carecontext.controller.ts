import { Request, Response } from "express";
import { Types } from "mongoose";
import { CareContextModel, CareContextStatus } from "../../models/CareContext";
import { PatientModel } from "../../models/Patient";
import { CareContextService } from "../../services/carecontext.service";
import { AbdmTokenService } from "../../services/abdm.token.service";
import { STATUS_CODE } from "../../utils/constant";

export const listByPatient = async (req: Request, res: Response) => {
  try {
    const patientId = req.params.patientId as string;
    const { status } = req.query;

    if (!Types.ObjectId.isValid(patientId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid patient ID format",
      });
    }

    const query: any = { patientId };
    if (status) {
      query.linkingStatus = status;
    }

    const careContexts = await CareContextModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const patient = await PatientModel.findById(patientId)
      .select("uhid name abhaaddress ABHANumber abdmLinkToken")
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: {
        patient: patient
          ? {
              uhid: patient.uhid,
              name: patient.name,
              abhaAddress: patient.abhaaddress,
              hasValidLinkToken: patient.abdmLinkToken
                ? CareContextService.isLinkTokenValid(patient as any)
                : false,
            }
          : null,
        careContexts,
        summary: {
          total: careContexts.length,
          pending: careContexts.filter(
            (c) => c.linkingStatus === CareContextStatus.PENDING,
          ).length,
          linking: careContexts.filter(
            (c) => c.linkingStatus === CareContextStatus.LINKING,
          ).length,
          linked: careContexts.filter(
            (c) => c.linkingStatus === CareContextStatus.LINKED,
          ).length,
          notified: careContexts.filter(
            (c) => c.linkingStatus === CareContextStatus.NOTIFIED,
          ).length,
          failed: careContexts.filter(
            (c) => c.linkingStatus === CareContextStatus.FAILED,
          ).length,
        },
      },
    });
  } catch (error: any) {
    console.error("CareContext listByPatient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch care contexts",
    });
  }
};

/**
 * List pending Care Contexts (admin endpoint)
 * GET /carecontext/pending
 */
export const listPending = async (req: Request, res: Response) => {
  try {
    const { limit = 50 } = req.query;

    const pendingContexts = await CareContextService.getPendingCareContexts(
      Number(limit),
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: pendingContexts,
      count: pendingContexts.length,
    });
  } catch (error: any) {
    console.error("CareContext listPending error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch pending care contexts",
    });
  }
};

export const triggerLink = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid care context ID format",
      });
    }

    const careContext = await CareContextModel.findById(id);
    if (!careContext) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Care context not found",
      });
    }

    if (
      careContext.linkingStatus === CareContextStatus.LINKED ||
      careContext.linkingStatus === CareContextStatus.NOTIFIED
    ) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Care context is already linked",
        data: careContext,
      });
    }

    const abdmToken = await AbdmTokenService.getToken();
    const success = await CareContextService.linkCareContext(id, abdmToken);

    const updatedContext = await CareContextModel.findById(id);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: success ? "success" : "pending",
      message: success
        ? "Link request sent to ABDM"
        : "Failed to initiate linking",
      data: updatedContext,
    });
  } catch (error: any) {
    console.error("CareContext triggerLink error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to trigger linking",
    });
  }
};

export const retryLink = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid care context ID format",
      });
    }

    const careContext = await CareContextModel.findById(id);
    if (!careContext) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Care context not found",
      });
    }

    if (
      careContext.linkingStatus === CareContextStatus.LINKED ||
      careContext.linkingStatus === CareContextStatus.NOTIFIED
    ) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Care context is already linked",
        data: careContext,
      });
    }

    careContext.linkingStatus = CareContextStatus.PENDING;
    careContext.linkError = null;
    await careContext.save();

    const abdmToken = await AbdmTokenService.getToken();
    const success = await CareContextService.linkCareContext(id, abdmToken);

    const updatedContext = await CareContextModel.findById(id);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: success ? "success" : "pending",
      message: success
        ? "Retry link request sent to ABDM"
        : "Failed to retry linking",
      data: updatedContext,
    });
  } catch (error: any) {
    console.error("CareContext retryLink error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to retry linking",
    });
  }
};

export const linkAllForPatient = async (req: Request, res: Response) => {
  try {
    const patientId = req.params.patientId as string;

    if (!Types.ObjectId.isValid(patientId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid patient ID format",
      });
    }

    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (!CareContextService.isLinkTokenValid(patient as any)) {
      const tokenRequested = await CareContextService.requestLinkToken(
        patient as any,
      );
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "pending",
        message: tokenRequested
          ? "Link token requested from ABDM. Linking will proceed when token is received."
          : "Patient does not have a valid link token and token request failed.",
      });
    }

    const abdmToken = await AbdmTokenService.getToken();
    const linkedCount = await CareContextService.linkPendingCareContexts(
      patientId,
      abdmToken,
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: `Initiated linking for ${linkedCount} care contexts`,
      linkedCount,
    });
  } catch (error: any) {
    console.error("CareContext linkAllForPatient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to link care contexts",
    });
  }
};

export const createCareContext = async (req: Request, res: Response) => {
  try {
    const { patientId, visitId, hiType, hiTypes } = req.body;

    if (!patientId || !Types.ObjectId.isValid(patientId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid patient ID is required",
      });
    }

    if (!visitId || !Types.ObjectId.isValid(visitId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid visit ID is required",
      });
    }

    // One CareContext must map to exactly one HI type.
    const resolvedHiType: string | undefined =
      typeof hiType === "string" && hiType.trim().length > 0
        ? hiType.trim()
        : Array.isArray(hiTypes) && hiTypes.length === 1
          ? String(hiTypes[0]).trim()
          : undefined;

    if (Array.isArray(hiTypes) && hiTypes.length > 1) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message:
          "Pass only one hiType per request. Multi-hiType arrays are not allowed.",
      });
    }

    if (!resolvedHiType) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message:
          "At least one hiType is required (e.g. hiType: 'Prescription')",
      });
    }

    const careContext = await CareContextService.createCareContextForHiType(
      patientId,
      visitId,
      resolvedHiType as any,
    );

    if (!careContext) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Failed to create care context. Patient may not exist.",
      });
    }

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      message: "Created 1 care context",
      data: [careContext],
    });
  } catch (error: any) {
    console.error("CareContext create error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to create care context",
    });
  }
};

export const getById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid care context ID format",
      });
    }

    const careContext = await CareContextModel.findById(id)
      .populate("patientId", "uhid name abhaaddress ABHANumber")
      .lean();

    if (!careContext) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Care context not found",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: careContext,
    });
  } catch (error: any) {
    console.error("CareContext getById error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch care context",
    });
  }
};

export const setLinkTokenForPatient = async (req: Request, res: Response) => {
  try {
    const patientId = req.params.patientId as string;
    const { linkToken } = req.body;

    if (!Types.ObjectId.isValid(patientId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid patient ID format",
      });
    }

    if (!linkToken || typeof linkToken !== "string") {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Body must include linkToken (string)",
      });
    }

    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    await CareContextService.storeLinkToken(patientId, linkToken.trim());

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "Link token stored. Call POST /carecontext/patient/:patientId/link-all to link pending contexts.",
    });
  } catch (error: any) {
    console.error("CareContext setLinkToken error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to set link token",
    });
  }
};

export const retryNotify = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid care context ID format",
      });
    }

    const careContext = await CareContextModel.findById(id);
    if (!careContext) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Care context not found",
      });
    }

    if (
      careContext.linkingStatus !== CareContextStatus.LINKED &&
      careContext.linkingStatus !== CareContextStatus.NOTIFIED
    ) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Care context must be LINKED before notifying",
      });
    }

    const abdmToken = await AbdmTokenService.getToken();
    const success = await CareContextService.notifyContext(
      careContext,
      abdmToken,
    );

    const updatedContext = await CareContextModel.findById(id);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: success ? "success" : "error",
      message: success ? "Context notify sent to ABDM" : "Failed to notify",
      data: updatedContext,
    });
  } catch (error: any) {
    console.error("CareContext retryNotify error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to send notify",
    });
  }
};
