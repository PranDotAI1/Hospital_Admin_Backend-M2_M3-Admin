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
  ISurgicalHistoryEntry,
  IImmunizationRecord,
  IMedicalHistoryEntry,
  VisitAssessmentModel,
  IPhysicalActivity,
  ILifestyle,
  IWomenHealth,
} from "../../models/VisitAssessment";

const isValidDate = (dateString: string): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

const hasImmunizationEvidence = (imm: any): boolean => {
  if (!imm || typeof imm !== "object") return false;

  // Legacy flat fields
  if (
    imm.covid19Dose1Date ||
    imm.covid19Dose2Date ||
    imm.tetanusBoosterDate ||
    imm.fluVaccineDate
  ) {
    return true;
  }

  // Nested v2 fields
  if (
    imm.covid19Dose1?.date ||
    imm.covid19Dose2?.date ||
    imm.tetanusBooster?.date ||
    imm.fluVaccine?.date
  ) {
    return true;
  }

  return false;
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

const saveAndCreateCareContext = async (
  resolved: { patientId: Types.ObjectId; visitId: Types.ObjectId },
  hiType: HIType,
): Promise<{ careContext: any; created: boolean } | null> => {
  const careContext = await CareContextService.createCareContextForHiType(
    resolved.patientId,
    resolved.visitId,
    hiType,
  );
  if (!careContext) return null;

  // Do not notify here. Notify must happen only after ABDM confirms link success
  // in handleLinkCallback -> notifyContext, otherwise ABDM returns ABDM-1006.
  return { careContext, created: true };
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
        form?: string;
        timing?: {
          frequency: number;
          period: number;
          periodUnit: string;
        };
        durationUnit?: string;
        customInstructions?: string;
        /** SNOMED CT Clinical Drug code from terminology search (per ABDM ndhm-medicine-codes) */
        snomedCode?: string;
        /** SNOMED CT display text for the medicine */
        snomedDisplay?: string;
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

    const result = await saveAndCreateCareContext(resolved, "Prescription");
    if (!result) {
      console.warn(
        "Visit clinical: Prescription saved but CareContext creation failed for visit",
        resolved.visitId,
        "- will retry on next token/link event.",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: result
        ? "Prescription saved and linked. ABDM context/notify sent when link token is available."
        : "Prescription saved. CareContext will be linked when ABHA link token is available.",
      data: result
        ? {
            careContextId: result.careContext?._id,
            hiType: result.careContext?.hiType,
          }
        : undefined,
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

    const result = await saveAndCreateCareContext(resolved, "OPConsultation");
    if (!result) {
      console.warn(
        "Visit clinical: SOAP notes saved but CareContext creation failed for visit",
        resolved.visitId,
        "- will retry on next token/link event.",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: result
        ? "SOAP notes saved and linked. ABDM context/notify sent when link token is available."
        : "SOAP notes saved. CareContext will be linked when ABHA link token is available.",
      data: result
        ? {
            careContextId: result.careContext?._id,
            hiType: result.careContext?.hiType,
          }
        : undefined,
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
        /** LOINC code from terminology search (per ABDM DiagnosticReport spec) */
        loincCode?: string;
        /** LOINC display text for this lab test */
        loincDisplay?: string;
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
          ...(r.loincCode ? { loincCode: r.loincCode } : {}),
          ...(r.loincDisplay ? { loincDisplay: r.loincDisplay } : {}),
        }))
      : [];

    // Step 1: Remove any existing entries for the same testType(s) being submitted,
    // so re-saving a test updates it rather than duplicating it.
    const incomingTestTypes = reports
      .map((r) => r.testType)
      .filter((t): t is string => Boolean(t));

    if (incomingTestTypes.length > 0) {
      await VisitLabReportModel.updateOne({ visitId: resolved.visitId }, {
        $pull: { reports: { testType: { $in: incomingTestTypes } } },
      } as any);
    }

    // Step 2: Append the new/updated reports. Using $push+$each so that tests
    // submitted in separate API calls accumulate (one call per test type is fine).
    await VisitLabReportModel.findOneAndUpdate(
      { visitId: resolved.visitId },
      {
        $setOnInsert: {
          visitId: resolved.visitId,
          patientId: resolved.patientId,
        },
        $push: { reports: { $each: reports } } as any,
      },
      { upsert: true, new: true },
    );

    const result = await saveAndCreateCareContext(resolved, "DiagnosticReport");
    if (!result) {
      console.warn(
        "Visit clinical: Lab results saved but CareContext creation failed for visit",
        resolved.visitId,
        "- will retry on next token/link event.",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: result
        ? "Lab results saved and linked. ABDM context/notify sent when link token is available."
        : "Lab results saved. CareContext will be linked when ABHA link token is available.",
      data: result
        ? {
            careContextId: result.careContext?._id,
            hiType: result.careContext?.hiType,
          }
        : undefined,
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
        form?: string;
        timing?: {
          frequency: number;
          period: number;
          periodUnit: string;
        };
        durationUnit?: string;
        customInstructions?: string;
        /** SNOMED CT Clinical Drug code from terminology search (per ABDM ndhm-medicine-codes) */
        snomedCode?: string;
        /** SNOMED CT display text for the medicine */
        snomedDisplay?: string;
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

    const result = await saveAndCreateCareContext(resolved, "DischargeSummary");
    if (!result) {
      console.warn(
        "Visit clinical: Discharge summary saved but CareContext creation failed for visit",
        resolved.visitId,
        "- will retry on next token/link event.",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: result
        ? "Discharge summary saved and linked. ABDM context/notify sent when link token is available."
        : "Discharge summary saved. CareContext will be linked when ABHA link token is available.",
      data: result
        ? {
            careContextId: result.careContext?._id,
            hiType: result.careContext?.hiType,
          }
        : undefined,
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
      physicalActivity?: any;
      lifestyle?: any;
      womenHealth?: any;
    };

    body = {
      ...body,
      vitals: parseIfString(body.vitals),
      immunization: parseIfString(body.immunization),
      medicalHistory: parseIfString(body.medicalHistory),
      surgicalHistory: parseIfString(body.surgicalHistory),
      physicalActivity: parseIfString(body.physicalActivity),
      lifestyle: parseIfString(body.lifestyle),
      womenHealth: parseIfString(body.womenHealth),
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

    if (body.physicalActivity && typeof body.physicalActivity !== "object") {
      validationErrors.push("physicalActivity must be an object if provided.");
    }

    if (body.lifestyle && typeof body.lifestyle !== "object") {
      validationErrors.push("lifestyle must be an object if provided.");
    }

    if (body.womenHealth && typeof body.womenHealth !== "object") {
      validationErrors.push("womenHealth must be an object if provided.");
    }

    let immunization: IImmunizationRecord | undefined = undefined;
    if (body.immunization) {
      immunization = {};
      const {
        covid19Dose1Date,
        covid19Dose2Date,
        tetanusBoosterDate,
        fluVaccineDate,
        covid19Dose1,
        covid19Dose2,
        tetanusBooster,
        fluVaccine,
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

      const normalizeDose = (dose: any, field: string) => {
        if (!dose || typeof dose !== "object") return undefined;
        const doseNumber =
          typeof dose.doseNumber === "number"
            ? dose.doseNumber
            : typeof dose.doseNumber === "string" &&
                dose.doseNumber.trim() !== ""
              ? Number(dose.doseNumber)
              : undefined;

        if (doseNumber !== undefined && Number.isNaN(doseNumber)) {
          validationErrors.push(`${field}.doseNumber must be a valid number.`);
        }

        return {
          ...(dose.date
            ? { date: toDateOrError(dose.date, `${field}.date`) }
            : {}),
          ...(dose.manufacturer ? { manufacturer: dose.manufacturer } : {}),
          ...(dose.lotNumber ? { lotNumber: dose.lotNumber } : {}),
          ...(doseNumber !== undefined && !Number.isNaN(doseNumber)
            ? { doseNumber }
            : {}),
        };
      };

      immunization.covid19Dose1 = normalizeDose(
        covid19Dose1,
        "immunization.covid19Dose1",
      );
      immunization.covid19Dose2 = normalizeDose(
        covid19Dose2,
        "immunization.covid19Dose2",
      );
      immunization.tetanusBooster = normalizeDose(
        tetanusBooster,
        "immunization.tetanusBooster",
      );
      immunization.fluVaccine = normalizeDose(
        fluVaccine,
        "immunization.fluVaccine",
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
    const validFiles = files.filter(
      (file) =>
        file.size > 0 && file.originalname && file.originalname.trim() !== "",
    );
    const newUploads = validFiles.map((file) => ({
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
        physicalActivity: body?.physicalActivity,
        lifestyle: body?.lifestyle,
        womenHealth: body?.womenHealth,
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

    // Create ImmunizationRecord CareContext when any immunization date exists
    // (supports both legacy flat fields and nested dose objects).
    const immData = immunization || (body?.immunization as any);
    if (hasImmunizationEvidence(immData)) {
      hiTypes.push("ImmunizationRecord");
    }

    if (
      body?.symptomsComplaints ||
      (body?.medicalHistory && body.medicalHistory.length > 0) ||
      (body?.surgicalHistory && body.surgicalHistory.length > 0)
    ) {
      hiTypes.push("OPConsultation");
    }

    if (newUploads.length > 0) {
      hiTypes.push("HealthDocumentRecord");
    }

    const uniqueHiTypes = Array.from(new Set(hiTypes)) as HIType[];
    const createdCareContexts: Array<{ careContextId: any; hiType: HIType }> =
      [];
    const failedHiTypes: HIType[] = [];

    if (uniqueHiTypes.length > 0) {
      // Create a separate CareContext for each applicable HI type
      for (const hiType of uniqueHiTypes) {
        const linkResult = await saveAndCreateCareContext(resolved, hiType);
        if (linkResult?.careContext) {
          createdCareContexts.push({
            careContextId: linkResult.careContext._id,
            hiType: linkResult.careContext.hiType,
          });
        } else {
          failedHiTypes.push(hiType);
          console.warn(
            `Visit clinical: Data saved but CareContext creation skipped for ${hiType} (no patient context found).`,
          );
        }
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Assessment saved successfully.",
      data: {
        createdCareContexts,
        failedHiTypes,
      },
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
      covid19Dose1?: {
        date?: string;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      covid19Dose2?: {
        date?: string;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      tetanusBooster?: {
        date?: string;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      fluVaccine?: {
        date?: string;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
    };

    const parseEntry = (entry?: {
      date?: string;
      manufacturer?: string;
      lotNumber?: string;
      doseNumber?: number;
    }) => {
      if (!entry) return undefined;
      const doseNumber =
        typeof entry.doseNumber === "number"
          ? entry.doseNumber
          : typeof (entry as any).doseNumber === "string" &&
              String((entry as any).doseNumber).trim() !== ""
            ? Number((entry as any).doseNumber)
            : undefined;

      return {
        date: entry.date ? new Date(entry.date) : undefined,
        manufacturer: entry.manufacturer?.trim() || undefined,
        lotNumber: entry.lotNumber?.trim() || undefined,
        doseNumber:
          doseNumber !== undefined && !Number.isNaN(doseNumber)
            ? doseNumber
            : undefined,
      };
    };

    const immunization = {
      covid19Dose1Date: body?.covid19Dose1Date
        ? new Date(body.covid19Dose1Date)
        : body?.covid19Dose1?.date
          ? new Date(body.covid19Dose1.date)
          : undefined,
      covid19Dose2Date: body?.covid19Dose2Date
        ? new Date(body.covid19Dose2Date)
        : body?.covid19Dose2?.date
          ? new Date(body.covid19Dose2.date)
          : undefined,
      tetanusBoosterDate: body?.tetanusBoosterDate
        ? new Date(body.tetanusBoosterDate)
        : body?.tetanusBooster?.date
          ? new Date(body.tetanusBooster.date)
          : undefined,
      fluVaccineDate: body?.fluVaccineDate
        ? new Date(body.fluVaccineDate)
        : body?.fluVaccine?.date
          ? new Date(body.fluVaccine.date)
          : undefined,
      covid19Dose1: parseEntry(body?.covid19Dose1),
      covid19Dose2: parseEntry(body?.covid19Dose2),
      tetanusBooster: parseEntry(body?.tetanusBooster),
      fluVaccine: parseEntry(body?.fluVaccine),
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

    const result = await saveAndCreateCareContext(
      resolved,
      "ImmunizationRecord",
    );
    if (!result) {
      console.warn(
        "Visit clinical: Immunization saved but CareContext creation failed for visit",
        resolved.visitId,
        "- will retry on next token/link event.",
      );
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: result
        ? "Immunization recorded and linked. ABDM context/notify sent when link token is available."
        : "Immunization recorded. CareContext will be linked when ABHA link token is available.",
      data: result
        ? {
            careContextId: result.careContext?._id,
            hiType: result.careContext?.hiType,
          }
        : undefined,
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
