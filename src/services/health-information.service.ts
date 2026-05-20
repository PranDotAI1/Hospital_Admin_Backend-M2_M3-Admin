import axios from "axios";
import puppeteer, { Browser } from "puppeteer";
import {
  CareContextModel,
  ICareContext,
  DataTransferStatus,
  HIType,
} from "../models/CareContext";
import { ConsentRequestModel } from "../models/ConsentRequest";
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
} from "../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../models/PHRConsentArtefact";
import { PatientModel } from "../models/Patient";
import { ScanShareVisitModel } from "../models/ScanShareVisit";
import { VisitPrescriptionModel } from "../models/VisitPrescription";
import { VisitLabReportModel } from "../models/VisitLabReport";
import { VisitSoapNotesModel } from "../models/VisitSoapNotes";
import { VisitDischargeSummaryModel } from "../models/VisitDischargeSummary";
import { VisitAssessmentModel } from "../models/VisitAssessment";
import { VisitDayCareBilling } from "../models/VisitDayCareBilling";
import { LabReportModel } from "../models/LabReport";
import { LabTestTemplateModel } from "../models/LabTestTemplate";
import * as fs from "fs";
import { AbdmLogger } from "../utils/abdm.logger";
import { ICombinedBundleOptionalData } from "./fhir.bundle.service";
import { generateFhirBundle } from "./fhir.bundle.builders";

import {
  buildDataPushPayload,
  ABDMKeyMaterial,
} from "../utils/prepareAndEncryptFhirPayload";
import {
  generateUID,
  X_CM_ID,
  X_HIP_ID,
  facilityId,
  ENDPOINTS,
} from "../utils/constant";
import { AbdmTokenService } from "./abdm.token.service";
import { ConsentService } from "./consent.service";

const LOG_PREFIX = "[HEALTH_INFO]";

/**
 * Thrown when a data push fails due to a transient/recoverable error
 * (e.g., ABDM-1017 gateway not ready, 5xx server errors, network timeouts).
 * This error is NOT caught inside processHealthInfoRequest — it propagates
 * to the BullMQ worker, which will automatically retry the entire job
 * with exponential backoff. This is the Guaranteed Delivery mechanism.
 */
export class TransientDataPushError extends Error {
  public readonly code: string;
  public readonly attempts: number;

  constructor(code: string, message: string, attempts: number) {
    super(message);
    this.name = "TransientDataPushError";
    this.code = code;
    this.attempts = attempts;
  }
}

// In-memory lock for fast local dedup (single-instance optimization).
// Redis distributed lock (via abdm.queue.service) provides cross-instance safety.
// Both are used: in-memory first (zero-cost), then Redis for distributed guarantee.
const activeConsentProcessing = new Set<string>();

// ============================================================================
// Security: dataPushUrl validation (SSRF Prevention)
// ============================================================================

// ============================================================================
/**
 * Validate dataPushUrl to prevent SSRF attacks.
 * ABDM sends this URL in health-information/request — it points to the
 * requesting HIU's data transfer endpoint, which can be ANY registered
 * healthcare facility (another hospital, PHR app, your own server, etc.).
 *
 * We do NOT restrict to ABDM domains — that would block legitimate HIU requests.
 * Instead, we enforce:
 * 1. HTTPS only — never push PHI over plain HTTP
 * 2. No private/internal IPs — prevents SSRF to internal infrastructure
 */
const isValidDataPushUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);

    // Must be HTTPS — never push PHI over plain HTTP
    if (parsed.protocol !== "https:") {
      console.error(
        `${LOG_PREFIX} [SECURITY] dataPushUrl uses non-HTTPS protocol: ${parsed.protocol}`,
      );
      return false;
    }

    // Block internal/private IP ranges (SSRF protection)
    // These should never appear in a legitimate HIU URL
    const hostname = parsed.hostname.toLowerCase();
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\./,
      /^\[::1\]$/,
    ];
    if (blockedPatterns.some((p) => p.test(hostname))) {
      console.error(
        `${LOG_PREFIX} [SECURITY] dataPushUrl points to private/internal address: ${hostname}`,
      );
      return false;
    }

    return true;
  } catch {
    console.error(
      `${LOG_PREFIX} [SECURITY] dataPushUrl is not a valid URL: ${url}`,
    );
    return false;
  }
};

/**
 * Resolve exactly one HI type for a CareContext.
 * For legacy rows with multiple hiTypes, prefer a specific non-OP type.
 */
const resolveSingleHiTypeForCareContext = (
  careContext: ICareContext,
  consentedHiTypes?: string[],
): HIType | undefined => {
  if (careContext.hiType) return careContext.hiType as HIType;

  const contextTypes = Array.isArray(careContext.hiTypes)
    ? (careContext.hiTypes.filter(Boolean) as HIType[])
    : [];

  if (contextTypes.length === 0) return undefined;
  if (contextTypes.length === 1) return contextTypes[0];

  const consentScoped =
    Array.isArray(consentedHiTypes) && consentedHiTypes.length > 0
      ? contextTypes.filter((t) => consentedHiTypes.includes(t))
      : contextTypes;

  const candidates = consentScoped.length > 0 ? consentScoped : contextTypes;
  const nonOp = candidates.find((t) => t !== "OPConsultation");
  return nonOp || candidates[0];
};

/**
 * Health Information Service
 *
 * Handles the ABDM data flow for sharing health records:
 * 1. Receive health-information/request from ABDM (consent-based)
 * 2. Validate consent artefact is still GRANTED and not expired
 * 3. Acknowledge with on-request
 * 4. Look up care contexts from consent artefact
 * 5. Generate FHIR bundles from patient/visit data
 * 6. Encrypt and push to dataPushUrl
 * 7. Send health-information/notify
 *
 * Uses CareContext model and ConsentArtefact model (NOT HealthRecordModel).
 */

export interface HealthInfoRequest {
  transactionId: string;
  hiRequest: {
    consent: {
      id: string; // Consent artefact ID
    };
    dateRange: {
      from: string;
      to: string;
    };
    dataPushUrl: string;
    keyMaterial: ABDMKeyMaterial;
  };
}

// ============================================================================
// Step 1: Acknowledge Health Info Request
// ============================================================================

/**
 * Acknowledge the health information request.
 * POST /hiecm/data-flow/v3/health-information/hip/on-request
 */
const acknowledgeHealthInfoRequest = async (
  request: HealthInfoRequest,
  originalRequestId: string,
  authToken: string,
): Promise<boolean> => {
  try {
    const outboundRequestId = generateUID();
    const payload = {
      requestId: outboundRequestId,
      timestamp: new Date().toISOString(),
      hiRequest: {
        transactionId: request.transactionId,
        sessionStatus: "ACKNOWLEDGED",
      },
      response: {
        requestId: originalRequestId,
      },
    };

    console.log(
      `${LOG_PREFIX} Sending on-request ACK: transactionId=${request.transactionId}, response.requestId=${originalRequestId}, outboundRequestId=${outboundRequestId}`,
    );

    const ackUrl = `${process.env.ABDM_BASE_URL}${ENDPOINTS.HEALTH_INFO_HIP_ON_REQUEST}`;
    console.log(`${LOG_PREFIX} on-request ACK URL: ${ackUrl}`);
    console.log(
      `${LOG_PREFIX} on-request ACK: transactionId=${payload.hiRequest.transactionId}, requestId=${payload.requestId}`,
    );

    const response = await axios.post(ackUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "REQUEST-ID": outboundRequestId,
        TIMESTAMP: new Date().toISOString(),
        "X-CM-ID": X_CM_ID,
        "X-HIP-ID": X_HIP_ID || facilityId,
        Authorization: authToken,
      },
    });

    console.log(
      `${LOG_PREFIX} on-request acknowledged, status: ${response.status}`,
    );
    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    const status = error.response?.status;
    const body = error.response?.data;
    const errCode = body?.error?.code || body?.code;
    const errMsg = body?.error?.message || body?.message || error.message;
    console.error(
      `${LOG_PREFIX} on-request ACK FAILED: status=${status}, code=${errCode}, message=${errMsg}`,
    );
    // Log full error response for debugging (no PHI — this is ABDM's error object, not patient data)
    if (body) {
      console.error(`${LOG_PREFIX} on-request ACK error response:`, JSON.stringify(body));
    }
    if (status === 403 && authToken) {
      try {
        const sessionToken = await AbdmTokenService.getToken();
        const retryRequestId = generateUID();
        const retryPayload = {
          requestId: retryRequestId,
          timestamp: new Date().toISOString(),
          hiRequest: {
            transactionId: request.transactionId,
            sessionStatus: "ACKNOWLEDGED",
          },
          response: { requestId: originalRequestId },
        };
        const retryResponse = await axios.post(
          `${process.env.ABDM_BASE_URL}${ENDPOINTS.HEALTH_INFO_HIP_ON_REQUEST}`,
          retryPayload,
          {
            headers: {
              "Content-Type": "application/json",
              "REQUEST-ID": retryRequestId,
              TIMESTAMP: new Date().toISOString(),
              "X-CM-ID": X_CM_ID,
              "X-HIP-ID": X_HIP_ID || facilityId,
              Authorization: sessionToken,
            },
          },
        );
        if (retryResponse.status === 200 || retryResponse.status === 202) {
          console.log(
            `${LOG_PREFIX} on-request acknowledged on retry with session token, status: ${retryResponse.status}`,
          );
          return true;
        }
      } catch (retryErr: any) {
        console.error(
          `${LOG_PREFIX} on-request retry with session token failed:`,
          retryErr.response?.data || retryErr.message,
        );
      }
    }
    return false;
  }
};

// ============================================================================
// Step 2: Find Care Contexts for Consent
// ============================================================================

/**
 * Find care contexts associated with a consent artefact.
 *
 * Strategy (in order of priority):
 * 1. Use the artefact's care context references (most accurate)
 * 2. Find care contexts directly tagged with this consentId
 * 3. Look up patient via ConsentRequest and find their LINKED/NOTIFIED contexts
 *
 * NEVER falls back to returning unrelated care contexts.
 */
const findCareContextsForConsent = async (
  consentId: string,
  dateRange?: { from: string; to: string },
): Promise<ICareContext[]> => {
  // Strategy 1: Use artefact's care context references (main or PHR collection)
  let artefact = await ConsentArtefactModel.findOne({
    artefactId: consentId,
  });
  if (!artefact) {
    artefact = await PHRConsentArtefactModel.findOne({
      artefactId: consentId,
    });
  }

  if (artefact && artefact.careContexts && artefact.careContexts.length > 0) {
    const careContextRefs = artefact.careContexts.map((cc) =>
      cc.careContextReference.trim(),
    );

    console.log(
      `${LOG_PREFIX} Found ${careContextRefs.length} care context refs in artefact ${consentId}`,
    );

    const contexts = await CareContextModel.find({
      careContextReference: { $in: careContextRefs },
    }).lean();

    if (contexts.length > 0) {
      return contexts as unknown as ICareContext[];
    }

    console.warn(
      `${LOG_PREFIX} Artefact has ${careContextRefs.length} refs but no matching CareContext docs found`,
    );
  }

  // Strategy 2: Direct consentId match on CareContext
  const directMatch = await CareContextModel.find({ consentId }).lean();
  if (directMatch.length > 0) {
    console.log(
      `${LOG_PREFIX} Found ${directMatch.length} care contexts with direct consentId match`,
    );
    return directMatch as unknown as ICareContext[];
  }

  // Strategy 3: Look up patient via ConsentRequest
  const consentRequest = await ConsentRequestModel.findOne({
    $or: [{ consentRequestId: consentId }, { consentArtefacts: consentId }],
  });

  if (!consentRequest) {
    // Also try artefact for patient info
    if (artefact?.patientAbhaAddress) {
      return await findContextsByAbhaAndDateRange(
        artefact.patientAbhaAddress,
        dateRange,
      );
    }

    console.warn(
      `${LOG_PREFIX} No ConsentRequest or ConsentArtefact found for consent ${consentId}`,
    );
    return [];
  }

  return await findContextsByAbhaAndDateRange(
    consentRequest.patientAbhaId,
    dateRange,
  );
};

/**
 * Find LINKED/NOTIFIED care contexts for a specific patient within a date range.
 */
const findContextsByAbhaAndDateRange = async (
  abhaAddress: string,
  dateRange?: { from: string; to: string },
): Promise<ICareContext[]> => {
  const query: any = {
    abhaAddress,
    linkingStatus: { $in: ["LINKED", "NOTIFIED"] },
  };

  if (dateRange) {
    query.createdAt = {
      $gte: new Date(dateRange.from),
      $lte: new Date(dateRange.to),
    };
  }

  const contexts = await CareContextModel.find(query)
    .sort({ createdAt: -1 })
    .lean();

  console.log(
    `${LOG_PREFIX} Found ${contexts.length} LINKED/NOTIFIED contexts for patient ${abhaAddress}`,
  );

  return contexts as unknown as ICareContext[];
};

// ============================================================================
// Step 3: Optional data for FHIR bundle (prescription, lab, SOAP, discharge, immunization)
// ============================================================================

/**
 * Load ALL clinical data for this care context's visit from our DB.
 * Per-HI-type filtering is handled downstream by FHIR bundle service (allowedHiTypes param).
 */
export const getOptionalDataForCareContext = async (
  careContext: ICareContext,
  _consentedHiTypes?: string[],
): Promise<ICombinedBundleOptionalData | undefined> => {
  const visitId = careContext.visitId;
  if (!visitId) return undefined;

  // Fetch ALL clinical data for this visit — FHIR bundle service handles per-type filtering
  const promises: any[] = [];
  // 0: Prescription
  promises.push(VisitPrescriptionModel.findOne({ visitId }).lean());
  // 1: Lab
  promises.push(VisitLabReportModel.findOne({ visitId }).lean());
  // 2: SOAP
  promises.push(VisitSoapNotesModel.findOne({ visitId }).lean());
  // 3: Discharge
  promises.push(VisitDischargeSummaryModel.findOne({ visitId }).lean());
  // 4: Assessment
  promises.push(VisitAssessmentModel.findOne({ visitId }).lean());
  // 5: Billing
  promises.push(VisitDayCareBilling.findOne({ visitId }).lean());
  // 6: Structured Lab Reports (new centralized model — one doc per visit)
  promises.push(LabReportModel.findOne({ visitId }).lean());

  const [
    prescription,
    labReport,
    soapNotes,
    dischargeSummary,
    assessment,
    billing,
    structuredLabs,
  ] = await Promise.all(promises);

  const hasAny =
    (prescription?.medications?.length ?? 0) > 0 ||
    (labReport?.reports?.length ?? 0) > 0 ||
    (structuredLabs?.tests?.length ?? 0) > 0 ||
    (soapNotes &&
      (soapNotes.subjective ||
        soapNotes.objective ||
        soapNotes.assessment ||
        soapNotes.plan)) ||
    (billing && billing.billings && billing.billings.length > 0) ||
    (dischargeSummary &&
      (dischargeSummary.diagnosis ||
        dischargeSummary.clinicalSummary ||
        dischargeSummary.treatmentGiven ||
        (dischargeSummary.dischargeMedications?.length ?? 0) > 0)) ||
    (assessment &&
      ((assessment.vitals && Object.keys(assessment.vitals).length > 0) ||
        (assessment.immunization &&
          (assessment.immunization.covid19Dose1Date ||
            assessment.immunization.covid19Dose2Date ||
            assessment.immunization.tetanusBoosterDate ||
            assessment.immunization.fluVaccineDate ||
            assessment.immunization.covid19Dose1?.date ||
            assessment.immunization.covid19Dose2?.date ||
            assessment.immunization.tetanusBooster?.date ||
            assessment.immunization.fluVaccine?.date)) ||
        assessment.symptomsComplaints ||
        (assessment.documentUploads && assessment.documentUploads.length > 0) ||
        (assessment.medicalHistory?.length ?? 0) > 0 ||
        (assessment.surgicalHistory?.length ?? 0) > 0 ||
        (assessment.personalHistory?.length ?? 0) > 0 ||
        (assessment.additionalDetails?.length ?? 0) > 0));

  if (!hasAny) return undefined;

  return {
    prescription:
      (prescription?.medications?.length ?? 0) > 0
        ? {
            medications: prescription!.medications!,
            advice: prescription!.advice,
          }
        : undefined,
    labReports: labReport?.reports?.length ? labReport.reports : undefined,
    soapNotes: soapNotes
      ? {
          subjective: soapNotes.subjective,
          objective: soapNotes.objective,
          assessment: soapNotes.assessment,
          plan: soapNotes.plan,
        }
      : undefined,
    dischargeSummary: dischargeSummary
      ? {
          diagnosis: dischargeSummary.diagnosis,
          clinicalSummary: dischargeSummary.clinicalSummary,
          treatmentGiven: dischargeSummary.treatmentGiven,
          dischargeMedications: dischargeSummary.dischargeMedications ?? [],
          admissionDate: dischargeSummary.admissionDate,
          dischargeDate: dischargeSummary.dischargeDate,
          ward: dischargeSummary.ward,
          bed: dischargeSummary.bed,
          conditionAtDischarge: dischargeSummary.conditionAtDischarge,
          followUpInstructions: dischargeSummary.followUpInstructions,
          surgicalProcedures: dischargeSummary.surgicalProcedures,
          surgicalNote: dischargeSummary.surgicalNote,
          admissionNotes: dischargeSummary.admissionNotes,
          investigationsResults: dischargeSummary.investigationsResults,
          doctorSignature: dischargeSummary.doctorSignature,
        }
      : undefined,
    assessment: assessment
      ? {
          vitals: assessment.vitals,
          immunization: assessment.immunization ?? undefined,
          symptomsComplaints: assessment.symptomsComplaints,
          medicalHistory: assessment.medicalHistory ?? [],
          surgicalHistory: assessment.surgicalHistory ?? [],
          physicalActivity: assessment.physicalActivity,
          lifestyle: assessment.lifestyle,
          womenHealth: assessment.womenHealth,
          documentUploads: assessment.documentUploads ?? [],
        }
      : undefined,
    billing: billing as any,
    // NEW: Structured lab reports — expand tests[] from the centralized record
    structuredLabReports: await (async () => {
      if (!structuredLabs?.tests?.length) return undefined;
      // Enrich with displayName from templates
      const testTypes = structuredLabs.tests.map((t: any) => t.testType);
      const templates = await LabTestTemplateModel.find({
        testType: { $in: testTypes },
      })
        .select("testType displayName")
        .lean();
      const tplMap = new Map(templates.map((t) => [t.testType, t.displayName]));
      return structuredLabs.tests.map((t: any) => ({
        testType: t.testType,
        displayName: tplMap.get(t.testType) || t.testType,
        sampleId: t.sampleId,
        reportDate: t.reportDate,
        analystName: t.analystName,
        observations: t.observations,
        status: t.status,
        loincCode: t.loincCode,
        loincDisplay: t.loincDisplay,
        parameters: t.parameters || [],
      }));
    })(),
  };
};

// ============================================================================
// Step 4: Push Encrypted Health Data
// ============================================================================

/**
 * Push encrypted health data to the dataPushUrl.
 * When consentedHiTypes is provided, only sections for those hiTypes (intersected with
 * careContext.hiTypes) are included, per ABDM consent-based sharing.
 */
const pushHealthData = async (
  dataPushUrl: string,
  transactionId: string,
  consentId: string,
  careContext: ICareContext,
  keyMaterial: ABDMKeyMaterial,
  authToken: string,
  /** hiTypes from consent artefact; when set, we share only these (∩ careContext.hiTypes) */
  consentedHiTypes?: string[],
  browser?: Browser,
): Promise<boolean> => {
  try {
    // Look up patient: by patientId first, then fallback to UHID/ABHA when ref is orphaned
    let patient = await PatientModel.findById(careContext.patientId);
    if (!patient && careContext.patientReference) {
      patient = await PatientModel.findOne({
        uhid: careContext.patientReference,
      });
      if (patient) {
        console.log(
          `${LOG_PREFIX}- [Push Health Data] Resolved patient by patientReference (UHID) for care context ${careContext._id}, fixing patientId`,
        );
        await CareContextModel.updateOne(
          { _id: careContext._id },
          { $set: { patientId: patient._id } },
        );
      }
    }
    if (!patient && careContext.abhaAddress) {
      patient = await PatientModel.findOne({
        $or: [
          { abhaaddress: careContext.abhaAddress },
          { ABHANumber: careContext.abhaAddress },
        ],
      });
      if (patient) {
        console.log(
          `${LOG_PREFIX} Resolved patient by abhaAddress for care context ${careContext._id}, fixing patientId`,
        );
        await CareContextModel.updateOne(
          { _id: careContext._id },
          { $set: { patientId: patient._id } },
        );
      }
    }
    if (!patient) {
      console.error(
        `${LOG_PREFIX} Patient not found for care context: ${careContext._id} (patientId=${careContext.patientId}, patientRef=${careContext.patientReference}, abha=${careContext.abhaAddress})`,
      );
      return false;
    }

    let visit = await ScanShareVisitModel.findById(careContext.visitId);
    let soaps = await VisitSoapNotesModel.findOne({
      visitId: careContext.visitId,
    });
    if (!visit && careContext.visitId && patient.visits?.length) {
      const visitRef = patient.visits.find(
        (v) => v.visitId?.toString() === careContext.visitId?.toString(),
      );
      if (visitRef) {
        visit = {
          visitDate: visitRef.visitDate,
          department: visitRef.department,
          doctorName: visitRef.doctorName,
          tokenNumber:
            (visitRef as any).tokenNumber ||
            careContext.careContextReference ||
            "N/A",
          visitStatus: visitRef.visitStatus,
          complaint: soaps?.subjective ?? undefined,
          consultationFee: visitRef.consultationFee ?? 0,
          counterId: "",
        } as any;
      }
    }
    if (!visit) {
      console.error(
        `${LOG_PREFIX} Visit not found for care context: ${careContext._id}`,
      );
      return false;
    }
    visit = {
      ...visit,
      complaint: soaps?.subjective ?? undefined,
    } as any;

    // Determine which HI types to push: intersection of CareContext.hiTypes and consent
    const contextHiTypes =
      Array.isArray(careContext.hiTypes) && careContext.hiTypes.length > 0
        ? careContext.hiTypes
        : careContext.hiType
          ? [careContext.hiType]
          : [];

    if (contextHiTypes.length === 0) {
      console.warn(
        `${LOG_PREFIX} Skipping ${careContext.careContextReference}: no hiTypes on CareContext`,
      );
      return false;
    }

    const applicableHiTypes =
      consentedHiTypes && consentedHiTypes.length > 0
        ? contextHiTypes.filter((t) => consentedHiTypes.includes(t))
        : contextHiTypes;

    if (applicableHiTypes.length === 0) {
      console.log(
        `${LOG_PREFIX} Skipping ${careContext.careContextReference}: no matching hiTypes between CareContext(${contextHiTypes}) and consent(${consentedHiTypes})`,
      );
      return false;
    }

    console.log(
      `${LOG_PREFIX} CareContext ${careContext.careContextReference}: will push ${applicableHiTypes.length} bundle(s) for hiTypes: ${JSON.stringify(applicableHiTypes)}`,
    );

    // Load ALL clinical data once (per-type filtering handled by FHIR bundle service)
    const optionalData = await getOptionalDataForCareContext(careContext);

    // Detailed logging: show what clinical data was found
    const clinicalDataFound: string[] = [];
    if (optionalData?.prescription?.medications?.length) {
      clinicalDataFound.push(
        `Prescription(${optionalData.prescription.medications.length} meds)`,
      );
    }
    if (optionalData?.labReports?.length) {
      clinicalDataFound.push(`LabReports(${optionalData.labReports.length})`);
    }
    if (
      optionalData?.soapNotes &&
      (optionalData.soapNotes.subjective ||
        optionalData.soapNotes.objective ||
        optionalData.soapNotes.assessment ||
        optionalData.soapNotes.plan)
    ) {
      clinicalDataFound.push("SOAPNotes");
    }
    if (
      optionalData?.dischargeSummary &&
      (optionalData.dischargeSummary.diagnosis ||
        optionalData.dischargeSummary.clinicalSummary)
    ) {
      clinicalDataFound.push("DischargeSummary");
    }
    if (
      optionalData?.assessment &&
      (optionalData.assessment.vitals ||
        optionalData.assessment.immunization ||
        optionalData.assessment.symptomsComplaints)
    ) {
      clinicalDataFound.push("Assessment");
    }

    if (clinicalDataFound.length > 0) {
      console.log(
        `${LOG_PREFIX} Clinical data found for ${careContext.careContextReference}: ${clinicalDataFound.join(", ")}`,
      );
    } else {
      console.warn(
        `${LOG_PREFIX} ⚠️ NO clinical data found for ${careContext.careContextReference} (visitId=${careContext.visitId}). FHIR bundles will be minimal.`,
      );
    }

    // ── Phase 1: PRE-GENERATE all FHIR bundles & encrypt payloads ──
    // Separating generation (slow: Puppeteer PDFs) from push (fast: HTTP)
    // prevents ABDM transaction timeout when multiple HI types are pushed.
    let allPushed = true;
    const preparedPayloads: Array<{
      hiType: string;
      payload: any;
      fhirBundleSize: number;
      entryCount: number;
    }> = [];

    for (const hiType of applicableHiTypes) {
      try {
        console.log(
          `${LOG_PREFIX} Generating FHIR bundle for ${careContext.careContextReference} [${hiType}]`,
        );
        const fhirBundle = await generateFhirBundle(
          hiType,
          patient,
          visit as any,
          careContext,
          optionalData,
          browser,
        );
        const fhirBundleJson = JSON.stringify(fhirBundle);
        const entryCount = fhirBundle.entry?.length || 0;
        console.log(
          `${LOG_PREFIX} FHIR bundle [${hiType}]: ${fhirBundleJson.length} chars, ${entryCount} entries`,
        );

        // Guard: ImmunizationRecord bundles need at least one Immunization resource
        if (
          hiType === "ImmunizationRecord" &&
          entryCount <= 5 &&
          !fhirBundle.entry?.some(
            (e: any) => e.resource?.resourceType === "Immunization",
          )
        ) {
          console.warn(
            `${LOG_PREFIX} Skipping push for ${careContext.careContextReference} [${hiType}]: ImmunizationRecord bundle has no Immunization resources`,
          );
          continue;
        }

        // Guard: Skip empty bundles (only base entries: Composition + Patient + Org + Practitioner + Encounter)
        if (entryCount <= 5) {
          console.log(
            `${LOG_PREFIX} Skipping push for ${careContext.careContextReference} [${hiType}]: bundle has only base entries (${entryCount})`,
          );
          continue;
        }

        // Build encrypted payload
        let payload: any;
        try {
          payload = buildDataPushPayload(
            fhirBundleJson,
            transactionId,
            careContext.careContextReference,
            keyMaterial,
          );
        } catch (encErr: any) {
          console.error(
            `${LOG_PREFIX} Encryption failed for ${careContext.careContextReference} [${hiType}]: ${encErr.message}`,
          );
          allPushed = false;
          continue;
        }

        const keyVal = payload?.keyMaterial?.dhPublicKey?.keyValue ?? "";
        console.log(
          `${LOG_PREFIX} Pre-generated payload [${hiType}] keyValue length=${keyVal.length} careContext=${careContext.careContextReference}`,
        );

        preparedPayloads.push({
          hiType,
          payload,
          fhirBundleSize: fhirBundleJson.length,
          entryCount,
        });
      } catch (genErr: any) {
        console.error(
          `${LOG_PREFIX} Bundle generation failed for ${careContext.careContextReference} [${hiType}]:`,
          genErr.message,
        );
        allPushed = false;
      }
    }

    // ── Phase 2: PUSH all pre-generated payloads rapidly ──
    // All slow work (PDF gen, encryption) is done. Push quickly before transaction expires.
    if (preparedPayloads.length > 0) {
      console.log(
        `${LOG_PREFIX} Pushing ${preparedPayloads.length} pre-generated payload(s) for ${careContext.careContextReference}`,
      );
    }

    for (const { hiType, payload } of preparedPayloads) {
      let pushSuccess = false;
      const MAX_RETRIES = 3;
      let consecutiveAbdm1017 = 0; // Track persistent ABDM-1017 for early exit

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const requestId = generateUID();
          if (attempt > 0) {
            console.log(
              `${LOG_PREFIX} Retry #${attempt} for [${hiType}] push to: ${dataPushUrl}`,
            );
          } else {
            console.log(
              `${LOG_PREFIX} Pushing [${hiType}] data to: ${dataPushUrl}`,
            );
          }

          const response = await axios.post(dataPushUrl, payload, {
            headers: {
              "Content-Type": "application/json",
              "REQUEST-ID": requestId,
              TIMESTAMP: new Date().toISOString(),
              "X-CM-ID": X_CM_ID,
              "X-HIP-ID": X_HIP_ID || facilityId,
              Authorization: authToken,
            },
          });

          console.log(
            `${LOG_PREFIX} Data [${hiType}] pushed successfully, status: ${response.status}, careContext: ${careContext.careContextReference}${attempt > 0 ? ` (after ${attempt} retries)` : ""}`,
          );
          pushSuccess = true;
          break; // Success — exit retry loop
        } catch (pushErr: any) {
          const errCode = pushErr.response?.data?.code;
          const errStatus = pushErr.response?.status;
          const isAbdm1017 = errCode === "ABDM-1017";
          const isTransient = isAbdm1017 || (errStatus && errStatus >= 500);

          // Track consecutive ABDM-1017 errors.
          // If the PHR app already received this data under another consent,
          // the transaction is permanently invalid — retries are futile.
          if (isAbdm1017) {
            consecutiveAbdm1017++;
            if (consecutiveAbdm1017 >= 2) {
              console.error(
                `${LOG_PREFIX} ABDM-1017 persisted ${consecutiveAbdm1017} times for [${hiType}] — transaction is permanently invalid (likely already fulfilled under another consent). Stopping retries.`,
              );
              break;
            }
          } else {
            consecutiveAbdm1017 = 0;
          }

          // 5xx: Gateway is temporarily unavailable.
          // ABDM-1017 on first occurrence: Gateway may not have processed ACK yet.
          // Retry with exponential backoff.
          if (isTransient && attempt < MAX_RETRIES) {
            const backoffMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
            console.warn(
              `${LOG_PREFIX} Transient error (${errCode || errStatus}) on attempt ${attempt + 1}/${MAX_RETRIES + 1} for [${hiType}]. Retrying in ${backoffMs / 1000}s...`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // ── GUARANTEED DELIVERY ──
          // If inline retries are exhausted on a TRANSIENT error, throw so BullMQ
          // retries the entire job later. The data is NOT lost.
          if (isTransient && attempt >= MAX_RETRIES) {
            console.error(
              `${LOG_PREFIX} Transient error (${errCode || errStatus}) persisted after ${MAX_RETRIES + 1} inline attempts for [${hiType}]. Escalating to BullMQ for background retry.`,
            );
            throw new TransientDataPushError(
              errCode || `HTTP_${errStatus}`,
              `Push failed for ${careContext.careContextReference} [${hiType}] after ${MAX_RETRIES + 1} attempts: ${errCode || errStatus}`,
              attempt + 1,
            );
          }

          // Non-transient, non-retryable error (400 bad payload, 401 auth, 404 etc.)
          // These won't fix themselves on retry — log and mark as permanently failed.
          console.error(
            `${LOG_PREFIX} Non-retryable push failure for ${careContext.careContextReference} [${hiType}]:`,
            errStatus,
            pushErr.response?.statusText || pushErr.message,
          );
          AbdmLogger.logRejected({
            consentId: careContext.consentId || "unknown",
            reason: `PUSH_FAILED [${hiType}]: ${pushErr.message}${errCode ? ` (${errCode})` : ""}`,
            routePath: dataPushUrl,
          });
        }
      }

      if (!pushSuccess) {
        allPushed = false;
      }
    }

    // Update care context with data transfer status
    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          dataTransferStatus: allPushed
            ? DataTransferStatus.TRANSFERRED
            : DataTransferStatus.FAILED,
          dataTransferredAt: new Date(),
          transactionId,
          dataPushUrl,
          dataTransferError: allPushed
            ? null
            : { message: "One or more bundle pushes failed" },
        },
      },
    );

    return allPushed;
  } catch (error: any) {
    // The user requested removing BullMQ queueing entirely.
    // If we hit a transient error and exhaust all inline retries, we now
    // immediately send the FAILED notification to ABDM to unlock the consent.
    if (error instanceof TransientDataPushError) {
      console.error(
        `${LOG_PREFIX} Data push failed for ${careContext.careContextReference} after all inline retries. Sending FAILED notification to ABDM.`,
      );
      await CareContextModel.updateOne(
        { _id: careContext._id },
        {
          $set: {
            dataTransferStatus: DataTransferStatus.FAILED,
            transactionId,
            dataTransferError: { message: error.message, code: error.code },
          },
        },
      );
      
      // We must notify ABDM that the session failed so it doesn't get permanently stuck
      try {
        await sendFailedTransferNotification(consentId, transactionId);
      } catch (notifyErr: any) {
        console.error(`${LOG_PREFIX} Failed to send FAILED notification:`, notifyErr.message);
      }
      return false;
    }

    // Non-transient errors (patient lookup, FHIR generation, encryption)
    console.error(
      `${LOG_PREFIX} Data push failed for ${careContext.careContextReference}:<>`,
      error.response?.status,
      error.response?.statusText || error.message,
    );
    if (!error.response) {
      console.error(`${LOG_PREFIX} Error stack:`, error.stack);
    }

    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          dataTransferStatus: DataTransferStatus.FAILED,
          transactionId,
          dataTransferError: error.response?.data || { message: error.message },
        },
      },
    );

    return false;
  }
};

// ============================================================================
// Step 4: Notify ABDM About Transfer
// ============================================================================

/**
 * Notify ABDM about health information transfer completion.
 * POST /hiecm/data-flow/v3/health-information/notify
 */
const notifyHealthInfoTransfer = async (
  consentId: string,
  transactionId: string,
  careContexts: ICareContext[],
  authToken: string,
): Promise<boolean> => {
  try {
    const requestId = generateUID();

    const statusResponses = careContexts.map((cc) => ({
      careContextReference: cc.careContextReference,
      hiStatus:
        cc.dataTransferStatus === DataTransferStatus.TRANSFERRED
          ? "DELIVERED"
          : "ERRORED",
      description:
        cc.dataTransferStatus === DataTransferStatus.TRANSFERRED
          ? "Health information transferred successfully"
          : "Failed to transfer health information",
    }));

    const allTransferred = statusResponses.every(
      (s) => s.hiStatus === "DELIVERED",
    );

    const payload = {
      notification: {
        consentId,
        transactionId,
        doneAt: new Date().toISOString(),
        notifier: {
          type: "HIP",
          id: facilityId,
        },
        statusNotification: {
          sessionStatus: allTransferred ? "TRANSFERRED" : "FAILED",
          hipId: facilityId,
          statusResponses,
        },
      },
    };

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}${ENDPOINTS.HEALTH_INFO_NOTIFY}`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": X_HIP_ID || facilityId,
          Authorization: authToken,
        },
      },
    );

    console.log(
      `${LOG_PREFIX} Transfer notification sent, status: ${response.status}, session: ${allTransferred ? "TRANSFERRED" : "FAILED"}`,
    );

    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Transfer notification failed:`,
      error.response?.data || error.message,
    );
    return false;
  }
};

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Process a health information request end-to-end.
 *
 * Called when ABDM sends POST /api/v3/hip/health-information/request
 *
 * Flow:
 * 1. Validate consent artefact (GRANTED, not expired)
 * 2. Acknowledge the request (on-request)
 * 3. Find care contexts for this consent
 * 4. Generate FHIR bundles, encrypt, push to dataPushUrl
 * 5. Notify ABDM about transfer completion
 */
const processHealthInfoRequest = async (
  request: HealthInfoRequest,
  requestId: string,
  abdmCallbackAuth: string,
): Promise<void> => {
  const { transactionId, hiRequest } = request;
  const { consent, dataPushUrl, keyMaterial, dateRange } = hiRequest;
  const consentId = consent.id;

  console.log(
    `${LOG_PREFIX} Processing request for consent: ${consentId}, transaction: ${transactionId}`,
  );

  // --- SECURITY: Validate dataPushUrl before any processing ---
  if (!isValidDataPushUrl(dataPushUrl)) {
    console.error(
      `${LOG_PREFIX} [SECURITY] Rejecting health-info request — invalid dataPushUrl: ${dataPushUrl}`,
    );
    return;
  }

  // --- LAYER 1: LOCAL IN-MEMORY LOCK (by transactionId) ---
  // Lock on transactionId (not consentId) so that the same ABDM request isn't
  // processed twice, but different requests for the same consent (e.g. after
  // clinical data update) ARE allowed through.
  if (activeConsentProcessing.has(transactionId)) {
    console.warn(
      `${LOG_PREFIX} Duplicate blocked (in-memory)! Transaction ${transactionId} already processing. Skipping.`,
    );
    return;
  }

  // --- LAYER 2: REDIS DISTRIBUTED LOCK (by transactionId) ---
  // Prevents the same transactionId from being processed concurrently across
  // PM2 clusters / multiple server instances.
  let useRedisLock = false;
  try {
    const { acquireConsentLock } = await import(
      "./abdm.queue.service"
    );

    // Acquire distributed lock keyed on transactionId
    const lockAcquired = await acquireConsentLock(transactionId);
    if (!lockAcquired) {
      console.warn(
        `${LOG_PREFIX} Duplicate blocked (Redis lock)! Transaction ${transactionId} already locked. Skipping.`,
      );
      return;
    }
    useRedisLock = true;
  } catch (redisErr: any) {
    console.warn(
      `${LOG_PREFIX} Redis unavailable for lock (${redisErr.message}), using in-memory only`,
    );
  }

  // Set in-memory lock (local instance dedup)
  activeConsentProcessing.add(transactionId);

  // Helper to release both locks cleanly.
  const releaseLock = async () => {
    activeConsentProcessing.delete(transactionId);
    if (useRedisLock) {
      try {
        const { releaseConsentLock } = await import("./abdm.queue.service");
        await releaseConsentLock(transactionId);
      } catch (_) {}
    }
  };

  // Auto-expire the lock as a fallback after 120 seconds.
  const lockTimeout = setTimeout(() => {
    releaseLock();
  }, 120000);

  // --- DB IDEMPOTENCY CHECK (For duplicate webhooks with same transactionId) ---
  // Only block if this exact transactionId is already ACKNOWLEDGED (in-progress)
  // or TRANSFERRED (successfully completed). FAILED status must NOT block retries —
  // BullMQ retries depend on being able to re-process after a TransientDataPushError.
  const existingProcessing = await CareContextModel.findOne({
    transactionId: transactionId,
    dataTransferStatus: {
      $in: [
        DataTransferStatus.ACKNOWLEDGED,
        DataTransferStatus.TRANSFERRED,
      ],
    },
  }).lean();

  if (existingProcessing) {
    console.warn(
      `${LOG_PREFIX} Transaction ${transactionId} already ${existingProcessing.dataTransferStatus}. Skipping duplicate.`,
    );
    await releaseLock();
    clearTimeout(lockTimeout);
    return;
  }


  // Always use a fresh session token for data push & notification.
  let abdmToken: string;
  try {
    abdmToken = await AbdmTokenService.getToken();
    console.log(`${LOG_PREFIX} Using session token for data flow`);
  } catch (tokenError: any) {
    if (abdmCallbackAuth && abdmCallbackAuth.trim()) {
      abdmToken = abdmCallbackAuth.trim();
      if (!abdmToken.toLowerCase().startsWith("bearer ")) {
        abdmToken = `Bearer ${abdmToken}`;
      }
      console.warn(
        `${LOG_PREFIX} Session token failed, falling back to callback auth: ${tokenError.message}`,
      );
    } else {
      console.error(
        `${LOG_PREFIX} No session token and no callback token available:`,
        tokenError.message,
      );
      releaseLock();
      clearTimeout(lockTimeout);
      return;
    }
  }

  let careContexts: ICareContext[] = [];
  try {
    // Step 0: Validate consent artefact — MUST be GRANTED to serve data
    let artefact = await ConsentService.validateConsentForDataPush(consentId);

    if (artefact === null) {
      // Check if artefact exists but is not GRANTED (REVOKED / EXPIRED / DENIED)
      let existingArtefact = await ConsentArtefactModel.findOne({
        artefactId: consentId,
      });
      if (!existingArtefact) {
        existingArtefact = await PHRConsentArtefactModel.findOne({
          artefactId: consentId,
        });
      }

      if (
        existingArtefact &&
        existingArtefact.status !== ConsentArtefactStatus.GRANTED
      ) {
        // SECURITY: Never re-activate a revoked/expired/denied consent.
        // Acknowledge the request so ABDM doesn't keep retrying, but refuse to push data.
        console.error(
          `${LOG_PREFIX} [SECURITY] Consent ${consentId} is ${existingArtefact.status} — refusing to serve data. ` +
            `ABDM sent health-info request but our consent lifecycle shows it is no longer valid.`,
        );
        await acknowledgeHealthInfoRequest(request, requestId, abdmToken);
        await releaseLock();
        clearTimeout(lockTimeout);
        return;
      }

      if (!existingArtefact) {
        // Artefact not in our DB at all. ABDM may send health-info/request
        // before the on-fetch callback creates the artefact. Acknowledge and
        // proceed — findCareContextsForConsent will resolve care contexts
        // via ConsentRequest if available.
        console.warn(
          `${LOG_PREFIX} No consent artefact found for ${consentId}. ABDM sent health-info request — proceeding without artefact (on-fetch may be delayed).`,
        );
      }
    }

    // Step 1: Acknowledge the request
    const acknowledged = await acknowledgeHealthInfoRequest(
      request,
      requestId,
      abdmToken,
    );

    if (!acknowledged) {
      console.error(`${LOG_PREFIX} Failed to acknowledge request`);
      return;
    }

    // The ABDM sandbox PHR app needs time to register the transaction after the
    // gateway processes our ACK. Without this delay, the PHR returns ABDM-1017
    // (Invalid Transaction Id) because it hasn't set up the transaction yet.
    // The inline retry logic (2s/4s/8s backoff) in pushHealthData provides
    // additional resilience for edge cases.
    const STABILIZATION_DELAY_MS = 5000;
    console.log(`${LOG_PREFIX} Waiting ${STABILIZATION_DELAY_MS / 1000}s for ABDM to activate transaction before pushing data...`);
    await new Promise((resolve) => setTimeout(resolve, STABILIZATION_DELAY_MS));

    // Step 2: Find care contexts for this consent
    careContexts = await findCareContextsForConsent(consentId, dateRange);

    if (careContexts.length === 0) {
      console.warn(
        `${LOG_PREFIX} No care contexts found for consent: ${consentId}. Request already acknowledged; skipping transfer notification (ABDM requires non-empty statusResponses).`,
      );
      // Request already acknowledged in Step 1. ABDM requires statusResponses to be non-empty,
      // so we cannot send a notification with empty care contexts. ABDM will handle timeout/retry if needed.
      return;
    }

    console.log(
      `${LOG_PREFIX} Found ${careContexts.length} care contexts for consent: ${consentId}`,
    );

    // Mark care contexts with consent and transaction IDs
    const contextIds = careContexts.map((cc) => cc._id);
    await CareContextModel.updateMany(
      { _id: { $in: contextIds } },
      {
        $set: {
          consentId,
          transactionId,
          dataTransferStatus: DataTransferStatus.ACKNOWLEDGED,
        },
      },
    );

    // Step 3: Push health data for each care context (only consented hiTypes when artefact available)
    // Process SEQUENTIALLY to avoid memory overload from concurrent Puppeteer pages
    // and to keep all pushes within the ABDM transaction window.
    const consentedHiTypes = artefact?.hiTypes;

    // Track push results in-memory to avoid concurrent DB overwrite issues
    const pushResults: any[] = [];

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", // Prevent /dev/shm OOM in containers
          "--disable-gpu",
        ],
      });

      console.log(
        `${LOG_PREFIX} Launched shared browser for ${careContexts.length} contexts`,
      );

      for (const cc of careContexts) {
        try {
          const success = await pushHealthData(
            dataPushUrl,
            transactionId,
            consentId,
            cc,
            keyMaterial,
            abdmToken,
            consentedHiTypes,
            browser,
          );
          pushResults.push({
            ...cc,
            dataTransferStatus: success ? DataTransferStatus.TRANSFERRED : DataTransferStatus.FAILED
          });
        } catch (err: any) {
          pushResults.push({
            ...cc,
            dataTransferStatus: DataTransferStatus.FAILED
          });
          
          // ── GUARANTEED DELIVERY ──
          // TransientDataPushError = gateway is temporarily unavailable.
          // Let it propagate to BullMQ so the entire job is retried later.
          // Do NOT swallow this — swallowing it means permanent data loss.
          if (err instanceof TransientDataPushError) {
            console.error(
              `${LOG_PREFIX} Transient failure for ${cc.careContextReference} (${err.code}). Escalating to BullMQ retry queue.`,
            );
            // Close browser before re-throwing to avoid resource leak
            if (browser) {
              await browser.close().catch(() => {});
              browser = undefined;
            }
            throw err;
          }

          // Non-transient errors (bad data, encryption failure, etc.)
          // These won't fix themselves on retry — log and continue with other care contexts.
          console.error(
            `${LOG_PREFIX} Non-retryable failure for ${cc.careContextReference}:`,
            err.message,
          );
        }
      }
    } catch (err: any) {
      // Re-throw transient errors so they reach BullMQ for retry
      if (err instanceof TransientDataPushError) {
        throw err;
      }
      console.error(`${LOG_PREFIX} Error during data push:`, err.message);
    } finally {
      if (browser) {
        await browser.close();
        console.log(`${LOG_PREFIX} Closed shared browser`);
      }
    }

    // Step 4: Notify ABDM about the transfer using in-memory results
    // This prevents race conditions where a concurrent abandoned transaction 
    // overwrites the DB status to FAILED right before we read it.
    await notifyHealthInfoTransfer(
      consentId,
      transactionId,
      pushResults as unknown as ICareContext[],
      abdmToken,
    );

    console.log(
      `${LOG_PREFIX} Request processing complete for consent: ${consentId}`,
    );
  } catch (error: any) {
    // ── GUARANTEED DELIVERY ──
    // TransientDataPushError must propagate to BullMQ for automatic retry.
    // Release the lock first (in finally below), then re-throw.
    if (error instanceof TransientDataPushError) {
      console.error(
        `${LOG_PREFIX} Transient error for consent ${consentId}: ${error.message}. Will be retried by BullMQ.`,
      );
      // Don't notify ABDM about failure — we'll retry and succeed later
      throw error; // ← This is caught by finally (lock release) then propagates to BullMQ
    }

    console.error(
      `${LOG_PREFIX} Error processing request for consent ${consentId}:`,
      error.message,
    );

    // Notify ABDM about the failure only if we have care contexts to report status for
    // (ABDM requires non-empty statusResponses, so we can't notify with empty array)
    if (careContexts && careContexts.length > 0) {
      try {
        await notifyHealthInfoTransfer(
          consentId,
          transactionId,
          careContexts,
          abdmToken,
        );
      } catch (notifyError: any) {
        console.error(
          `${LOG_PREFIX} Failed to send failure notification:`,
          notifyError.message,
        );
      }
    } else {
      console.warn(
        `${LOG_PREFIX} Cannot send failure notification: no care contexts to report status for (ABDM requires non-empty statusResponses).`,
      );
    }
  } finally {
    // ALWAYS release the lock — whether success or failure.
    // A stale lock blocks all future requests for this consent until TTL expires.
    await releaseLock();
    clearTimeout(lockTimeout);
  }
};

// ============================================================================
// Send FAILED transfer notification (for permanent failures)
// ============================================================================

/**
 * Send a FAILED transfer notification to ABDM when all retries are exhausted.
 * Per ABDM M2 spec Section 6.3.6, HIP must notify CM about transfer failure
 * so the consent can be released for future requests.
 */
const sendFailedTransferNotification = async (
  consentId: string,
  transactionId: string,
): Promise<void> => {
  try {
    const abdmToken = await AbdmTokenService.getToken();
    const requestId = generateUID();

    // Find care contexts for this consent to build statusResponses
    const careContexts = await CareContextModel.find({
      transactionId,
    }).lean();

    const statusResponses = careContexts.length > 0
      ? careContexts.map((cc: any) => ({
          careContextReference: cc.careContextReference,
          hiStatus: "ERRORED",
          description: "Data push permanently failed after all retries",
        }))
      : [{ careContextReference: "unknown", hiStatus: "ERRORED", description: "Data push permanently failed" }];

    const payload = {
      notification: {
        consentId,
        transactionId,
        doneAt: new Date().toISOString(),
        notifier: { type: "HIP", id: facilityId },
        statusNotification: {
          sessionStatus: "FAILED",
          hipId: facilityId,
          statusResponses,
        },
      },
    };

    const url = `${process.env.ABDM_BASE_URL}${ENDPOINTS.HEALTH_INFO_NOTIFY}`;
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${abdmToken}`,
        "REQUEST-ID": requestId,
        TIMESTAMP: new Date().toISOString(),
        "X-CM-ID": X_CM_ID,
        "Content-Type": "application/json",
      },
    });

    console.log(
      `${LOG_PREFIX} Sent FAILED transfer notification to ABDM for consent ${consentId}, status: ${response.status}`,
    );
  } catch (err: any) {
    console.error(
      `${LOG_PREFIX} Failed to send FAILED notification for consent ${consentId}:`,
      err.response?.status,
      err.response?.data || err.message,
    );
  }
};

// ============================================================================
// Export
// ============================================================================

export const HealthInformationService = {
  acknowledgeHealthInfoRequest,
  findCareContextsForConsent,
  pushHealthData,
  notifyHealthInfoTransfer,
  processHealthInfoRequest,
  sendFailedTransferNotification,
};

export default HealthInformationService;
