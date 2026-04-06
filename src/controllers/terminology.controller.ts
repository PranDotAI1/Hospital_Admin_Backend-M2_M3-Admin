/**
 * Terminology Search Controller
 *
 * Provides REST endpoints for searching clinical terminologies:
 *  - GET /terminology/medicines    — SNOMED CT Clinical Drugs (ABDM ndhm-medicine-codes)
 *  - GET /terminology/lab-tests    — LOINC Lab Observations
 *  - GET /terminology/procedures   — SNOMED CT Procedures
 *  - GET /terminology/conditions   — SNOMED CT Clinical Findings
 */

import { Request, Response } from "express";
import { TerminologyService } from "../services/terminology.service";
import { STATUS_CODE } from "../utils/constant";

const parseParams = (req: Request) => {
  const q = (req.query.q as string || "").trim();
  const count = Math.min(
    Math.max(parseInt(req.query.count as string) || 10, 1),
    50,
  );
  return { q, count };
};

/**
 * GET /terminology/medicines?q=paracetamol&count=10
 *
 * Searches SNOMED CT Clinical Drug hierarchy (<<763158003).
 * Per ABDM FHIR IG v6.5.0: MedicationRequest.medicationCodeableConcept
 * must use codes from the ndhm-medicine-codes ValueSet.
 */
export const searchMedicines = async (req: Request, res: Response) => {
  try {
    const { q, count } = parseParams(req);
    if (!q || q.length < 2) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Query parameter 'q' is required (minimum 2 characters).",
      });
    }

    const results = await TerminologyService.searchMedicines(q, count);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      query: q,
      count: results.length,
      codeSystem: "http://snomed.info/sct",
      valueSet: "ndhm-medicine-codes (<<763158003 Medicinal product)",
      data: results,
    });
  } catch (error: any) {
    console.error("[TerminologyController] searchMedicines error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to search medicines.",
    });
  }
};

/**
 * GET /terminology/lab-tests?q=glucose&count=10
 *
 * Searches LOINC codes for laboratory tests and observations.
 * Per ABDM: Observation.code in DiagnosticReport bundles must use LOINC.
 */
export const searchLabTests = async (req: Request, res: Response) => {
  try {
    const { q, count } = parseParams(req);
    if (!q || q.length < 2) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Query parameter 'q' is required (minimum 2 characters).",
      });
    }

    const results = await TerminologyService.searchLabTests(q, count);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      query: q,
      count: results.length,
      codeSystem: "http://loinc.org",
      valueSet: "LOINC (http://loinc.org/vs)",
      data: results,
    });
  } catch (error: any) {
    console.error("[TerminologyController] searchLabTests error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to search lab tests.",
    });
  }
};

/**
 * GET /terminology/procedures?q=appendectomy&count=10
 *
 * Searches SNOMED CT Procedure hierarchy (<<71388002).
 * Per ABDM: Procedure.code should use SNOMED CT procedure codes.
 */
export const searchProcedures = async (req: Request, res: Response) => {
  try {
    const { q, count } = parseParams(req);
    if (!q || q.length < 2) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Query parameter 'q' is required (minimum 2 characters).",
      }); 
    }

    const results = await TerminologyService.searchProcedures(q, count);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      query: q,
      count: results.length,
      codeSystem: "http://snomed.info/sct",
      valueSet: "SNOMED CT Procedures (<<71388002)",
      data: results,
    });
  } catch (error: any) {
    console.error("[TerminologyController] searchProcedures error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to search procedures.",
    });
  }
};

/**
 * GET /terminology/conditions?q=diabetes&count=10
 *
 * Searches SNOMED CT Clinical Finding hierarchy (<<404684003).
 * Per ABDM: Condition.code should use SNOMED CT clinical finding codes.
 */
export const searchConditions = async (req: Request, res: Response) => {
  try {
    const { q, count } = parseParams(req);
    if (!q || q.length < 2) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        message: "Query parameter 'q' is required (minimum 2 characters).",
      });
    }

    const results = await TerminologyService.searchConditions(q, count);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      query: q,
      count: results.length,
      codeSystem: "http://snomed.info/sct",
      valueSet: "SNOMED CT Clinical Findings (<<404684003)",
      data: results,
    });
  } catch (error: any) {
    console.error("[TerminologyController] searchConditions error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to search conditions.",
    });
  }
};
