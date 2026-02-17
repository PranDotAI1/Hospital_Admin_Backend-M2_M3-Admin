import { Request, Response } from "express";
import { Types } from "mongoose";
import { ScanShareVisitModel } from "../../models/ScanShareVisit";
import { PatientModel } from "../../models/Patient";
import { CareContextService } from "../../services/carecontext.service";
import { STATUS_CODE } from "../../utils/constant";
import type { HIType } from "../../models/CareContext";
import { VisitPrescriptionModel } from "../../models/VisitPrescription";
import { VisitLabReportModel } from "../../models/VisitLabReport";
import { VisitSoapNotesModel } from "../../models/VisitSoapNotes";
import { VisitDischargeSummaryModel } from "../../models/VisitDischargeSummary";
import {
  IPersonalHistoryEntry,
  IAdditionalDetailsEntry,
  ISurgicalHistoryEntry,
  IImmunizationRecord,
  IMedicalHistoryEntry,
  VisitAssessmentModel,
} from "../../models/VisitAssessment";

const isValidDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

const resolvePatientAndVisitId = async (
  visitId: string,
  patientIdParam?: string,
): Promise<{ patientId: Types.ObjectId; visitId: Types.ObjectId } | null> => {
  if (!visitId || !Types.ObjectId.isValid(visitId)) return null;
  const visitObjId = new Types.ObjectId(visitId);

  if (patientIdParam && Types.ObjectId.isValid(patientIdParam)) {
    return {
      patientId: new Types.ObjectId(patientIdParam),
      visitId: visitObjId,
    };
  }

  const scanVisit = await ScanShareVisitModel.findById(visitId)
    .select("patientId")
    .lean();
  if (scanVisit?.patientId) {
    return {
      patientId: scanVisit.patientId as Types.ObjectId,
      visitId: visitObjId,
    };
  }

  const patient = await PatientModel.findOne({
    "visits.visitId": visitObjId,
  })
    .select("_id")
    .lean();
  if (patient) {
    return { patientId: patient._id as Types.ObjectId, visitId: visitObjId };
  }

  return null;
};

const saveAndLinkHiTypes = async (
  resolved: { patientId: Types.ObjectId; visitId: Types.ObjectId },
  hiTypesToAdd: HIType[],
): Promise<{ careContext: any; updated: number } | null> => {
  const { updated, careContext } = await CareContextService.addHiTypesForVisit(
    resolved.patientId,
    resolved.visitId,
    hiTypesToAdd,
  );
  if (updated === 0) return null;
  if (careContext) {
    CareContextService.notifyContext(careContext as any).then((notified) => {
      if (notified)
        console.log(
          "Visit clinical: context/notify sent after adding hiTypes",
          hiTypesToAdd,
        );
      else
        console.warn(
          "Visit clinical: context/notify failed (e.g. no link token).",
        );
    });
  }
  return { careContext, updated };
};

export const recordPrescription = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const body = req.body as {
      medications?: Array<{
        medicine: string;
        dosage: string;
        duration?: string;
        instructions?: string;
        frequency?: string;
      }>;
      advice?: string;
    };
    const medications = Array.isArray(body?.medications)
      ? body.medications
      : [];
    const advice = typeof body?.advice === "string" ? body.advice : undefined;

    await VisitPrescriptionModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $set: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
          medications,
          advice,
        },
      },
      { upsert: true, new: true },
    );

    const result = await saveAndLinkHiTypes(resolved, ["Prescription"]);
    if (!result) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "No care context found for this visit. Ensure the patient has ABHA and a care context was created.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "Prescription saved and linked. ABDM context/notify sent when link token is available.",
      data: {
        careContextId: result.careContext?._id,
        hiTypes: result.careContext?.hiTypes,
      },
    });
  } catch (error: any) {
    console.error("Visit clinical recordPrescription error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save prescription.",
    });
  }
};

export const recordSoapNotes = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const body = req.body as {
      subjective?: string;
      objective?: string;
      assessment?: string;
      plan?: string;
    };
    await VisitSoapNotesModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $set: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
          subjective: body?.subjective,
          objective: body?.objective,
          assessment: body?.assessment,
          plan: body?.plan,
        },
      },
      { upsert: true, new: true },
    );

    const result = await saveAndLinkHiTypes(resolved, ["HealthDocumentRecord"]);
    if (!result) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "No care context found for this visit. Ensure the patient has ABHA and a care context was created.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "SOAP notes saved and linked. ABDM context/notify sent when link token is available.",
      // data: { careContextId: result.careContext?._id, hiTypes: result.careContext?.hiTypes },
    });
  } catch (error: any) {
    console.error("Visit clinical recordSoapNotes error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save SOAP notes.",
    });
  }
};

export const recordLabResults = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const body = req.body as {
      reports?: Array<{
        equipmentId?: string;
        testType?: string;
        resultValue?: string;
        measurementUnit?: string;
        captureTime?: string;
        equipmentStatus?: string;
        sampleId?: string;
        reportDate?: string;
        reportTime?: string;
        additionalObservations?: string;
        analystName?: string;
      }>;
    };
    const reports = Array.isArray(body?.reports)
      ? body.reports.map((r) => ({
          ...(r.equipmentId ? { equipmentId: r.equipmentId } : {}),
          ...(r.testType ? { testType: r.testType } : {}),
          ...(r.resultValue ? { resultValue: r.resultValue } : {}),
          ...(r.measurementUnit ? { measurementUnit: r.measurementUnit } : {}),
          captureTime:
            r.captureTime && isValidDate(r.captureTime)
              ? new Date(r.captureTime)
              : new Date(),
          ...(r.equipmentStatus ? { equipmentStatus: r.equipmentStatus } : {}),
          ...(r.sampleId ? { sampleId: r.sampleId } : {}),
          reportDate:
            r?.reportDate && isValidDate(r?.reportDate)
              ? new Date(r.reportDate)
              : new Date(),
          ...(r.reportTime ? { reportTime: r.reportTime } : {}),
          ...(r.additionalObservations
            ? { additionalObservations: r.additionalObservations }
            : {}),
          ...(r.analystName ? { analystName: r.analystName } : {}),
        }))
      : [];

    await VisitLabReportModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $set: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
          reports,
        },
      },
      { upsert: true, new: true },
    );

    const result = await saveAndLinkHiTypes(resolved, ["DiagnosticReport"]);
    if (!result) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "No care context found for this visit. Ensure the patient has ABHA and a care context was created.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "Lab results saved and linked. ABDM context/notify sent when link token is available.",
      // data: {
      //   careContextId: result.careContext?._id,
      //   hiTypes: result.careContext?.hiTypes,
      // },
    });
  } catch (error: any) {
    console.error("Visit clinical recordLabResults error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save lab results.",
    });
  }
};

export const recordDischargeSummary = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const body = req.body as {
      admissionDate?: string;
      dischargeDate?: string;
      ward?: string;
      bed?: string;
      diagnosis?: string;
      conditionAtDischarge?: string;
      clinicalSummary?: string;
      admissionNotes?: string;
      treatmentGiven?: string;
      investigationsResults?: string;
      followUpInstructions?: string;
      surgicalProcedures?: string;
      surgicalNote?: string;
      doctorSignature?: string;
      dischargeMedications?: Array<{
        medicine: string;
        dosage: string;
        frequency?: string;
        duration?: string;
        instructions?: string;
      }>;
    };
    const dischargeMedications = Array.isArray(body?.dischargeMedications)
      ? body.dischargeMedications
      : [];

    await VisitDischargeSummaryModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $set: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
          admissionDate: body?.admissionDate
            ? new Date(body.admissionDate)
            : undefined,
          dischargeDate: body?.dischargeDate
            ? new Date(body.dischargeDate)
            : undefined,
          ward: body?.ward,
          bed: body?.bed,
          diagnosis: body?.diagnosis,
          conditionAtDischarge: body?.conditionAtDischarge,
          clinicalSummary: body?.clinicalSummary,
          admissionNotes: body?.admissionNotes,
          treatmentGiven: body?.treatmentGiven,
          investigationsResults: body?.investigationsResults,
          followUpInstructions: body?.followUpInstructions,
          surgicalProcedures: body?.surgicalProcedures,
          surgicalNote: body?.surgicalNote,
          doctorSignature: body?.doctorSignature,
          dischargeMedications,
        },
      },
      { upsert: true, new: true },
    );

    const result = await saveAndLinkHiTypes(resolved, ["DischargeSummary"]);
    if (!result) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "No care context found for this visit. Ensure the patient has ABHA and a care context was created.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "Discharge summary saved and linked. ABDM context/notify sent when link token is available.",
      data: {
        careContextId: result.careContext?._id,
        hiTypes: result.careContext?.hiTypes,
      },
    });
  } catch (error: any) {
    console.error("Visit clinical recordDischargeSummary error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save discharge summary.",
    });
  }
};

export const recordAssessment = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);

    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const parseIfString = (val: any) => {
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch (e) {
          return val;
        }
      }
      return val;
    };

    let body = req.body as {
      vitals?: any;
      immunization?: any;
      symptomsComplaints?: string;
      medicalHistory?: any;
      surgicalHistory?: any;
      additionalDetails?: any;
      personalHistory?: any;
    };

    body = {
      ...body,
      vitals: parseIfString(body.vitals),
      immunization: parseIfString(body.immunization),
      medicalHistory: parseIfString(body.medicalHistory),
      surgicalHistory: parseIfString(body.surgicalHistory),
      additionalDetails: parseIfString(body.additionalDetails),
      personalHistory: parseIfString(body.personalHistory),
    };

    const validationErrors: string[] = [];

    if (body.vitals && typeof body.vitals !== "object") {
      validationErrors.push("vitals must be an object if provided.");
    }

    if (
      body.symptomsComplaints &&
      typeof body.symptomsComplaints !== "string"
    ) {
      validationErrors.push("symptomsComplaints must be a string if provided.");
    }

    if (body.medicalHistory && !Array.isArray(body.medicalHistory)) {
      validationErrors.push("medicalHistory must be an array if provided.");
    }

    if (body.surgicalHistory && !Array.isArray(body.surgicalHistory)) {
      validationErrors.push("surgicalHistory must be an array if provided.");
    }

    if (body.additionalDetails && !Array.isArray(body.additionalDetails)) {
      validationErrors.push("additionalDetails must be an array if provided.");
    }

    if (body.personalHistory && !Array.isArray(body.personalHistory)) {
      validationErrors.push("personalHistory must be an array if provided.");
    }

    let immunization: IImmunizationRecord | undefined = undefined;
    if (body.immunization) {
      immunization = {};
      const {
        covid19Dose1Date,
        covid19Dose2Date,
        tetanusBoosterDate,
        fluVaccineDate,
      } = body.immunization as any;

      const toDateOrError = (value: any, field: string): Date | undefined => {
        if (!value) return undefined;
        if (value instanceof Date) return value;
        if (typeof value === "string" && isValidDate(value)) {
          return new Date(value);
        }
        validationErrors.push(`${field} must be a valid ISO date string.`);
        return undefined;
      };

      immunization.covid19Dose1Date = toDateOrError(
        covid19Dose1Date,
        "immunization.covid19Dose1Date",
      );
      immunization.covid19Dose2Date = toDateOrError(
        covid19Dose2Date,
        "immunization.covid19Dose2Date",
      );
      immunization.tetanusBoosterDate = toDateOrError(
        tetanusBoosterDate,
        "immunization.tetanusBoosterDate",
      );
      immunization.fluVaccineDate = toDateOrError(
        fluVaccineDate,
        "immunization.fluVaccineDate",
      );
    }

    if (validationErrors.length > 0) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Validation failed for assessment payload.",
        errors: validationErrors,
      });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    const newUploads = files.map((file) => ({
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileData: file.buffer,
      uploadDate: new Date(),
    }));

    const updateQuery: any = {
      $set: {
        visitId: resolved.visitId,
        patientId: resolved.patientId,
        vitals: body?.vitals,
        immunization: immunization ?? body?.immunization,
        symptomsComplaints: body?.symptomsComplaints,
        medicalHistory: body?.medicalHistory,
        surgicalHistory: body?.surgicalHistory,
        additionalDetails: body?.additionalDetails,
        personalHistory: body?.personalHistory,
      },
    };

    if (newUploads.length > 0) {
      updateQuery.$push = { documentUploads: { $each: newUploads } };
    }

    await VisitAssessmentModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      updateQuery,
      { upsert: true, new: true },
    );

    // Determine HI Types based on what data was provided
    const hiTypes: HIType[] = [];

    if (body?.vitals && Object.keys(body.vitals).length > 0) {
      hiTypes.push("WellnessRecord");
    }

    if (immunization || body?.immunization) {
      hiTypes.push("ImmunizationRecord");
    }

    if (
      body?.symptomsComplaints ||
      (body?.medicalHistory && body.medicalHistory.length > 0) ||
      (body?.surgicalHistory && body.surgicalHistory.length > 0) ||
      (body?.personalHistory && body.personalHistory.length > 0) ||
      (body?.additionalDetails && body.additionalDetails.length > 0)
    ) {
      hiTypes.push("OPConsultation");
    }

    if (newUploads.length > 0) {
      hiTypes.push("HealthDocumentRecord");
    }

    let contextData: any = null;
    if (hiTypes.length > 0) {
      const linkResult = await saveAndLinkHiTypes(resolved, hiTypes);
      if (linkResult?.careContext) {
        contextData = {
          careContextId: linkResult.careContext._id,
          hiTypes: linkResult.careContext.hiTypes,
        };
      } else {
        console.warn(
          "Visit clinical: Data saved but Care Context update/notify skipped (no context found).",
        );
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Assessment saved successfully.",
      data: contextData,
    });
  } catch (error: any) {
    console.error("Visit clinical recordAssessment error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save assessment.",
    });
  }
};

export const recordImmunization = async (req: Request, res: Response) => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
    }

    const body = req.body as {
      covid19Dose1Date?: string;
      covid19Dose2Date?: string;
      tetanusBoosterDate?: string;
      fluVaccineDate?: string;
    };
    const immunization = {
      covid19Dose1Date: body?.covid19Dose1Date
        ? new Date(body.covid19Dose1Date)
        : undefined,
      covid19Dose2Date: body?.covid19Dose2Date
        ? new Date(body.covid19Dose2Date)
        : undefined,
      tetanusBoosterDate: body?.tetanusBoosterDate
        ? new Date(body.tetanusBoosterDate)
        : undefined,
      fluVaccineDate: body?.fluVaccineDate
        ? new Date(body.fluVaccineDate)
        : undefined,
    };

    await VisitAssessmentModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $set: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
          immunization,
        },
      },
      { upsert: true, new: true },
    );

    const result = await saveAndLinkHiTypes(resolved, ["ImmunizationRecord"]);
    if (!result) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "No care context found for this visit. Ensure the patient has ABHA and a care context was created.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message:
        "Immunization recorded and linked. ABDM context/notify sent when link token is available.",
      data: {
        careContextId: result.careContext?._id,
        hiTypes: result.careContext?.hiTypes,
      },
    });
  } catch (error: any) {
    console.error("Visit clinical recordImmunization error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save immunization.",
    });
  }
};

const getClinicalByVisit = async (
  req: Request,
  res: Response,
  model: "prescription" | "soap" | "lab" | "discharge" | "assessment",
): Promise<void> => {
  try {
    const visitId = req.params.visitId as string;
    const patientIdParam = req.query.patientId as string | undefined;
    const resolved = await resolvePatientAndVisitId(visitId, patientIdParam);
    if (!resolved) {
      res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message:
          "Visit not found or invalid visitId. For manual visits, pass query patientId.",
      });
      return;
    }

    let data: any = null;
    switch (model) {
      case "prescription":
        data = await VisitPrescriptionModel.findOne({
          visitId: resolved.visitId,
        }).lean();
        break;
      case "soap":
        data = await VisitSoapNotesModel.findOne({
          visitId: resolved.visitId,
        }).lean();
        break;
      case "lab":
        data = await VisitLabReportModel.findOne({
          visitId: resolved.visitId,
        }).lean();
        break;
      case "discharge":
        data = await VisitDischargeSummaryModel.findOne({
          visitId: resolved.visitId,
        }).lean();
        break;
      case "assessment":
        data = await VisitAssessmentModel.findOne({
          visitId: resolved.visitId,
        }).lean();
        break;
    }

    res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: data ?? null,
    });
  } catch (error: any) {
    console.error(`Visit clinical get${model} error:`, error);
    res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch health record.",
    });
  }
};

export const getPrescription = (req: Request, res: Response) =>
  getClinicalByVisit(req, res, "prescription");

export const getSoapNotes = (req: Request, res: Response) =>
  getClinicalByVisit(req, res, "soap");

export const getLabResults = (req: Request, res: Response) =>
  getClinicalByVisit(req, res, "lab");

export const getDischargeSummary = (req: Request, res: Response) =>
  getClinicalByVisit(req, res, "discharge");

export const getAssessment = (req: Request, res: Response) =>
  getClinicalByVisit(req, res, "assessment");
