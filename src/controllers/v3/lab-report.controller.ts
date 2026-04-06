import { Request, Response } from "express";
import { Types } from "mongoose";
import { LabReportModel, ILabReportParameter } from "../../models/LabReport";
import { LabTestTemplateModel } from "../../models/LabTestTemplate";
import { PatientModel } from "../../models/Patient";
import { CareContextService } from "../../services/carecontext.service";
import { STATUS_CODE } from "../../utils/constant";
import type { HIType } from "../../models/CareContext";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a reference range string like "13-17" into { min, max }.
 * Returns null for non-parseable ranges (e.g. empty or text-based).
 */
const parseRange = (
  range: string,
): { min: number; max: number } | null => {
  if (!range || typeof range !== "string") return null;
  const match = range.match(
    /^\s*([+-]?\d+(?:\.\d+)?)\s*[-–]\s*([+-]?\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) return null;
  const min = parseFloat(match[1]);
  const max = parseFloat(match[2]);
  if (isNaN(min) || isNaN(max)) return null;
  return { min, max };
};

/**
 * Auto-flag a parameter value based on its reference range.
 */
const autoFlag = (
  value: string,
  referenceRange: string,
): "Normal" | "High" | "Low" | "" => {
  if (!value || value.trim() === "") return "";
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) return ""; // Skip non-numeric values
  const range = parseRange(referenceRange);
  if (!range) return "";
  if (numericValue < range.min) return "Low";
  if (numericValue > range.max) return "High";
  return "Normal";
};

/**
 * Auto-flag all parameters in a list and return the updated list.
 */
const autoFlagParameters = (
  parameters: ILabReportParameter[],
): ILabReportParameter[] => {
  return parameters.map((p) => ({
    ...p,
    flag: p.flag || autoFlag(p.parameterValue, p.referenceRange),
  }));
};

const resolvePatientId = async (
  patientId: string,
): Promise<Types.ObjectId | null> => {
  if (!patientId || !Types.ObjectId.isValid(patientId)) return null;
  const patient = await PatientModel.findById(patientId).select("_id").lean();
  return patient ? (patient._id as Types.ObjectId) : null;
};

/** Enrich a LabReport document's tests[] with displayName from templates */
const enrichWithTemplates = async (doc: any) => {
  if (!doc) return doc;
  const testTypes = (doc.tests || []).map((t: any) => t.testType);
  if (!testTypes.length) return doc;
  const templates = await LabTestTemplateModel.find({
    testType: { $in: testTypes },
  })
    .select("testType displayName uiType")
    .lean();
  const tplMap = new Map(templates.map((t) => [t.testType, t]));
  return {
    ...doc,
    tests: (doc.tests || []).map((t: any) => {
      const tpl = tplMap.get(t.testType);
      return {
        ...t,
        displayName: tpl?.displayName || t.testType,
        uiType: tpl?.uiType || "table",
      };
    }),
  };
};

// ── GET /lab-tests/types ─────────────────────────────────────────────────────

/**
 * List all available test types.
 */
export const getAvailableTestTypes = async (
  _req: Request,
  res: Response,
): Promise<any> => {
  try {
    const templates = await LabTestTemplateModel.find()
      .select("testType displayName uiType")
      .sort({ displayName: 1 })
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: templates,
    });
  } catch (error: any) {
    console.error("Lab report getAvailableTestTypes error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch test types.",
    });
  }
};

// ── GET /lab-tests/parameters/:testType ──────────────────────────────────────

/**
 * Get parameter template for a specific test type.
 * Frontend uses this to dynamically build forms.
 */
export const getTestParameters = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const testType = (req.params.testType as string)?.toLowerCase().trim();
    if (!testType) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Test type is required.",
      });
    }

    const template = await LabTestTemplateModel.findOne({ testType }).lean();
    if (!template) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: `No template found for test type: ${testType}`,
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: template,
    });
  } catch (error: any) {
    console.error("Lab report getTestParameters error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch test parameters.",
    });
  }
};

// ── POST /lab-reports/upsert ─────────────────────────────────────────────────

/**
 * Upsert a lab test entry into the centralized lab report for this patient+visit.
 * - If a lab report record already exists for this patient+visit, the test entry
 *   for the given testType is replaced (or added if new).
 * - If no record exists, a new one is created.
 *
 * This ensures there is always ONE lab report record per patient+visit,
 * containing ALL test types as entries in the `tests[]` array.
 */
export const upsertLabTest = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const {
      patientId,
      visitId,
      sampleId,
      testType,
      equipmentId,
      captureTime,
      reportDate,
      reportTime,
      analystName,
      observations,
      equipmentStatus,
      createdBy,
      parameters,
      loincCode,
      loincDisplay,
    } = req.body;

    // ── Validation ──────────────────────────────────────
    const errors: string[] = [];

    if (!patientId) errors.push("patientId is required.");
    if (!testType) errors.push("testType is required.");
    if (!sampleId) errors.push("sampleId is required.");
    if (!reportDate) errors.push("reportDate is required.");
    if (!analystName) errors.push("analystName is required.");
    if (!parameters || !Array.isArray(parameters) || parameters.length === 0) {
      errors.push("At least one parameter is required.");
    }

    if (Array.isArray(parameters)) {
      const hasValue = parameters.some(
        (p: any) =>
          p.parameterValue !== undefined &&
          p.parameterValue !== null &&
          String(p.parameterValue).trim() !== "",
      );
      if (!hasValue) {
        errors.push("At least one parameter must have a value.");
      }
    }

    if (errors.length > 0) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Validation failed.",
        errors,
      });
    }

    // Validate patient
    const resolvedPatientId = await resolvePatientId(patientId);
    if (!resolvedPatientId) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found.",
      });
    }

    // Validate test type exists in templates
    const normalizedTestType = testType.toLowerCase().trim();
    const template = await LabTestTemplateModel.findOne({
      testType: normalizedTestType,
    }).lean();
    if (!template) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: `Invalid test type: ${testType}. Use GET /lab-tests/types to see available test types.`,
      });
    }

    // Auto-flag parameters
    const flaggedParams = autoFlagParameters(
      parameters.map((p: any) => ({
        parameterName: p.parameterName || p.name || "",
        parameterValue: String(p.parameterValue ?? p.value ?? ""),
        unit: p.unit || "",
        referenceRange: p.referenceRange || p.range || "",
        flag: p.flag || "",
        section: p.section || "",
      })),
    );

    const testEntry = {
      testType: normalizedTestType,
      sampleId: sampleId.trim(),
      reportDate: new Date(reportDate),
      reportTime,
      analystName: analystName.trim(),
      equipmentId,
      captureTime: captureTime ? new Date(captureTime) : undefined,
      observations,
      equipmentStatus,
      status: "draft" as const,
      parameters: flaggedParams,
      loincCode,
      loincDisplay,
    };

    const resolvedVisitId =
      visitId && Types.ObjectId.isValid(visitId)
        ? new Types.ObjectId(visitId)
        : undefined;

    // Find existing centralized record for this patient+visit
    const filter: any = { patientId: resolvedPatientId };
    if (resolvedVisitId) {
      filter.visitId = resolvedVisitId;
    } else {
      filter.visitId = { $exists: false };
    }

    let report = await LabReportModel.findOne(filter);

    if (report) {
      // Replace existing entry for this testType, or push if new
      const idx = report.tests.findIndex(
        (t) => t.testType === normalizedTestType,
      );
      if (idx >= 0) {
        report.tests[idx] = testEntry as any;
      } else {
        report.tests.push(testEntry as any);
      }
      // If record was final but a test is re-submitted, revert to draft
      if (report.status === "final") {
        report.status = "draft";
      }
      await report.save();
    } else {
      report = await LabReportModel.create({
        patientId: resolvedPatientId,
        visitId: resolvedVisitId,
        createdBy,
        status: "draft",
        tests: [testEntry],
      });
    }

    // Create CareContext for ABDM if visitId is present
    if (report.visitId) {
      try {
        await CareContextService.createCareContextForHiType(
          resolvedPatientId,
          report.visitId,
          "DiagnosticReport" as HIType,
        );
      } catch (ccErr: any) {
        console.warn(
          "Lab report saved but CareContext creation failed:",
          ccErr.message,
        );
      }
    }

    const enriched = await enrichWithTemplates(report.toObject());

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Lab test saved successfully.",
      data: enriched,
    });
  } catch (error: any) {
    console.error("Lab report upsertLabTest error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to save lab test.",
    });
  }
};

// ── GET /lab-reports/visit/:visitId ──────────────────────────────────────────

/**
 * Get the centralized lab report for a specific visit.
 * Returns the single record with all test types, enriched with displayName.
 * Frontend uses this to prefill the lab report form.
 */
export const getVisitLabReport = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const visitId = req.params.visitId as string;
    if (!visitId || !Types.ObjectId.isValid(visitId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid visitId is required.",
      });
    }

    const report = await LabReportModel.findOne({
      visitId: new Types.ObjectId(visitId),
    }).lean();

    if (!report) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        data: null,
        message: "No lab report found for this visit.",
      });
    }

    const enriched = await enrichWithTemplates(report);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: enriched,
    });
  } catch (error: any) {
    console.error("Lab report getVisitLabReport error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch lab report.",
    });
  }
};

// ── GET /lab-reports/:id ─────────────────────────────────────────────────────

/**
 * Get a lab report record by its document ID.
 */
export const getLabReport = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const id = req.params.id as string;
    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid report ID is required.",
      });
    }

    const report = await LabReportModel.findById(id).lean();
    if (!report) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Lab report not found.",
      });
    }

    const enriched = await enrichWithTemplates(report);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: enriched,
    });
  } catch (error: any) {
    console.error("Lab report getLabReport error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch lab report.",
    });
  }
};

// ── PUT /lab-reports/:id/test/:testType ───────────────────────────────────────

/**
 * Update a specific test entry within a lab report record.
 * Only draft records can be edited.
 */
export const updateLabTest = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const id = req.params.id as string;
    const testType = (req.params.testType as string)?.toLowerCase().trim();

    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid report ID is required.",
      });
    }
    if (!testType) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "testType param is required.",
      });
    }

    const report = await LabReportModel.findById(id);
    if (!report) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Lab report not found.",
      });
    }

    const testIdx = report.tests.findIndex((t) => t.testType === testType);
    if (testIdx < 0) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: `Test type "${testType}" not found in this lab report.`,
      });
    }

    const entry = report.tests[testIdx];
    if (entry.status === "final") {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: `Cannot update a finalized test (${testType}). Create a new submission instead.`,
      });
    }

    const {
      sampleId,
      equipmentId,
      captureTime,
      reportDate,
      reportTime,
      analystName,
      observations,
      equipmentStatus,
      parameters,
      loincCode,
      loincDisplay,
    } = req.body;

    if (sampleId !== undefined) entry.sampleId = sampleId.trim();
    if (equipmentId !== undefined) entry.equipmentId = equipmentId;
    if (captureTime !== undefined)
      entry.captureTime = captureTime ? new Date(captureTime) : undefined;
    if (reportDate !== undefined) entry.reportDate = new Date(reportDate);
    if (reportTime !== undefined) entry.reportTime = reportTime;
    if (analystName !== undefined) entry.analystName = analystName.trim();
    if (observations !== undefined) entry.observations = observations;
    if (equipmentStatus !== undefined) entry.equipmentStatus = equipmentStatus;
    if (loincCode !== undefined) entry.loincCode = loincCode;
    if (loincDisplay !== undefined) entry.loincDisplay = loincDisplay;

    if (Array.isArray(parameters) && parameters.length > 0) {
      entry.parameters = autoFlagParameters(
        parameters.map((p: any) => ({
          parameterName: p.parameterName || p.name || "",
          parameterValue: String(p.parameterValue ?? p.value ?? ""),
          unit: p.unit || "",
          referenceRange: p.referenceRange || p.range || "",
          flag: p.flag || "",
          section: p.section || "",
        })),
      ) as any;
    }

    report.tests[testIdx] = entry;
    report.markModified("tests");
    await report.save();

    const enriched = await enrichWithTemplates(report.toObject());

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Lab test updated successfully.",
      data: enriched,
    });
  } catch (error: any) {
    console.error("Lab report updateLabTest error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to update lab test.",
    });
  }
};

// ── GET /lab-reports/patient/:patientId ───────────────────────────────────────

/**
 * List all lab report records for a patient.
 * Each record may contain multiple test types.
 */
export const getPatientLabReports = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const patientId = req.params.patientId as string;
    if (!patientId || !Types.ObjectId.isValid(patientId)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid patient ID is required.",
      });
    }

    const query: any = { patientId: new Types.ObjectId(patientId as string) };

    // Optional filter by visitId
    const visitId = req.query.visitId as string | undefined;
    if (visitId && Types.ObjectId.isValid(visitId)) {
      query.visitId = new Types.ObjectId(visitId);
    }

    const records = await LabReportModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Collect all unique testTypes across all records for batch template lookup
    const allTestTypes = [
      ...new Set(
        records.flatMap((r) => (r.tests || []).map((t) => t.testType)),
      ),
    ];
    const templates = await LabTestTemplateModel.find({
      testType: { $in: allTestTypes },
    })
      .select("testType displayName uiType")
      .lean();
    const tplMap = new Map(templates.map((t) => [t.testType, t]));

    const enriched = records.map((r) => ({
      ...r,
      tests: (r.tests || []).map((t) => {
        const tpl = tplMap.get(t.testType);
        return {
          ...t,
          displayName: tpl?.displayName || t.testType,
          uiType: tpl?.uiType || "table",
        };
      }),
    }));

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: enriched,
      total: enriched.length,
    });
  } catch (error: any) {
    console.error("Lab report getPatientLabReports error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch patient lab reports.",
    });
  }
};

// ── PATCH /lab-reports/:id/finalize ───────────────────────────────────────────

/**
 * Finalize (lock) a lab report record.
 * All tests within are marked final. Once finalized, tests cannot be edited.
 * Optionally pass { testType } in body to finalize only a specific test.
 */
export const finalizeLabReport = async (
  req: Request,
  res: Response,
): Promise<any> => {
  try {
    const id = req.params.id as string;
    if (!id || !Types.ObjectId.isValid(id)) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Valid report ID is required.",
      });
    }

    const report = await LabReportModel.findById(id);
    if (!report) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Lab report not found.",
      });
    }

    if (report.status === "final") {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Report is already finalized.",
      });
    }

    const specificTestType = (req.body?.testType as string)
      ?.toLowerCase()
      .trim();

    if (specificTestType) {
      // Finalize a single test entry
      const testIdx = report.tests.findIndex(
        (t) => t.testType === specificTestType,
      );
      if (testIdx < 0) {
        return res.status(STATUS_CODE.NOT_FOUND).json({
          status: "error",
          message: `Test type "${specificTestType}" not found in this lab report.`,
        });
      }
      const entry = report.tests[testIdx];
      const hasValue = entry.parameters.some(
        (p) => p.parameterValue && p.parameterValue.trim() !== "",
      );
      if (!hasValue) {
        return res.status(STATUS_CODE.BAD_REQUEST).json({
          status: "error",
          message: `Cannot finalize test "${specificTestType}" with no parameter values.`,
        });
      }
      entry.status = "final";
      report.markModified("tests");
    } else {
      // Finalize the entire record
      const hasAnyValue = report.tests.some((t) =>
        t.parameters.some((p) => p.parameterValue && p.parameterValue.trim() !== ""),
      );
      if (!hasAnyValue) {
        return res.status(STATUS_CODE.BAD_REQUEST).json({
          status: "error",
          message:
            "Cannot finalize a report with no parameter values. Enter at least one value.",
        });
      }
      report.tests.forEach((t) => {
        t.status = "final";
      });
      report.status = "final";
    }

    await report.save();

    // Trigger CareContext on finalize if visitId is present
    if (report.visitId) {
      try {
        await CareContextService.createCareContextForHiType(
          report.patientId,
          report.visitId,
          "DiagnosticReport" as HIType,
        );
      } catch (ccErr: any) {
        console.warn(
          "Lab report finalized but CareContext creation failed:",
          ccErr.message,
        );
      }
    }

    const enriched = await enrichWithTemplates(report.toObject());

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: specificTestType
        ? `Test "${specificTestType}" finalized successfully.`
        : "Lab report finalized successfully. It can no longer be edited.",
      data: enriched,
    });
  } catch (error: any) {
    console.error("Lab report finalizeLabReport error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to finalize lab report.",
    });
  }
};
