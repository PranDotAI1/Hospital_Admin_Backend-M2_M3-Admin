import axios from "axios";
import puppeteer, { Browser } from "puppeteer";
import {
  CareContextModel,
  ICareContext,
  DataTransferStatus,
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
import {
  FhirBundleService,
  ICombinedBundleOptionalData,
} from "./fhir.bundle.service";

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
      `${LOG_PREFIX} on-request ACK payload: ${JSON.stringify(payload)}`,
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
      `${LOG_PREFIX} on-request acknowledged, status: ${response.status}, responseBody: ${JSON.stringify(response.data)}`,
    );
    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    const status = error.response?.status;
    const body = error.response?.data;
    console.error(
      `${LOG_PREFIX} on-request acknowledgment failed: status=${status}, body=${JSON.stringify(body || error.message)}`,
    );
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
 * Load real clinical data for this care context from our DB (visit_prescriptions, visit_lab_reports, etc.).
 * Used when building the FHIR bundle for pull records so we send actual saved data, not placeholders.
 */
const getOptionalDataForCareContext = async (
  careContext: ICareContext,
  consentedHiTypes?: string[],
): Promise<ICombinedBundleOptionalData | undefined> => {
  const visitId = careContext.visitId;
  if (!visitId) return undefined;

  // For per-type CareContexts (new model), use the careContext's own hiType as the data constraint.
  // For legacy multi-type CareContexts, fall back to consent-based filtering.
  const careContextType = careContext.hiType;
  const shouldFetch = (relatedHiTypes: string[]) => {
    if (careContextType) {
      // Per-type CareContext: only fetch data relevant to this specific HI type
      return relatedHiTypes.includes(careContextType);
    }
    // Legacy CareContext: use consent-based filtering
    if (!consentedHiTypes || consentedHiTypes.length === 0) return true;
    return relatedHiTypes.some((t) => consentedHiTypes.includes(t));
  };

  const promises: any[] = [];
  // 0: Prescription
  promises.push(
    shouldFetch(["Prescription"])
      ? VisitPrescriptionModel.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );
  // 1: Lab
  promises.push(
    shouldFetch(["DiagnosticReport"])
      ? VisitLabReportModel.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );
  // 2: SOAP
  promises.push(
    shouldFetch(["OPConsultation", "HealthDocumentRecord", "WellnessRecord"])
      ? VisitSoapNotesModel.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );
  // 3: Discharge
  promises.push(
    shouldFetch(["DischargeSummary"])
      ? VisitDischargeSummaryModel.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );
  // 4: Assessment
  promises.push(
    shouldFetch([
      "OPConsultation",
      "WellnessRecord",
      "ImmunizationRecord",
      "HealthDocumentRecord",
    ])
      ? VisitAssessmentModel.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );
  // 5: Billing
  promises.push(
    shouldFetch(["Invoice", "OPConsultation"])
      ? VisitDayCareBilling.findOne({ visitId }).lean()
      : Promise.resolve(null),
  );

  const [
    prescription,
    labReport,
    soapNotes,
    dischargeSummary,
    assessment,
    billing,
  ] = await Promise.all(promises);

  const hasAny =
    (prescription?.medications?.length ?? 0) > 0 ||
    (labReport?.reports?.length ?? 0) > 0 ||
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
          personalHistory: assessment.personalHistory ?? [],
          additionalDetails: assessment.additionalDetails ?? [],
          documentUploads: assessment.documentUploads ?? [],
        }
      : undefined,
    billing: billing as any,
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

    // Load optional real data (prescription, lab, SOAP, discharge, immunization) when available
    const optionalData = await getOptionalDataForCareContext(
      careContext,
      consentedHiTypes,
    );

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
        `${LOG_PREFIX} ⚠️ NO clinical data found for ${careContext.careContextReference} (visitId=${careContext.visitId}). FHIR bundle will be minimal.`,
      );
    }

    // Generate FHIR bundle using the combined generator for both new and legacy CareContexts.
    // For new per-type CareContexts, we filter to just the single hiType via allowedHiTypes.
    // This ensures identical output quality (PDFs, formatting, SNOMED codes) regardless of CareContext type.
    const effectiveHiType = careContext.hiType; // single type for new per-type CareContexts
    const careContextHiTypes = effectiveHiType
      ? [effectiveHiType]
      : careContext.hiTypes || [];

    // Intersect with consented HI types if consent provides them
    const allowedHiTypes =
      consentedHiTypes && consentedHiTypes.length > 0
        ? (careContextHiTypes.filter((t) =>
            consentedHiTypes.includes(t),
          ) as import("../models/CareContext").HIType[])
        : effectiveHiType
          ? ([effectiveHiType] as import("../models/CareContext").HIType[])
          : undefined;

    // Skip if consent doesn't include any of this CareContext's HI types
    if (allowedHiTypes && allowedHiTypes.length === 0) {
      console.log(
        `${LOG_PREFIX} Skipping ${careContext.careContextReference}: no matching hiTypes between CareContext and consent`,
      );
      return false;
    }

    // Both per-HI-type and legacy CareContexts use the proven combined bundle generator.
    // For per-HI-type: pass [hiType] as allowedHiTypes to filter to just that type.
    // For legacy: pass consent-derived allowedHiTypes for multi-type filtering.
    const hiTypeFilter = effectiveHiType ? [effectiveHiType] : allowedHiTypes;
    let fhirBundle: any;
    console.log(
      `${LOG_PREFIX} Generating FHIR bundle for ${careContext.careContextReference} (hiTypeFilter: ${JSON.stringify(hiTypeFilter)})`,
    );
    fhirBundle = await FhirBundleService.generateCombinedBundleForCareContext(
      patient,
      visit as any,
      careContext,
      optionalData,
      hiTypeFilter,
      browser,
    );
    const fhirBundleJson = JSON.stringify(fhirBundle);
    const entryCount = fhirBundle.entry?.length || 0;
    console.log(
      `${LOG_PREFIX} FHIR bundle generated: ${fhirBundleJson.length} chars, ${entryCount} entries`,
    );

    // Guard: ImmunizationRecord bundles need at least one Immunization resource
    // (base bundle has 5 entries: Composition + Patient + Org + Practitioner + Encounter)
    if (
      effectiveHiType === "ImmunizationRecord" &&
      entryCount <= 5 &&
      !fhirBundle.entry?.some(
        (e: any) => e.resource?.resourceType === "Immunization",
      )
    ) {
      console.warn(
        `${LOG_PREFIX} Skipping push for ${careContext.careContextReference}: ImmunizationRecord bundle has no Immunization resources`,
      );
      return false;
    }

    // Build encrypted payload (can throw if keyMaterial is invalid)
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
        `${LOG_PREFIX} Data push failed for -- ${careContext.careContextReference} --: ${encErr.message}`,
      );
      return false;
    }

    const keyVal = payload?.keyMaterial?.dhPublicKey?.keyValue ?? "";
    console.log(
      `${LOG_PREFIX} Data push keyValue length=${keyVal.length} (expected 88 per ABDM: 04+X+Y=65 bytes) first2="${keyVal.slice(0, 2)}" last2="${keyVal.slice(-2)}" careContext=${careContext.careContextReference}`,
    );

    const requestId = generateUID();

    // Log the push URL and key details for debugging
    console.log(`${LOG_PREFIX} Pushing data to: ${dataPushUrl}`);
    console.log(
      `${LOG_PREFIX} TransactionId: ${transactionId}, CareContext: ${careContext.careContextReference}`,
    );

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
      `${LOG_PREFIX} Data pushed successfully, status: ${response.status}, careContext: ${careContext.careContextReference}`,
    );

    // Update care context with data transfer status
    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          dataTransferStatus: DataTransferStatus.TRANSFERRED,
          dataTransferredAt: new Date(),
          transactionId,
          dataPushUrl,
          dataTransferError: null,
        },
      },
    );

    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    // Outer catch for non-push errors (patient lookup, FHIR generation, encryption)
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
      return;
    }
  }

  let careContexts: ICareContext[] = [];
  try {
    // Step 0: Validate consent artefact
    const artefact = await ConsentService.validateConsentForDataPush(consentId);

    if (artefact === null) {
      // Artefact not found or not yet fetched -- this is OK, ABDM may send
      // health-info/request before the artefact on-fetch callback arrives.
      // We proceed but log a warning.
      console.warn(
        `${LOG_PREFIX} No valid artefact found for consent ${consentId}. Proceeding with care context lookup.`,
      );
    }

    // If artefact was explicitly blocked (REVOKED/EXPIRED returns null),
    // we need to check if it was found but invalid
    if (artefact === null) {
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
        console.error(
          `${LOG_PREFIX} Consent ${consentId} is ${existingArtefact.status}. Cannot fulfill request.`,
        );

        // Acknowledge anyway
        await acknowledgeHealthInfoRequest(request, requestId, abdmToken);

        // Cannot send transfer notification with empty statusResponses (ABDM requires non-empty).
        // Request is acknowledged; ABDM will handle timeout/retry if needed.
        return;
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
    const consentedHiTypes = artefact?.hiTypes;

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });

      console.log(
        `${LOG_PREFIX} Launched shared browser for ${careContexts.length} contexts`,
      );

      await Promise.all(
        careContexts.map((cc) =>
          pushHealthData(
            dataPushUrl,
            transactionId,
            cc,
            keyMaterial,
            abdmToken,
            consentedHiTypes,
            browser,
          ),
        ),
      );
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Error during parallel data push:`, err);
    } finally {
      if (browser) {
        await browser.close();
        console.log(`${LOG_PREFIX} Closed shared browser`);
      }
    }

    // Refresh care contexts to get updated statuses
    const updatedContexts = await CareContextModel.find({
      _id: { $in: contextIds },
    }).lean();

    // Step 4: Notify ABDM about the transfer
    await notifyHealthInfoTransfer(
      consentId,
      transactionId,
      updatedContexts as unknown as ICareContext[],
      abdmToken,
    );

    console.log(
      `${LOG_PREFIX} Request processing complete for consent: ${consentId}`,
    );
  } catch (error: any) {
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
};

export default HealthInformationService;
