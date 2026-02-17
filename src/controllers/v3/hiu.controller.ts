import { Request, Response } from "express";
import { STATUS_CODE } from "../../utils/constant";
import { HiuService } from "../../services/hiu.service";

export const searchPatient = async (req: Request, res: Response) => {
  try {
    const { name, gender, yearOfBirth, mobile } = req.body;

    // Construct verified identifiers if mobile provided
    const verifiedIdentifiers = mobile
      ? [{ type: "MOBILE", value: mobile }]
      : undefined;

    const requestId = await HiuService.searchPatient({
      name,
      gender,
      yearOfBirth,
      verifiedIdentifiers,
    });

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Patient search initiated",
      requestId,
    });
  } catch (error: any) {
    console.error("Search Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to initiate search",
    });
  }
};

export const onDiscover = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    console.log(
      "[HIU_CONTROLLER] On-discover callback received:",
      JSON.stringify(body, null, 2),
    );

    return res.status(STATUS_CODE.SUCCESS).json({ status: "ok" });
  } catch (error: any) {
    console.error("HIU On Discover callback error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: "Error processing callback",
    });
  }
};

export const onLinkInit = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    console.log(
      "[HIU_CONTROLLER] On-init (Auth) callback received:",
      JSON.stringify(body, null, 2),
    );

    // In a real app, you would handle the transactionId here to prompt user for OTP
    return res.status(STATUS_CODE.SUCCESS).json({ status: "ok" });
  } catch (error: any) {
    console.error("HIU On Init callback error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: "Error processing callback",
    });
  }
};

export const onLinkConfirm = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    console.log(
      "[HIU_CONTROLLER] On-confirm (Auth) callback received:",
      JSON.stringify(body, null, 2),
    );

    // In a real app, you would verify the auth token and link the patient locally
    return res.status(STATUS_CODE.SUCCESS).json({ status: "ok" });
  } catch (error: any) {
    console.error("HIU On Confirm callback error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: "Error processing callback",
    });
  }
};

export const initiateDataFetch = async (req: Request, res: Response) => {
  try {
    const { consentArtefactId, dateFrom, dateTo, storeAsExternalRecord } =
      req.body;

    if (!consentArtefactId) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Consent Artefact ID is required",
      });
    }

    const { requestId, status, existingRecordCount } =
      await HiuService.requestHealthInformation(
        consentArtefactId,
        {
          from: new Date(dateFrom || "2024-01-01"),
          to: new Date(dateTo || new Date()),
        },
        { storeAsExternalRecord: storeAsExternalRecord === true },
      );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Health information fetch initiated",
      requestId,
      abdmStatus: status,
      existingRecordCount,
    });
  } catch (error: any) {
    console.error("Initiate Data Fetch error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to initiate data fetch",
    });
  }
};

export const retryFailedConsents = async (req: Request, res: Response) => {
  try {
    const result = await HiuService.retryFailedConsents();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: `Retried ${result.retried} consent(s)`,
      ...result,
    });
  } catch (error: any) {
    console.error("Retry Failed Consents error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to retry consents",
    });
  }
};

export const onHealthInformationRequest = async (
  req: Request,
  res: Response,
) => {
  try {
    const body = req.body;

    console.log(
      "[HIU_CONTROLLER] On-request callback received:",
      JSON.stringify(body, null, 2),
    );

    const originalRequestId =
      body.response?.requestId ||
      body.resp?.requestId ||
      body.requestId ||
      (req.headers["request-id"] as string);

    if (originalRequestId) {
      console.log(
        `[HIU_CONTROLLER] Processing on-request for requestId: ${originalRequestId}`,
      );
      await HiuService.handleHiuOnRequest(originalRequestId, body);
    } else {
      console.warn(
        "[HIU_CONTROLLER] Could not find requestId in callback. Headers:",
        req.headers,
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({ status: "ok" });
  } catch (error: any) {
    console.error("HIU On Request callback error:", error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Error processing callback" });
  }
};

export const onHealthInformationTransfer = async (
  req: Request,
  res: Response,
) => {
  try {
    const body = req.body;
    /*
      Payload Structure:
      {
        "pageNumber": 0,
        "pageCount": 1,
        "transactionId": "uuid",
        "entries": [
          {
            "content": "encrypted_content",
            "media": "application/fhir+json",
            "checksum": "...",
            "careContextReference": "..."
          }
        ],
        "keyMaterial": { ... }
      }
    */

    const { transactionId, entries, keyMaterial } = body;

    if (!transactionId || !entries || !keyMaterial) {
      console.error("[HIU_CONTROLLER] Invalid transfer payload", body);
      return res.status(STATUS_CODE.ERROR).json({ message: "Invalid payload" });
    }

    HiuService.handleHiuTransfer(transactionId, entries, keyMaterial)
      .then(() =>
        console.log(`[HIU_CONTROLLER] Transfer processed for ${transactionId}`),
      )
      .catch((err) =>
        console.error(
          `[HIU_CONTROLLER] Transfer handling failed for ${transactionId}:`,
          err,
        ),
      );

    return res.status(STATUS_CODE.SUCCESS).json({ status: "ok" });
  } catch (error: any) {
    console.error("HIU Transfer callback error:", error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Error processing transfer" });
  }
};

import { ExternalHealthRecordModel } from "../../models/ExternalHealthRecord";
import { ConsentArtefactModel, ConsentArtefactStatus } from "../../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../../models/PHRConsentArtefact";
import { Types } from "mongoose";

export const getExternalRecords = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.params;
    const { page = 1, limit = 20, sourceHipId, consentArtefactId } = req.query;

    console.log(`[HIU] getExternalRecords called. Params:`, {
      patientId,
      query: req.query,
    });

    // Check if patientId is "undefined" string
    if (patientId === "undefined" || patientId === "null") {
      console.warn("[HIU] Received invalid patientId string:", patientId);
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(limit as string, 10) || 20),
    );
    const skip = (pageNum - 1) * limitNum;
    let query: any = {};
    if (Types.ObjectId.isValid(patientId as string)) {
      query.patientId = new Types.ObjectId(patientId as string);
    } else {
      query.patientAbhaAddress = patientId;
    }
    if (sourceHipId) {
      query.sourceHipId = sourceHipId;
    }
    if (consentArtefactId) {
      query.consentArtefactId = consentArtefactId;
    }

    // Only return records whose consent is still GRANTED (revoked/expired data is removed on notify; this is a safety filter)
    const grantedArtefactIds = await ConsentArtefactModel.distinct("artefactId", {
      status: ConsentArtefactStatus.GRANTED,
    });
    if (grantedArtefactIds.length > 0) {
      if (query.consentArtefactId && typeof query.consentArtefactId === "string") {
        if (!grantedArtefactIds.includes(query.consentArtefactId)) {
          query.consentArtefactId = { $in: [] };
        }
      } else {
        query.consentArtefactId = { $in: grantedArtefactIds };
      }
    } else {
      query.consentArtefactId = { $in: [] };
    }

    console.log(`[HIU] Executing query:`, JSON.stringify(query));

    const [records, total] = await Promise.all([
      ExternalHealthRecordModel.find(query)
        .sort({ receivedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .select("-fhirBundle")
        .lean(),
      ExternalHealthRecordModel.countDocuments(query),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: records,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Get External Records error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch external records",
    });
  }
};

export const getExternalRecordById = async (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;

    if (!Types.ObjectId.isValid(recordId as string)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Invalid record ID",
      });
    }

    const record = await ExternalHealthRecordModel.findById(recordId).lean();

    if (!record) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Record not found",
      });
    }

    // Do not return record if its consent was revoked/expired or if it's a PHR consent (external records are HIMS only)
    const artefactGranted = await ConsentArtefactModel.findOne({
      artefactId: record.consentArtefactId,
      status: ConsentArtefactStatus.GRANTED,
    });
    if (!artefactGranted) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Record not found",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: record,
    });
  } catch (error: any) {
    console.error("Get External Record by ID error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch external record",
    });
  }
};
