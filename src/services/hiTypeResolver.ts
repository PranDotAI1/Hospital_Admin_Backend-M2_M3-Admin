
export enum HealthInformationType {
  PRESCRIPTION = "Prescription",
  OP_CONSULTATION = "OPConsultation",
  DISCHARGE_SUMMARY = "DischargeSummary",
  DIAGNOSTIC_REPORT = "DiagnosticReport",
  RECORD_ARTIFACT = "HealthDocumentRecord",
  WELLNESS_RECORD = "WellnessRecord",
  IMMUNIZATION_RECORD = "ImmunizationRecord",
  INVOICE = "Invoice",
  UNKNOWN = "Unknown",
}

const PROFILE_TO_HI_TYPE: Record<string, HealthInformationType> = {
  // Prescription
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord":
    HealthInformationType.PRESCRIPTION,

  // OPConsultation
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord":
    HealthInformationType.OP_CONSULTATION,

  // DischargeSummary
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord":
    HealthInformationType.DISCHARGE_SUMMARY,

  // DiagnosticReport (record + sub-profiles for lab and radiology/imaging)
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord":
    HealthInformationType.DIAGNOSTIC_REPORT,
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab":
    HealthInformationType.DIAGNOSTIC_REPORT,
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportImaging":
    HealthInformationType.DIAGNOSTIC_REPORT,

  // HealthDocumentRecord (Record artifact / scanned PDFs)
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/HealthDocumentRecord":
    HealthInformationType.RECORD_ARTIFACT,

  // WellnessRecord
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/WellnessRecord":
    HealthInformationType.WELLNESS_RECORD,

  // ImmunizationRecord
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ImmunizationRecord":
    HealthInformationType.IMMUNIZATION_RECORD,

  // Invoice
  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/InvoiceRecord":
    HealthInformationType.INVOICE,
};

const SNOMED_TO_HI_TYPE: Record<string, HealthInformationType> = {
  // Prescription
  "440545006": HealthInformationType.PRESCRIPTION, // Prescription record
  "182840001": HealthInformationType.PRESCRIPTION, // Drug prescription
  "16076005": HealthInformationType.PRESCRIPTION,  // Prescription (procedure)

  // DischargeSummary
  "373942005": HealthInformationType.DISCHARGE_SUMMARY, // Discharge summary
  "78549003": HealthInformationType.DISCHARGE_SUMMARY,  // Discharge summary (document)

  // DiagnosticReport
  "721981007": HealthInformationType.DIAGNOSTIC_REPORT,     // Diagnostic studies report
  "4241000179101": HealthInformationType.DIAGNOSTIC_REPORT, // Laboratory report
  "371526004": HealthInformationType.DIAGNOSTIC_REPORT,     // Clinical laboratory report

  // HealthDocumentRecord
  "419891008": HealthInformationType.RECORD_ARTIFACT, // Record artifact
  "371529009": HealthInformationType.RECORD_ARTIFACT, // Health history document
  "422735006": HealthInformationType.RECORD_ARTIFACT, // Summary clinical document

  // ImmunizationRecord
  "41000179103": HealthInformationType.IMMUNIZATION_RECORD, // Immunization record

  // WellnessRecord
  "53576008": HealthInformationType.WELLNESS_RECORD, // Office visit / Health maintenance

  // OPConsultation
  "425173008": HealthInformationType.OP_CONSULTATION,
  "408443003": HealthInformationType.OP_CONSULTATION,
  "371525003": HealthInformationType.OP_CONSULTATION, // Clinical procedure report
  "308467007": HealthInformationType.OP_CONSULTATION, // Outpatient visit
  "11488002": HealthInformationType.OP_CONSULTATION,  // Consultation (procedure)
  "185347001": HealthInformationType.OP_CONSULTATION, // Encounter for problem
  "310362001": HealthInformationType.OP_CONSULTATION, // Follow-up encounter
  "410620009": HealthInformationType.OP_CONSULTATION, // Well child visit
  "11429006": HealthInformationType.OP_CONSULTATION,  // Consultation
};

const LOINC_TO_HI_TYPE: Record<string, HealthInformationType> = {
  // Prescription
  "56445-0": HealthInformationType.PRESCRIPTION, // Medication summary
  "57828-6": HealthInformationType.PRESCRIPTION, // Prescription list

  // DischargeSummary
  "18842-5": HealthInformationType.DISCHARGE_SUMMARY, // Discharge summary

  // DiagnosticReport
  "11502-2": HealthInformationType.DIAGNOSTIC_REPORT, // Lab report
  "18748-4": HealthInformationType.DIAGNOSTIC_REPORT, // Diagnostic imaging study
  "52040-3": HealthInformationType.DIAGNOSTIC_REPORT, // Bone density

  // ImmunizationRecord
  "11369-6": HealthInformationType.IMMUNIZATION_RECORD, // Immunization history
  "87273-9": HealthInformationType.IMMUNIZATION_RECORD, // Immunization note

  // OPConsultation
  "51845-0": HealthInformationType.OP_CONSULTATION, // Outpatient consultation
  "11488-4": HealthInformationType.OP_CONSULTATION, // Consult note
  "11506-3": HealthInformationType.OP_CONSULTATION, // Progress note
  "57133-1": HealthInformationType.OP_CONSULTATION, // Referral note
  "34133-9": HealthInformationType.OP_CONSULTATION, // Summarization of episode note
};

export interface ResolveHiTypeOptions {
  allowedTypes?: string[];
  defaultType?: HealthInformationType;
}

export function findComposition(fhirBundle: any): any | null {
  if (!fhirBundle || !Array.isArray(fhirBundle.entry)) return null;

  if (fhirBundle.entry[0]?.resource?.resourceType === "Composition") {
    return fhirBundle.entry[0].resource;
  }

  const found = fhirBundle.entry.find(
    (e: any) => e?.resource?.resourceType === "Composition",
  );
  return found?.resource || null;
}

export function resolveHiType(
  fhirBundle: any,
  options?: ResolveHiTypeOptions,
): HealthInformationType {
  if (!fhirBundle || typeof fhirBundle !== "object") {
    return options?.defaultType || HealthInformationType.UNKNOWN;
  }

  if (fhirBundle.resourceType && fhirBundle.resourceType !== "Bundle") {
    return options?.defaultType || HealthInformationType.UNKNOWN;
  }

  if (!Array.isArray(fhirBundle.entry) || fhirBundle.entry.length === 0) {
    return options?.defaultType || HealthInformationType.UNKNOWN;
  }

  const composition = findComposition(fhirBundle);

  const compProfiles: string[] = composition?.meta?.profile || [];
  for (const p of compProfiles) {
    if (typeof p === "string") {
      const trimmed = p.trim();
      if (PROFILE_TO_HI_TYPE[trimmed]) {
        return applyAllowedConstraint(PROFILE_TO_HI_TYPE[trimmed], options);
      }
      for (const [key, hiType] of Object.entries(PROFILE_TO_HI_TYPE)) {
        if (trimmed.startsWith(key)) {
          return applyAllowedConstraint(hiType, options);
        }
      }
    }
  }

  const bundleProfiles: string[] = fhirBundle.meta?.profile || [];
  for (const p of bundleProfiles) {
    if (typeof p === "string") {
      const trimmed = p.trim();
      if (PROFILE_TO_HI_TYPE[trimmed]) {
        return applyAllowedConstraint(PROFILE_TO_HI_TYPE[trimmed], options);
      }
      for (const [key, hiType] of Object.entries(PROFILE_TO_HI_TYPE)) {
        if (trimmed.startsWith(key)) {
          return applyAllowedConstraint(hiType, options);
        }
      }
    }
  }

  if (composition) {
    const codings: any[] = composition.type?.coding || [];
    for (const c of codings) {
      const code = String(c?.code || "").trim();
      if (!code) continue;

      if (code === "371530004") {
        const text = `${composition.title || ""} ${composition.type?.text || ""} ${c?.display || ""}`.toLowerCase();
        if (text.includes("invoice") || text.includes("bill") || text.includes("receipt") || text.includes("charge")) {
          return applyAllowedConstraint(HealthInformationType.INVOICE, options);
        }
        return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
      }

      if (SNOMED_TO_HI_TYPE[code]) {
        return applyAllowedConstraint(SNOMED_TO_HI_TYPE[code], options);
      }

      if (LOINC_TO_HI_TYPE[code]) {
        return applyAllowedConstraint(LOINC_TO_HI_TYPE[code], options);
      }
    }

    const hasGenericLoinc = codings.some((c) => String(c?.code || "").trim() === "11503-0");

    const textPool = [
      composition.title,
      composition.type?.text,
      ...(composition.section?.map((s: any) => s?.title) || []),
    ]
      .filter((t) => typeof t === "string" && t.length > 0)
      .join(" ")
      .toLowerCase();

    if (textPool.includes("prescription") || textPool.includes("rx") || textPool.includes("medication")) {
      return applyAllowedConstraint(HealthInformationType.PRESCRIPTION, options);
    }
    if (textPool.includes("discharge")) {
      return applyAllowedConstraint(HealthInformationType.DISCHARGE_SUMMARY, options);
    }
    if (
      textPool.includes("diagnostic") ||
      textPool.includes("lab report") ||
      textPool.includes("laboratory") ||
      textPool.includes("radiology") ||
      textPool.includes("pathology") ||
      textPool.includes("investigation")
    ) {
      return applyAllowedConstraint(HealthInformationType.DIAGNOSTIC_REPORT, options);
    }
    if (textPool.includes("wellness") || textPool.includes("fitness") || textPool.includes("lifestyle")) {
      return applyAllowedConstraint(HealthInformationType.WELLNESS_RECORD, options);
    }
    if (textPool.includes("immunization") || textPool.includes("vaccin")) {
      return applyAllowedConstraint(HealthInformationType.IMMUNIZATION_RECORD, options);
    }
    if (textPool.includes("invoice") || textPool.includes("bill") || textPool.includes("receipt")) {
      return applyAllowedConstraint(HealthInformationType.INVOICE, options);
    }
    if (
      textPool.includes("consultation") ||
      textPool.includes("outpatient") ||
      textPool.includes("op consult") ||
      textPool.includes("clinic visit") ||
      textPool.includes("visit note") ||
      textPool.includes("soap")
    ) {
      return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
    }
    if (textPool.includes("health document") || textPool.includes("record artifact") || textPool.includes("scanned")) {
      return applyAllowedConstraint(HealthInformationType.RECORD_ARTIFACT, options);
    }

    if (hasGenericLoinc) {
      return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
    }
  }

  const resourceTypes = new Set<string>();
  const resourceCounts: Record<string, number> = {};

  for (const entry of fhirBundle.entry) {
    const rType = entry?.resource?.resourceType;
    if (rType) {
      resourceTypes.add(rType);
      resourceCounts[rType] = (resourceCounts[rType] || 0) + 1;
    }
  }

  if (resourceTypes.has("Invoice") || resourceTypes.has("ChargeItem")) {
    return applyAllowedConstraint(HealthInformationType.INVOICE, options);
  }

  if (resourceTypes.has("Immunization") || resourceTypes.has("ImmunizationRecommendation")) {
    return applyAllowedConstraint(HealthInformationType.IMMUNIZATION_RECORD, options);
  }

  if (resourceTypes.has("DiagnosticReport") || resourceTypes.has("Specimen")) {
    return applyAllowedConstraint(HealthInformationType.DIAGNOSTIC_REPORT, options);
  }

  const hasInpatientEncounter = fhirBundle.entry.some((e: any) => {
    const r = e?.resource;
    if (r?.resourceType === "Encounter") {
      const cls = r.class?.code || r.class?.display || "";
      return /imp|inpatient|admit/i.test(cls);
    }
    return false;
  });
  if (hasInpatientEncounter || (resourceTypes.has("CarePlan") && resourceTypes.has("Procedure"))) {
    return applyAllowedConstraint(HealthInformationType.DISCHARGE_SUMMARY, options);
  }

  if (resourceTypes.has("MedicationRequest") || resourceTypes.has("MedicationStatement")) {
    if (resourceTypes.has("Encounter") || resourceTypes.has("Condition")) {
      return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
    }
    return applyAllowedConstraint(HealthInformationType.PRESCRIPTION, options);
  }

  if (resourceTypes.has("DocumentReference") || resourceTypes.has("Binary")) {
    if (!resourceTypes.has("Encounter") && !resourceTypes.has("Condition") && !resourceTypes.has("Observation")) {
      return applyAllowedConstraint(HealthInformationType.RECORD_ARTIFACT, options);
    }
  }

  if (resourceTypes.has("Observation") || resourceTypes.has("QuestionnaireResponse")) {
    if (!resourceTypes.has("Encounter") && !resourceTypes.has("Condition")) {
      return applyAllowedConstraint(HealthInformationType.WELLNESS_RECORD, options);
    }
    return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
  }

  if (resourceTypes.has("Encounter") || resourceTypes.has("Condition")) {
    return applyAllowedConstraint(HealthInformationType.OP_CONSULTATION, options);
  }

  return options?.defaultType || HealthInformationType.UNKNOWN;
}

function applyAllowedConstraint(
  type: HealthInformationType,
  options?: ResolveHiTypeOptions,
): HealthInformationType {
  if (!options?.allowedTypes || options.allowedTypes.length === 0) {
    return type;
  }

  const allowed = options.allowedTypes.some(
    (a) => a.toLowerCase() === type.toLowerCase(),
  );

  if (allowed) {
    return type;
  }

  if (options.allowedTypes.length === 1) {
    return (options.allowedTypes[0] as HealthInformationType) || type;
  }

  return type;
}
