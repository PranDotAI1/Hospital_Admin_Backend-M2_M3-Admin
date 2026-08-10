/**
 * Per-HI-type FHIR Bundle Builders — standalone bundles for new per-HI-type CareContexts.
 * Each builder matches exactly the logic in fhir.bundle.service.ts generateCombinedBundleForCareContext
 * for that specific HIType, so output is identical to the monolithic function when called with [hiType].
 */
import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { facilityId } from "../utils/constant";
import { Browser } from "puppeteer";
import { generateMultiplePdfs, generatePdfFromHtml } from "./pdf.service";
import {
  getPrescriptionTemplate,
  getDiagnosticReportTemplate,
  getDischargeSummaryTemplate,
  getOPConsultationTemplate,
  getImmunizationTemplate,
  getStructuredLabReportTemplate,
  getVitalsTemplate,
} from "../utils/report-templates";
import {
  ICombinedBundleOptionalData,
  buildPatientResource,
  buildOrganizationResource,
  buildPractitionerResource,
  buildEncounterResource,
  buildMedicationRequest,
  buildConditionResource,
  buildProcedureResource,
  getVitalValueAndUnit,
} from "./fhir.bundle.service";

// ── Local helpers (duplicated from fhir.bundle.service to keep this file standalone) ──

const VITAL_KEYS = [
  "pulse",
  "spo2",
  "sbp",
  "dbp",
  "map",
  "temp",
  "respiration",
  "painScore",
  "height",
  "weight",
  "bsa",
  "bmi",
  "category",
  "bs",
  "creatinine",
  "egfr",
  "egfr2",
] as const;

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Returns the ABDM-compliant DiagnosticReport.category coding array for a given lab testType.
 *
 * Per ABDM FHIR IG v6.5.0 / NRCES DiagnosticReportLab profile:
 *   - Primary system: http://terminology.hl7.org/CodeSystem/v2-0074 (HL7 v2-0074 lab taxonomy)
 *   - Secondary system: http://snomed.info/sct (service qualifier)
 *
 * Mappings:
 *   blood   → HM / Hematology        + SNOMED 708196005 (Hematology service)
 *   urine   → UA / Urinalysis        + SNOMED 4014000   (Urinalysis, complete)
 *   glucose → CH / Chemistry         + SNOMED 275711006 (Serum chemistry test)
 *   lipid   → CH / Chemistry         + SNOMED 275711006 (Serum chemistry test)
 *   default → LAB / Laboratory       + SNOMED 708196005 (General pathology service)
 */
function getLabDrCategory(testType?: string): any[] {
  const map: Record<
    string,
    {
      v2Code: string;
      v2Display: string;
      snomedCode: string;
      snomedDisplay: string;
    }
  > = {
    blood: {
      v2Code: "HM",
      v2Display: "Hematology",
      snomedCode: "708196005",
      snomedDisplay: "Hematology service",
    },
    urine: {
      v2Code: "UA",
      v2Display: "Urinalysis",
      snomedCode: "4014000",
      snomedDisplay: "Urinalysis, complete",
    },
    glucose: {
      v2Code: "CH",
      v2Display: "Chemistry",
      snomedCode: "275711006",
      snomedDisplay: "Serum chemistry test",
    },
    lipid: {
      v2Code: "CH",
      v2Display: "Chemistry",
      snomedCode: "275711006",
      snomedDisplay: "Serum chemistry test",
    },
  };
  const entry = map[(testType ?? "").toLowerCase()] ?? {
    v2Code: "LAB",
    v2Display: "Laboratory",
    snomedCode: "708196005",
    snomedDisplay: "General pathology service",
  };
  return [
    {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v2-0074",
          code: entry.v2Code,
          display: entry.v2Display,
        },
        {
          system: "http://snomed.info/sct",
          code: entry.snomedCode,
          display: entry.snomedDisplay,
        },
      ],
    },
  ];
}

const toSafeISOString = (date: Date | string | undefined | null): string => {
  if (date == null || date === "") return new Date().toISOString();
  const d = date instanceof Date ? date : new Date(date as string);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

const toSafeLocaleDateString = (
  date: Date | string | undefined | null,
): string => {
  if (date == null || date === "")
    return new Date().toLocaleDateString("en-IN");
  const d = date instanceof Date ? date : new Date(date as string);
  return isNaN(d.getTime())
    ? new Date().toLocaleDateString("en-IN")
    : d.toLocaleDateString("en-IN");
};

const escapeHtml = (s: string): string => {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

/** Matches the buildPdfDocumentReference in fhir.bundle.service.ts exactly (includes meta.profile and date field) */
const buildPdfDocumentReference = (
  docId: string,
  patientUUID: string,
  title: string,
  typeCode: string,
  typeDisplay: string,
  date: string,
  base64Pdf: string,
) => {
  return {
    fullUrl: `urn:uuid:${docId}`,
    resource: {
      resourceType: "DocumentReference",
      id: docId,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentReference",
        ],
      },
      status: "current",
      docStatus: "final",
      type: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: typeCode,
            display: typeDisplay,
          },
        ],
        text: typeDisplay,
      },
      subject: {
        reference: `urn:uuid:${patientUUID}`,
      },
      date: date,
      content: [
        {
          attachment: {
            contentType: "application/pdf",
            language: "en-IN",
            data: base64Pdf,
            title: title,
            creation: date,
          },
        },
      ],
    },
  };
};

// ── Vital observation builder (mirrors buildVitalObservation in fhir.bundle.service.ts) ──
const buildVitalObservation = (
  obsId: string,
  patientUUID: string,
  date: string,
  name: string,
  _loincCode: string,
  value: number,
  unit: string,
) => ({
  fullUrl: `urn:uuid:${obsId}`,
  resource: {
    resourceType: "Observation",
    id: obsId,
    status: "final",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "vital-signs",
            display: "Vital Signs",
          },
        ],
      },
    ],
    code: { text: name },
    subject: { reference: `urn:uuid:${patientUUID}` },
    effectiveDateTime: date,
    valueQuantity: { value, unit },
  },
});

const buildOPConsultationBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const opConsultationDocId = generateUUID();
  const prescriptionDocId = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";
  const bundleDate = toSafeISOString(visit.visitDate);
  const dept = visit.department || "OPD";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  (encounter.resource as any).participant = [
    {
      individual: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctor,
      },
    },
  ];
  bundleEntries.push(encounter);

  const sections: any[] = [];

  // ── Section 1: Chief Complaints (LOINC 10154-3) ──
  const chiefComplaintText =
    optionalData?.soapNotes?.subjective ||
    visit.complaint ||
    "General OPD consultation";
  let conditionUUID: string | undefined = generateUUID();
  bundleEntries.push(
    buildConditionResource(
      chiefComplaintText,
      conditionUUID,
      patientUUID,
      bundleDate,
      practitionerUUID,
    ),
  );
  sections.push({
    title: "Chief Complaints",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "10154-3",
          display: "Chief complaint Narrative - Reported",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Chief Complaint:</strong> ${escapeHtml(chiefComplaintText).replace(/\n/g, "<br/>")}</p></div>`,
    },
    entry: [
      { reference: `urn:uuid:${encounterUUID}` },
      { reference: `urn:uuid:${conditionUUID}` },
    ],
  });

  // ── Section 2: Allergies (LOINC 48765-2) ──
  const allergyText =
    typeof patient.allergies === "string" && patient.allergies
      ? patient.allergies
      : "No known allergies";
  const allergyEntries: any[] = [];
  if (patient.allergies) {
    const allergyId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${allergyId}`,
      resource: {
        resourceType: "AllergyIntolerance",
        id: allergyId,
        recordedDate: bundleDate,
        recorder: {
          reference: `urn:uuid:${practitionerUUID}`,
          display: doctor,
        },
        clinicalStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
              code: "active",
              display: "Active",
            },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
              code: "confirmed",
              display: "Confirmed",
            },
          ],
        },
        code: { text: allergyText },
        patient: { reference: `urn:uuid:${patientUUID}` },
      },
    });
    allergyEntries.push({ reference: `urn:uuid:${allergyId}` });
  }
  sections.push({
    title: "Allergies",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "48765-2",
          display: "Allergies and adverse reactions Document",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Allergies:</strong> ${escapeHtml(allergyText)}</p></div>`,
    },
    ...(allergyEntries.length > 0 && { entry: allergyEntries }),
  });

  // ── Section 3: Medical History (LOINC 11329-0) ──
  const mhParts: string[] = [];
  const mhEntries: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  const assessHistory = optionalData?.assessment?.medicalHistory;
  if (patient.existingMedicalConditions)
    mhParts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  if (assessHistory && assessHistory.length > 0) {
    const rows = assessHistory
      .map((h: any) => {
        if (h.disease) {
          const cid = generateUUID();
          bundleEntries.push({
            fullUrl: `urn:uuid:${cid}`,
            resource: {
              resourceType: "Condition",
              id: cid,
              meta: {
                profile: [
                  "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition",
                ],
              },
              clinicalStatus: {
                coding: [
                  {
                    system:
                      "http://terminology.hl7.org/CodeSystem/condition-clinical",
                    code: "recurrence",
                    display: "Recurrence",
                  },
                ],
              },
              code: { text: h.disease },
              subject: { reference: `urn:uuid:${patientUUID}` },
              recordedDate: bundleDate,
              recorder: {
                reference: `urn:uuid:${practitionerUUID}`,
                display: doctor,
              },
            },
          });
          mhEntries.push({ reference: `urn:uuid:${cid}` });
        }
        return `<tr><td>${escapeHtml(h.disease || "-")}</td><td>${escapeHtml(h.duration || "-")}</td><td>${escapeHtml(h.medications || "-")}</td></tr>`;
      })
      .join("");
    mhParts.push(
      `<table border="1" cellpadding="4"><thead><tr><th>Disease</th><th>Duration</th><th>Medications</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }
  sections.push({
    title: "Medical History",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11329-0",
          display: "History of past illness",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${mhParts.join("") || "<p>No medical history recorded.</p>"}</div>`,
    },
    entry: mhEntries,
  });

  // ── Section 4: Investigation Advice (SNOMED 721981007) ──
  const iaText = optionalData?.soapNotes?.assessment || "";
  const iaEntries: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  if (iaText) {
    const srId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${srId}`,
      resource: {
        resourceType: "ServiceRequest",
        id: srId,
        meta: {
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ServiceRequest",
          ],
        },
        status: "active",
        intent: "order",
        category: [
          {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "108252007",
                display: "Laboratory procedure",
              },
            ],
          },
        ],
        code: { text: iaText },
        subject: { reference: `urn:uuid:${patientUUID}` },
        authoredOn: bundleDate,
        requester: {
          reference: `urn:uuid:${practitionerUUID}`,
          display: doctor,
        },
      },
    });
    iaEntries.push({ reference: `urn:uuid:${srId}` });
  }
  sections.push({
    title: "Investigation Advice",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "721981007",
          display: "Diagnostic studies report",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${iaText ? `<p>${escapeHtml(iaText).replace(/\n/g, "<br/>")}</p>` : "<p>No investigation advice recorded.</p>"}</div>`,
    },
    entry: iaEntries,
  });

  // ── Section 5: Medications (SNOMED 721912009) ──
  const meds = optionalData?.prescription?.medications;
  const medEntries: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  let medNarrativeHtml = "<p>No medications prescribed.</p>";
  if (meds && meds.length > 0) {
    const medRows = meds
      .map(
        (m: any) =>
          `<tr><td>${escapeHtml(m.medicine || "-")}</td><td>${escapeHtml(m.dosage || "-")}</td><td>${m.frequency || "-"}</td><td>${m.duration || "-"}</td></tr>`,
      )
      .join("");
    medNarrativeHtml = `<table border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>${medRows}</tbody></table>`;
    meds.forEach((m: any) => {
      const medId = generateUUID();
      bundleEntries.push(
        buildMedicationRequest(
          m,
          patientUUID,
          orgUUID,
          practitionerUUID,
          doctor,
          bundleDate,
          medId,
          conditionUUID || null,
          chiefComplaintText,
        ),
      );
      medEntries.push({ reference: `urn:uuid:${medId}` });
    });
  }
  sections.push({
    title: "Medications",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "721912009",
          display: "Medication summary document",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${medNarrativeHtml}</div>`,
    },
    entry: medEntries,
  });

  // ── Section 6: Procedure (SNOMED 371525003) ──
  const procText = optionalData?.soapNotes?.objective || "";
  const procEntries: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  if (procText) {
    const procId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${procId}`,
      resource: {
        resourceType: "Procedure",
        id: procId,
        meta: {
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Procedure",
          ],
        },
        status: "completed",
        code: { text: procText },
        subject: { reference: `urn:uuid:${patientUUID}` },
        performedDateTime: bundleDate,
      },
    });
    procEntries.push({ reference: `urn:uuid:${procId}` });
  }
  sections.push({
    title: "Procedure",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "371525003",
          display: "Clinical procedure report",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${procText ? `<p>${escapeHtml(procText).replace(/\n/g, "<br/>")}</p>` : "<p>No procedures recorded.</p>"}</div>`,
    },
    entry: procEntries,
  });

  // ── Section 7: Follow Up (LOINC 57828-6) ──
  const followUpText = optionalData?.soapNotes?.plan || "";
  const fuEntries: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  if (followUpText) {
    const apptId = generateUUID();
    const startDate = new Date(bundleDate);
    startDate.setDate(startDate.getDate() + 7);
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + 30);
    const apptResource: any = {
      resourceType: "Appointment",
      id: apptId,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Appointment",
        ],
      },
      status: "booked",
      serviceCategory: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/service-category",
              code: "17",
              display: "General Practice",
            },
          ],
        },
      ],
      serviceType: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/service-type",
              code: "11",
              display: "Consultation",
            },
          ],
        },
      ],
      appointmentType: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0276",
            code: "FOLLOWUP",
            display: "Follow-up visit",
          },
        ],
      },
      description: followUpText,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      created: bundleDate,
      participant: [
        { actor: { reference: `urn:uuid:${patientUUID}` }, status: "accepted" },
        {
          actor: { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
          status: "accepted",
        },
      ],
    };
    if (conditionUUID)
      apptResource.reasonReference = [
        { reference: `urn:uuid:${conditionUUID}` },
      ];
    bundleEntries.push({
      fullUrl: `urn:uuid:${apptId}`,
      resource: apptResource,
    });
    fuEntries.push({ reference: `urn:uuid:${apptId}` });
  }
  sections.push({
    title: "Follow Up",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "57828-6",
          display: "Prescription list",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${followUpText ? `<p>${escapeHtml(followUpText).replace(/\n/g, "<br/>")}</p>` : "<p>No follow-up instructions recorded.</p>"}</div>`,
    },
    entry: fuEntries,
  });

  // ── Section 8: Document Reference ──
  sections.push({
    title: "Document Reference",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "371530004",
          display: "Clinical consultation report",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>OP Consultation Record</p></div>`,
    },
    entry: [
      { reference: `urn:uuid:${encounterUUID}` },
      { reference: `urn:uuid:${opConsultationDocId}` },
    ],
  });

  // ── PDF Generation ──
  const pdfRequests: Array<{
    title: string;
    typeCode: string;
    typeDisplay: string;
    html: string;
    docId: string;
  }> = [];

  if (
    optionalData?.soapNotes ||
    (optionalData?.assessment?.vitals &&
      Object.keys(optionalData.assessment.vitals).length > 0)
  ) {
    pdfRequests.push({
      title: "OP Consultation Report",
      typeCode: "371530004",
      typeDisplay: "Clinical consultation report",
      html: getOPConsultationTemplate(
        patient,
        visit,
        optionalData?.soapNotes,
        optionalData?.assessment?.vitals,
      ),
      docId: opConsultationDocId,
    });
  }
  if ((meds && meds.length > 0) || patient.ongoingMedications) {
    pdfRequests.push({
      title: "Prescription PDF",
      typeCode: "440545006",
      typeDisplay: "Prescription record",
      html: getPrescriptionTemplate(
        patient,
        visit,
        meds || [],
        optionalData?.prescription?.advice,
      ),
      docId: prescriptionDocId,
    });
  }

  if (browser && pdfRequests.length > 0) {
    try {
      const buffers = await generateMultiplePdfs(
        pdfRequests.map((r) => r.html),
        browser,
      );
      buffers.forEach((buf, i) => {
        if (buf && pdfRequests[i]) {
          bundleEntries.push(
            buildPdfDocumentReference(
              pdfRequests[i].docId,
              patientUUID,
              pdfRequests[i].title,
              pdfRequests[i].typeCode,
              pdfRequests[i].typeDisplay,
              bundleDate,
              buf.toString("base64"),
            ),
          );
        }
      });
    } catch (err) {
      console.error("[Builders] OPConsultation PDF generation failed:", err);
      for (const req of pdfRequests) {
        try {
          const buf = await generatePdfFromHtml(req.html, browser);
          bundleEntries.push(
            buildPdfDocumentReference(
              req.docId,
              patientUUID,
              req.title,
              req.typeCode,
              req.typeDisplay,
              bundleDate,
              buf.toString("base64"),
            ),
          );
        } catch (e) {
          console.error(
            `[Builders] OPConsultation fallback PDF failed for "${req.title}":`,
            e,
          );
        }
      }
    }
  }

  // Dangling reference cleanup
  const availableIds = new Set(bundleEntries.map((e: any) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
      if (section.entry.length === 0) delete section.entry;
    }
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "371530004",
                display: "Clinical consultation report",
              },
            ],
            text: "OP Consultation Record",
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
          ],
          title: `OP Consultation - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildPrescriptionBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const prescDocId = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const dept = visit.department || "OPD";
  const doctor = visit.doctorName || "Doctor";
  const bundleDate = toSafeISOString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  (encounter.resource as any).participant = [
    {
      individual: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctor,
      },
    },
  ];
  bundleEntries.push(encounter);

  const sections: any[] = [];
  const medRequestRefs: any[] = [];
  let prescriptionHtml = "";

  const chiefComplaint = visit.complaint || "General OPD consultation";
  const conditionUUID = generateUUID();
  const condition = buildConditionResource(
    chiefComplaint,
    conditionUUID,
    patientUUID,
    bundleDate,
    practitionerUUID,
  );
  bundleEntries.push(condition);
  // Condition is linked via reasonReference inside each MedicationRequest — not added to section entries

  const meds = optionalData?.prescription?.medications;
  if (meds && meds.length > 0) {
    meds.forEach((m) => {
      const medId = generateUUID();
      const medResource = buildMedicationRequest(
        m,
        patientUUID,
        orgUUID,
        practitionerUUID,
        doctor,
        bundleDate,
        medId,
        conditionUUID,
        chiefComplaint,
      );
      bundleEntries.push(medResource);
      medRequestRefs.push({
        reference: `urn:uuid:${medId}`,
        type: "MedicationRequest",
      });
    });

    const medTable = meds
      .map((m) => {
        let timingStr = "-";
        if (m.timing) {
          timingStr = `${m.timing.frequency} times per ${m.timing.period} ${m.timing.periodUnit}`;
        } else if (m.frequency) {
          timingStr = m.frequency;
        }

        const durStr = m.duration
          ? `${m.duration} ${m.durationUnit || "days"}`
          : "-";

        let instParts = [];
        if (m.instructions && m.instructions !== "Other")
          instParts.push(m.instructions);
        if (m.customInstructions) instParts.push(m.customInstructions);
        const instStr = instParts.length > 0 ? instParts.join(", ") : "-";

        return `<tr><td>${escapeHtml(m.medicine)}</td><td>${escapeHtml(m.dosage)}</td><td>${escapeHtml(timingStr)}</td><td>${escapeHtml(durStr)}</td><td>${escapeHtml(m.form || "-")}</td><td>${escapeHtml(instStr)}</td></tr>`;
      })
      .join("");

    prescriptionHtml =
      `<p><strong>Consultation:</strong> ${escapeHtml(dept)} - ${visitDateStr} - ${escapeHtml(doctor)}</p>` +
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Duration</th><th>Form</th><th>Instructions</th></tr></thead><tbody>${medTable}</tbody></table>` +
      (optionalData?.prescription?.advice
        ? `<p><strong>Advice:</strong> ${escapeHtml(optionalData.prescription.advice)}</p>`
        : "");

    // prescriptionHtml will be used for both XHTML narrative and HTML template
  } else {
    prescriptionHtml =
      `<p><strong>Consultation:</strong> ${escapeHtml(dept)} - ${visitDateStr} - ${escapeHtml(doctor)}</p>` +
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<p>No digital prescription records available for this visit.</p>`;
  }

  // Generate Binary resource — PDF if available, else HTML fallback
  const prescHtml = getPrescriptionTemplate(
    patient,
    visit,
    meds || [],
    optionalData?.prescription?.advice,
  );
  const binaryId = prescDocId;
  let binaryCreated = false;
  const hasPrescriptionData =
    (meds && meds.length > 0) || !!patient.ongoingMedications;

  if (browser && hasPrescriptionData) {
    try {
      const buffers = await generateMultiplePdfs([prescHtml], browser);
      if (buffers[0]) {
        bundleEntries.push({
          fullUrl: `urn:uuid:${binaryId}`,
          resource: {
            resourceType: "Binary",
            id: binaryId,
            meta: {
              profile: [
                "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Binary",
              ],
            },
            contentType: "application/pdf",
            data: buffers[0].toString("base64"),
          },
        });
        binaryCreated = true;
      } else {
        console.warn(
          "[Builders] Prescription PDF buffer was empty, using HTML fallback",
        );
      }
    } catch (err) {
      console.error(
        "[Builders] Prescription PDF generation failed, using HTML fallback:",
        err,
      );
    }
  }

  // Fallback: create Binary with HTML content if PDF wasn't generated
  if (!binaryCreated) {
    const base64Html = Buffer.from(prescHtml, "utf-8").toString("base64");
    bundleEntries.push({
      fullUrl: `urn:uuid:${binaryId}`,
      resource: {
        resourceType: "Binary",
        id: binaryId,
        meta: {
          profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Binary"],
        },
        contentType: "text/html",
        data: base64Html,
      },
    });
  }

  // Single section per PrescriptionRecord profile (section: 1..1)
  // Entries: MedicationRequest refs + Binary ref (per ABDM entry slicing)
  const sectionEntries: any[] = [...medRequestRefs];
  sectionEntries.push({ reference: `urn:uuid:${binaryId}`, type: "Binary" });

  sections.push({
    title: "Prescription record",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "440545006",
          display: "Prescription record",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${prescriptionHtml}</div>`,
    },
    entry: sectionEntries,
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "440545006",
                display: "Prescription record",
              },
            ],
            text: "Prescription",
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
          ],
          title: `Prescription - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildDiagnosticReportRecordBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();
  const drDocId = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const bundleDate = toSafeISOString(visit.visitDate);

  // Use analyst name from first lab report as the Practitioner (performer)
  // Falls back to visit.doctorName if no analyst name is available
  const labs = optionalData?.labReports;
  const analystName =
    labs?.find((l) => l.analystName)?.analystName ||
    visit.doctorName ||
    "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(analystName, practitionerUUID));
  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  (encounter.resource as any).participant = [
    {
      individual: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: analystName,
      },
    },
  ];
  bundleEntries.push(encounter);

  const sections: any[] = [];
  const sectionEntries: any[] = [];

  if (labs && labs.length > 0) {
    const labRows: string[] = [];
    const allObsRefs: { reference: string; display: string }[] = [];

    // Build one Observation per test, then ONE DiagnosticReport referencing all
    labs.forEach((lab) => {
      const drId = generateUUID();
      const obsId = generateUUID();
      const reportDate = lab.reportDate
        ? toSafeISOString(lab.reportDate)
        : bundleDate;

      // Build one Observation per test — collect refs for the SINGLE DiagnosticReport
      const obsResource: any = {
        fullUrl: `urn:uuid:${obsId}`,
        resource: {
          resourceType: "Observation",
          id: obsId,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation",
            ],
          },
          status: "final",
          code: {
            text: lab.testType || "Laboratory result",
            coding: [
              {
                system: "http://loinc.org",
                code: "11502-2",
                display: lab.testType || "Laboratory result",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          effectiveDateTime: reportDate,
          performer: [
            { reference: `urn:uuid:${orgUUID}`, display: "Organization" },
          ],
          ...(() => {
            const numVal = parseFloat(lab.resultValue || "");
            const isNum =
              !isNaN(numVal) && (lab.resultValue || "").trim() !== "";
            if (isNum) {
              return {
                valueQuantity: {
                  value: numVal,
                  unit: lab.measurementUnit || undefined,
                  ...(lab.measurementUnit
                    ? { system: "http://snomed.info/sct", code: "258797006" }
                    : {}),
                },
              };
            }
            return lab.resultValue
              ? {
                  valueString: `${lab.resultValue}${lab.measurementUnit ? " " + lab.measurementUnit : ""}`,
                }
              : {};
          })(),
        },
      };
      bundleEntries.push(obsResource);
      allObsRefs.push({
        reference: `urn:uuid:${obsId}`,
        display: `Observation/${lab.testType ?? "lab-result"}`,
      });

      labRows.push(
        `<tr><td>${escapeHtml(lab.testType || "-")}</td><td>${escapeHtml(lab.resultValue || "-")}</td><td>${escapeHtml(lab.measurementUnit || "-")}</td><td>${lab.reportDate ? toSafeLocaleDateString(lab.reportDate) : "-"}</td><td>${escapeHtml(lab.analystName || "-")}</td></tr>`,
      );
    });

    const labTable = `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th><th>Analyst</th></tr></thead><tbody>${labRows.join("")}</tbody></table>`;

    // Build ONE DiagnosticReport that groups ALL Observations (per ABDM pattern)
    const singleDrId = generateUUID();
    const combinedConclusion = labs
      .map((r: any) => r.additionalObservations)
      .filter(Boolean)
      .join("; ");
    const singleDrResource: any = {
      fullUrl: `urn:uuid:${singleDrId}`,
      resource: {
        resourceType: "DiagnosticReport",
        id: singleDrId,
        meta: {
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab",
          ],
        },
        status: "final",
        category: getLabDrCategory((labs[0] as any)?.testType),
        code: {
          text: (labs[0] as any)?.captureTime
            ? new Date((labs[0] as any).captureTime).toLocaleDateString(
                "en-IN",
                { day: "2-digit", month: "short", year: "numeric" },
              ) +
              ", " +
              new Date((labs[0] as any).captureTime).toLocaleTimeString(
                "en-IN",
                { hour: "2-digit", minute: "2-digit" },
              )
            : "Laboratory report",
          coding: [
            {
              system: "http://loinc.org",
              code: "11502-2",
              display: "Laboratory report",
            },
          ],
        },
        subject: { reference: `urn:uuid:${patientUUID}` },
        effectiveDateTime: labs[0]?.reportDate
          ? toSafeISOString(labs[0].reportDate)
          : bundleDate,
        issued: new Date().toISOString(),
        performer: [{ reference: `urn:uuid:${orgUUID}` }],
        resultsInterpreter: [
          { reference: `urn:uuid:${practitionerUUID}`, display: analystName },
        ],
        result: allObsRefs,
        presentedForm: [],
        ...(combinedConclusion ? { conclusion: combinedConclusion } : {}),
      },
    };
    bundleEntries.push(singleDrResource);

    // Section: ONE DR entry + DocumentReference for PDF
    sectionEntries.push({
      reference: `urn:uuid:${singleDrId}`,
      type: "DiagnosticReport",
    });
    sectionEntries.push({
      reference: `urn:uuid:${drDocId}`,
      type: "DocumentReference",
    });
    // Per ABDM: section title = "Diagnostic studies report" (SNOMED 721981007)
    sections.push({
      title: "Diagnostic studies report",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "721981007",
            display: "Diagnostic studies report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${labTable}</div>`,
      },
      entry: sectionEntries,
    });
  } else {
    sections.push({
      title: "Laboratory report",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "4321000179101",
            display: "Laboratory report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No lab results stored for this visit.</p></div>`,
      },
    });
  }

  // Batch PDF generation for LEGACY lab reports
  if (browser && labs && labs.length > 0) {
    try {
      const buffers = await generateMultiplePdfs(
        [getDiagnosticReportTemplate(patient, visit, labs)],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            drDocId,
            patientUUID,
            "Diagnostic Report",
            "4241000179101",
            "Laboratory report",
            bundleDate,
            buffers[0].toString("base64"),
          ),
        );
      }
    } catch (err) {
      console.error("[Builders] DiagnosticReport PDF generation failed:", err);
    }
  }

  // ── NEW: Structured lab reports (from lab_reports collection) ────────────────
  const structuredLabs = optionalData?.structuredLabReports;
  if (structuredLabs && structuredLabs.length > 0) {
    for (const slab of structuredLabs) {
      // Skip reports with no parameters that have values
      const filledParams = slab.parameters.filter(
        (p) => p.parameterValue && p.parameterValue.trim() !== "",
      );
      if (filledParams.length === 0) continue;

      const displayName = slab.displayName || slab.testType;
      const slabObsRefs: { reference: string; display: string }[] = [];
      const slabSectionEntries: any[] = [];

      // Build one Observation per parameter
      for (const param of filledParams) {
        const obsId = generateUUID();
        const reportDate = slab.reportDate
          ? toSafeISOString(slab.reportDate)
          : bundleDate;

        const numVal = parseFloat(param.parameterValue);
        const isNum = !isNaN(numVal) && param.parameterValue.trim() !== "";

        const obsResource: any = {
          fullUrl: `urn:uuid:${obsId}`,
          resource: {
            resourceType: "Observation",
            id: obsId,
            meta: {
              profile: [
                "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation",
              ],
            },
            status: "final",
            category: [
              {
                coding: [
                  {
                    system:
                      "http://terminology.hl7.org/CodeSystem/observation-category",
                    code: "laboratory",
                    display: "Laboratory",
                  },
                ],
              },
            ],
            code: {
              text: param.parameterName,
              coding: [
                {
                  system: "http://loinc.org",
                  code: param.loincCode || "11502-2",
                  display: param.loincDisplay || param.parameterName,
                },
              ],
            },
            subject: { reference: `urn:uuid:${patientUUID}` },
            effectiveDateTime: reportDate,
            performer: [
              { reference: `urn:uuid:${orgUUID}`, display: "Organization" },
            ],
            ...(isNum
              ? {
                  valueQuantity: {
                    value: numVal,
                    unit: param.unit || undefined,
                    ...(param.unit
                      ? {
                          system: "http://snomed.info/sct",
                          code: "258797006",
                        }
                      : {}),
                  },
                }
              : {
                  valueString: `${param.parameterValue}${param.unit ? " " + param.unit : ""}`,
                }),
            // ABDM: referenceRange
            ...(param.referenceRange
              ? {
                  referenceRange: [
                    {
                      text: param.referenceRange,
                    },
                  ],
                }
              : {}),
            // Flag interpretation
            ...(param.flag && param.flag !== ""
              ? {
                  interpretation: [
                    {
                      coding: [
                        {
                          system:
                            "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                          code:
                            param.flag === "High"
                              ? "H"
                              : param.flag === "Low"
                                ? "L"
                                : "N",
                          display: param.flag,
                        },
                      ],
                    },
                  ],
                }
              : {}),
          },
        };
        bundleEntries.push(obsResource);
        slabObsRefs.push({
          reference: `urn:uuid:${obsId}`,
          display: `Observation/${param.parameterName}`,
        });
      }

      // Build one DiagnosticReport for this structured lab
      const slabDrId = generateUUID();
      const slabDrResource: any = {
        fullUrl: `urn:uuid:${slabDrId}`,
        resource: {
          resourceType: "DiagnosticReport",
          id: slabDrId,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab",
            ],
          },
          status: slab.status === "final" ? "final" : "preliminary",
          category: getLabDrCategory(slab.testType),
          code: {
            text: displayName,
            coding: [
              {
                system: "http://loinc.org",
                code: slab.loincCode || "11502-2",
                display: slab.loincDisplay || displayName,
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          effectiveDateTime: slab.reportDate
            ? toSafeISOString(slab.reportDate)
            : bundleDate,
          issued: new Date().toISOString(),
          performer: [{ reference: `urn:uuid:${orgUUID}` }],
          resultsInterpreter: [
            {
              reference: `urn:uuid:${practitionerUUID}`,
              display: slab.analystName || analystName,
            },
          ],
          result: slabObsRefs,
          presentedForm: [],
          ...(slab.observations ? { conclusion: slab.observations } : {}),
        },
      };
      bundleEntries.push(slabDrResource);

      // Section entry refs
      slabSectionEntries.push({
        reference: `urn:uuid:${slabDrId}`,
        type: "DiagnosticReport",
      });

      // PDF for this structured lab report
      if (browser) {
        const slabDocId = generateUUID();
        try {
          const slabPdfBuffers = await generateMultiplePdfs(
            [
              getStructuredLabReportTemplate(patient, visit, {
                testType: slab.testType,
                displayName,
                sampleId: slab.sampleId,
                reportDate: slab.reportDate,
                analystName: slab.analystName,
                observations: slab.observations,
                status: slab.status,
                parameters: slab.parameters,
              }),
            ],
            browser,
          );
          if (slabPdfBuffers[0]) {
            bundleEntries.push(
              buildPdfDocumentReference(
                slabDocId,
                patientUUID,
                `${displayName} Report`,
                "4241000179101",
                "Laboratory report",
                bundleDate,
                slabPdfBuffers[0].toString("base64"),
              ),
            );
            slabSectionEntries.push({
              reference: `urn:uuid:${slabDocId}`,
              type: "DocumentReference",
            });
          }
        } catch (pdfErr) {
          console.error(
            `[Builders] Structured lab report PDF generation failed for ${displayName}:`,
            pdfErr,
          );
        }
      }

      // Section: title = test type display name (e.g. "Blood Test")
      sections.push({
        title: displayName,
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "721981007",
              display: "Diagnostic studies report",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${displayName} — ${filledParams.length} parameter(s) recorded</p></div>`,
        },
        entry: slabSectionEntries,
      });
    }
  }

  // Dangling reference cleanup
  const availableIds = new Set(bundleEntries.map((e: any) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
    }
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "721981007",
                display: "Diagnostic studies report",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            {
              reference: `urn:uuid:${practitionerUUID}`,
              display: analystName,
            },
          ],
          title: `Diagnostic Report- Lab - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildDischargeSummaryRecordBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();
  const dsDocId = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const ds = optionalData?.dischargeSummary;
  const doctor = ds?.doctorSignature || visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  (encounter.resource as any).participant = [
    {
      individual: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctor,
      },
    },
  ];
  bundleEntries.push(encounter);

  const sections: any[] = [];
  const assessment = optionalData?.assessment;

  // ── Section 1: Chief Complaints (SNOMED 422843007) ──
  const chiefComplaintText =
    ds?.chiefComplaints ||
    ds?.diagnosis ||
    assessment?.symptomsComplaints ||
    "";
  const chiefComplaintEntries: any[] = [];
  let conditionIdForMeds: string | undefined;
  if (chiefComplaintText) {
    conditionIdForMeds = generateUUID();
    bundleEntries.push(
      buildConditionResource(
        chiefComplaintText,
        conditionIdForMeds,
        patientUUID,
        toSafeISOString(visit.visitDate),
        practitionerUUID,
      ),
    );
    chiefComplaintEntries.push({ reference: `urn:uuid:${conditionIdForMeds}` });
  }
  sections.push({
    title: "Chief Complaints",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "422843007",
          display: "Chief complaint section",
        },
      ],
    },
    text: {
      status: "generated",
      div: chiefComplaintText
        ? `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(chiefComplaintText)}</p></div>`
        : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No chief complaints recorded.</p></div>`,
    },
    ...(chiefComplaintEntries.length > 0 && { entry: chiefComplaintEntries }),
  });

  // ── Section 2: Medical History (SNOMED 371529009) ──
  const medHistoryParts: string[] = [];
  if (ds?.admissionDate)
    medHistoryParts.push(
      `<p><strong>Admission Date:</strong> ${toSafeLocaleDateString(ds.admissionDate)}</p>`,
    );
  if (ds?.dischargeDate)
    medHistoryParts.push(
      `<p><strong>Discharge Date:</strong> ${toSafeLocaleDateString(ds.dischargeDate)}</p>`,
    );
  if (ds?.ward)
    medHistoryParts.push(
      `<p><strong>Ward:</strong> ${escapeHtml(ds.ward)}</p>`,
    );
  if (ds?.bed)
    medHistoryParts.push(`<p><strong>Bed:</strong> ${escapeHtml(ds.bed)}</p>`);
  if (ds?.clinicalSummary)
    medHistoryParts.push(
      `<p><strong>Clinical Summary:</strong> ${escapeHtml(ds.clinicalSummary)}</p>`,
    );
  if (ds?.admissionNotes)
    medHistoryParts.push(
      `<p><strong>Admission Notes:</strong> ${escapeHtml(ds.admissionNotes)}</p>`,
    );
  const medHistoryEntries: any[] = [];
  if (assessment?.medicalHistory && assessment.medicalHistory.length > 0) {
    const histRows = assessment.medicalHistory
      .map((h: any) => {
        if (h.disease) {
          const condUUID = generateUUID();
          const cond = buildConditionResource(
            h.disease,
            condUUID,
            patientUUID,
            toSafeISOString(visit.visitDate),
            practitionerUUID,
            false,
          );
          bundleEntries.push(cond);
          medHistoryEntries.push({ reference: `urn:uuid:${condUUID}` });
        }
        return `<tr><td>${escapeHtml(h.disease || "-")}</td><td>${escapeHtml(h.duration || "-")}</td><td>${escapeHtml(h.medications || "-")}</td></tr>`;
      })
      .join("");
    medHistoryParts.push(
      `<p><strong>Past Medical History:</strong></p><table border="1" cellpadding="4"><thead><tr><th>Disease</th><th>Duration</th><th>Medications</th></tr></thead><tbody>${histRows}</tbody></table>`,
    );
  }

  if (medHistoryEntries.length === 0 && medHistoryParts.length > 0) {
    const condUUID = generateUUID();
    const cond = buildConditionResource(
      "Past Medical History Details",
      condUUID,
      patientUUID,
      toSafeISOString(visit.visitDate),
      practitionerUUID,
      false,
    );
    bundleEntries.push(cond);
    medHistoryEntries.push({ reference: `urn:uuid:${condUUID}` });
  }

  sections.push({
    title: "Medical History",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "1003642006",
          display: "Past medical history section",
        },
      ],
    },
    text: {
      status: "generated",
      div:
        medHistoryParts.length > 0
          ? `<div xmlns="http://www.w3.org/1999/xhtml">${medHistoryParts.join("")}</div>`
          : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No medical history recorded.</p></div>`,
    },
    ...(medHistoryEntries.length > 0 && { entry: medHistoryEntries }),
  });

  // ── Section 3: Investigations (SNOMED 721981007) ──
  const investigationParts: string[] = [];
  const investigationEntries: any[] = [];
  if (ds?.investigationsResults)
    investigationParts.push(`<p>${escapeHtml(ds.investigationsResults)}</p>`);
  if (optionalData?.labReports && optionalData.labReports.length > 0) {
    const labRows = optionalData.labReports
      .map(
        (lab: any) =>
          `<tr><td>${escapeHtml(lab.testType || "-")}</td><td>${escapeHtml(lab.resultValue || "-")}</td><td>${escapeHtml(lab.measurementUnit || "-")}</td><td>${lab.reportDate ? toSafeLocaleDateString(lab.reportDate) : "-"}</td></tr>`,
      )
      .join("");
    investigationParts.push(
      `<table border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th></tr></thead><tbody>${labRows}</tbody></table>`,
    );
  }

  if (investigationParts.length > 0) {
    const obsUUID = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${obsUUID}`,
      resource: {
        resourceType: "Observation",
        id: obsUUID,
        status: "final",
        code: {
          text: "Investigations Narrative",
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "721981007",
              display: "Diagnostic studies report",
            },
          ],
        },
        subject: { reference: `urn:uuid:${patientUUID}` },
      },
    });
    investigationEntries.push({ reference: `urn:uuid:${obsUUID}` });
  }

  sections.push({
    title: "Investigations",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "721981007",
          display: "Diagnostic studies report",
        },
      ],
    },
    text: {
      status: "generated",
      div:
        investigationParts.length > 0
          ? `<div xmlns="http://www.w3.org/1999/xhtml">${investigationParts.join("")}</div>`
          : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No investigation results recorded.</p></div>`,
    },
    ...(investigationEntries.length > 0 && { entry: investigationEntries }),
  });

  // ── Section 4: Procedures (SNOMED 371525003) ──
  const procedureParts: string[] = [];
  const procedureEntries: any[] = [];
  if (ds?.treatmentGiven)
    procedureParts.push(
      `<p><strong>Treatment Given:</strong> ${escapeHtml(ds.treatmentGiven)}</p>`,
    );
  if (ds?.surgicalProcedures) {
    procedureParts.push(
      `<p><strong>Surgical Procedures:</strong> ${escapeHtml(ds.surgicalProcedures)}</p>`,
    );
    const procId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${procId}`,
      resource: {
        resourceType: "Procedure",
        id: procId,
        meta: {
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Procedure",
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(ds.surgicalProcedures)}</p></div>`,
        },
        status: "completed",
        code: {
          text: ds.surgicalProcedures,
        },
        subject: { reference: `urn:uuid:${patientUUID}` },
        performedDateTime: toSafeISOString(visit.visitDate),
      },
    });
    procedureEntries.push({ reference: `urn:uuid:${procId}` });
  }
  if (ds?.surgicalNote)
    procedureParts.push(
      `<p><strong>Surgical Note:</strong> ${escapeHtml(ds.surgicalNote)}</p>`,
    );
  sections.push({
    title: "Procedures",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "371525003",
          display: "Clinical procedure report",
        },
      ],
    },
    text: {
      status: "generated",
      div:
        procedureParts.length > 0
          ? `<div xmlns="http://www.w3.org/1999/xhtml">${procedureParts.join("")}</div>`
          : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No procedures recorded.</p></div>`,
    },
    ...(procedureEntries.length > 0 && { entry: procedureEntries }),
  });

  // ── Section 5: Medications (SNOMED 721912009) ──
  const medEntries: any[] = [];
  let medNarrativeHtml = "";
  if (ds?.dischargeMedications && ds.dischargeMedications.length > 0) {
    const medRows = ds.dischargeMedications
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.medicine)}</td><td>${escapeHtml(m.dosage)}</td><td>${m.frequency ?? "-"}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
      )
      .join("");
    medNarrativeHtml = `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medRows}</tbody></table>`;

    ds.dischargeMedications.forEach((m) => {
      const medId = generateUUID();
      bundleEntries.push(
        buildMedicationRequest(
          m,
          patientUUID,
          orgUUID,
          practitionerUUID,
          doctor,
          toSafeISOString(visit.visitDate),
          medId,
          conditionIdForMeds,
          chiefComplaintText,
        ),
      );
      medEntries.push({ reference: `urn:uuid:${medId}` });
    });
  }
  sections.push({
    title: "Medications",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "721912009",
          display: "Medication summary document",
        },
      ],
    },
    text: {
      status: "generated",
      div: medNarrativeHtml
        ? `<div xmlns="http://www.w3.org/1999/xhtml">${medNarrativeHtml}</div>`
        : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No discharge medications recorded.</p></div>`,
    },
    ...(medEntries.length > 0 && { entry: medEntries }),
  });

  // ── Section 6: Care Plan (SNOMED 734163000) ──
  const carePlanParts: string[] = [];
  const carePlanEntries: any[] = [];
  if (ds?.carePlan) carePlanParts.push(`<p>${escapeHtml(ds.carePlan)}</p>`);
  if (ds?.followUpInstructions)
    carePlanParts.push(
      `<p><strong>Follow-up Instructions:</strong> ${escapeHtml(ds.followUpInstructions)}</p>`,
    );
  if (ds?.conditionAtDischarge)
    carePlanParts.push(
      `<p><strong>Condition at Discharge:</strong> ${escapeHtml(ds.conditionAtDischarge)}</p>`,
    );
  if (optionalData?.soapNotes?.plan)
    carePlanParts.push(
      `<p><strong>Plan:</strong> ${escapeHtml(optionalData.soapNotes.plan)}</p>`,
    );
  if (carePlanParts.length > 0) {
    const carePlanId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${carePlanId}`,
      resource: {
        resourceType: "CarePlan",
        id: carePlanId,
        meta: {
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/CarePlan",
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${
            carePlanParts.length > 0
              ? carePlanParts.join("")
              : "<p>Care plan details</p>"
          }</div>`,
        },
        status: "active",
        intent: "plan",
        subject: { reference: `urn:uuid:${patientUUID}` },
        description:
          ds?.carePlan ||
          ds?.followUpInstructions ||
          optionalData?.soapNotes?.plan ||
          "Discharge care plan",
      },
    });
    carePlanEntries.push({ reference: `urn:uuid:${carePlanId}` });
  }
  sections.push({
    title: "Care Plan",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "734163000",
          display: "Care plan",
        },
      ],
    },
    text: {
      status: "generated",
      div:
        carePlanParts.length > 0
          ? `<div xmlns="http://www.w3.org/1999/xhtml">${carePlanParts.join("")}</div>`
          : `<div xmlns="http://www.w3.org/1999/xhtml"><p>No care plan recorded.</p></div>`,
    },
    ...(carePlanEntries.length > 0 && { entry: carePlanEntries }),
  });

  // ── Section 7: Document Reference (SNOMED 373942005) ──
  // PDF will be generated below; placeholder section created now
  sections.push({
    title: "Document Reference",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "373942005",
          display: "Discharge summary",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Discharge Summary Document</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${dsDocId}` }],
  });

  // Batch PDF generation (mirrors fhir.bundle.service.ts pattern)
  if (browser && optionalData?.dischargeSummary) {
    try {
      const buffers = await generateMultiplePdfs(
        [
          getDischargeSummaryTemplate(
            patient,
            visit,
            optionalData.dischargeSummary,
            optionalData?.assessment,
            optionalData?.labReports,
          ),
        ],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            dsDocId,
            patientUUID,
            "Discharge Summary",
            "373942005",
            "Discharge summary",
            toSafeISOString(visit.visitDate),
            buffers[0].toString("base64"),
          ),
        );
      }
    } catch (err) {
      console.error("[Builders] DischargeSummary PDF generation failed:", err);
    }
  }

  // Dangling reference cleanup
  const availableIds = new Set(bundleEntries.map((e: any) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
      if (section.entry.length === 0) {
        delete section.entry;
      }
    }
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "373942005",
                display: "Discharge summary",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
          ],
          title: `Discharge Summary - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildImmunizationRecordBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();
  const immDocId = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const sections: any[] = [];
  const immunization = optionalData?.assessment?.immunization;
  const vaccineEntries: Array<{
    name: string;
    code: string;
    date?: Date;
    doseNumber: number;
    seriesDoses: number;
    manufacturer?: string;
    lotNumber?: string;
  }> = [];

  if (immunization) {
    const imm = immunization as any;
    const d1Date = imm.covid19Dose1?.date || imm.covid19Dose1Date;
    if (d1Date)
      vaccineEntries.push({
        name: "COVID-19 Vaccine Dose 1",
        code: "28531000087107",
        date: d1Date,
        doseNumber: imm.covid19Dose1?.doseNumber ?? 1,
        seriesDoses: 2,
        manufacturer: imm.covid19Dose1?.manufacturer,
        lotNumber: imm.covid19Dose1?.lotNumber,
      });
    const d2Date = imm.covid19Dose2?.date || imm.covid19Dose2Date;
    if (d2Date)
      vaccineEntries.push({
        name: "COVID-19 Vaccine Dose 2",
        code: "28531000087107",
        date: d2Date,
        doseNumber: imm.covid19Dose2?.doseNumber ?? 2,
        seriesDoses: 2,
        manufacturer: imm.covid19Dose2?.manufacturer,
        lotNumber: imm.covid19Dose2?.lotNumber,
      });
    const tetDate = imm.tetanusBooster?.date || imm.tetanusBoosterDate;
    if (tetDate)
      vaccineEntries.push({
        name: "Tetanus Booster",
        code: "333621002",
        date: tetDate,
        doseNumber: imm.tetanusBooster?.doseNumber ?? 1,
        seriesDoses: 1,
        manufacturer: imm.tetanusBooster?.manufacturer,
        lotNumber: imm.tetanusBooster?.lotNumber,
      });
    const fluDate = imm.fluVaccine?.date || imm.fluVaccineDate;
    if (fluDate)
      vaccineEntries.push({
        name: "Influenza Vaccine",
        code: "46233009",
        date: fluDate,
        doseNumber: imm.fluVaccine?.doseNumber ?? 1,
        seriesDoses: 1,
        manufacturer: imm.fluVaccine?.manufacturer,
        lotNumber: imm.fluVaccine?.lotNumber,
      });
  }

  if (vaccineEntries.length > 0) {
    const immunizationRefs: any[] = [];
    const rows: string[] = [];
    vaccineEntries.forEach((v) => {
      const immId = generateUUID();
      const immResource: any = {
        resourceType: "Immunization",
        id: immId,
        status: "completed",
        vaccineCode: {
          text: v.name,
        },
        patient: { reference: `urn:uuid:${patientUUID}` },
        occurrenceDateTime: v.date
          ? toSafeISOString(v.date)
          : toSafeISOString(visit.visitDate),
        primarySource: true,
        lotNumber: v.lotNumber || "N/A",
        doseQuantity: { value: 0.5, unit: "ml" },
        performer: [{ actor: { reference: `urn:uuid:${orgUUID}` } }],
        protocolApplied: [
          {
            doseNumberPositiveInt: v.doseNumber,
            seriesDosesPositiveInt: v.seriesDoses,
          },
        ],
      };
      if (v.manufacturer) {
        const mfrId = generateUUID();
        bundleEntries.push({
          fullUrl: `urn:uuid:${mfrId}`,
          resource: {
            resourceType: "Organization",
            id: mfrId,
            name: v.manufacturer,
          },
        });
        immResource.manufacturer = {
          reference: `urn:uuid:${mfrId}`,
          display: v.manufacturer,
        };
      }
      bundleEntries.push({
        fullUrl: `urn:uuid:${immId}`,
        resource: immResource,
      });
      immunizationRefs.push({ reference: `urn:uuid:${immId}` });
      rows.push(
        `<tr><td>${escapeHtml(v.name)}</td><td>${v.date ? toSafeLocaleDateString(v.date) : "-"}</td><td>${v.doseNumber}/${v.seriesDoses}</td><td>${v.manufacturer ? escapeHtml(v.manufacturer) : "-"}</td><td>${v.lotNumber || "-"}</td></tr>`,
      );
    });

    sections.push({
      title: "Immunization Record",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "41000179103",
            display: "Immunization record",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><table border="1" cellpadding="4"><thead><tr><th>Vaccine</th><th>Date</th><th>Dose</th><th>Manufacturer</th><th>Lot Number</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      },
      entry: immunizationRefs,
    });
  } else {
    sections.push({
      title: "Immunization Record",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "41000179103",
            display: "Immunization record",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No immunization events recorded for this visit.</p></div>`,
      },
    });
  }

  // Batch PDF generation
  if (browser && vaccineEntries.length > 0) {
    try {
      const buffers = await generateMultiplePdfs(
        [getImmunizationTemplate(patient, visit, immunization)],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            immDocId,
            patientUUID,
            "Immunization Record PDF",
            "41000179103",
            "Immunization record",
            toSafeISOString(visit.visitDate),
            buffers[0].toString("base64"),
          ),
        );

        // Also attach the document reference to the section entries
        const lastSection = sections[sections.length - 1];
        if (lastSection && lastSection.title === "Immunization Record") {
          lastSection.entry = lastSection.entry || [];
          lastSection.entry.push({ reference: `urn:uuid:${immDocId}` });
        }
      }
    } catch (err) {
      console.error("[Builders] Immunization PDF generation failed:", err);
    }
  }

  // Dangling reference cleanup
  const availableIds = new Set(bundleEntries.map((e: any) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
    }
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ImmunizationRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "41000179103",
                display: "Immunization record",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: `urn:uuid:${practitionerUUID}` }],
          title: `Immunization Record - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildHealthDocumentRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(
    buildPractitionerResource(visit.doctorName || "Doctor", practitionerUUID),
  );
  bundleEntries.push(buildEncounterResource(visit, encounterUUID, patientUUID));

  const sections: any[] = [];
  const parts: string[] = [];
  const docRefUUIDs: string[] = [];

  // Uploaded documents (primary content for HealthDocumentRecord)
  const docUploads = (optionalData?.assessment as any)?.documentUploads as
    | Array<{
        fileName?: string;
        mimeType?: string;
        uploadDate?: Date | string;
        fileData?: string | Buffer | { buffer: ArrayBuffer };
        fileUrl?: string;
      }>
    | undefined;

  if (docUploads && docUploads.length > 0) {
    const docRows = docUploads
      .map(
        (d) =>
          `<tr><td>${escapeHtml(d.fileName || "document")}</td><td>${escapeHtml(d.mimeType || "-")}</td><td>${d.uploadDate ? toSafeLocaleDateString(d.uploadDate) : "-"}</td></tr>`,
      )
      .join("");
    parts.push(
      `<p><strong>Uploaded Documents (${docUploads.length}):</strong></p><table border="1" cellpadding="4"><thead><tr><th>File Name</th><th>Type</th><th>Upload Date</th></tr></thead><tbody>${docRows}</tbody></table>`,
    );

    // Create a DocumentReference resource for each uploaded document
    for (const doc of docUploads) {
      // Resolve base64 data from fileData
      let base64Data = "";
      if (doc.fileData) {
        if (typeof doc.fileData === "string") {
          base64Data = doc.fileData;
        } else if (Buffer.isBuffer(doc.fileData)) {
          base64Data = doc.fileData.toString("base64");
        } else if ((doc.fileData as any).buffer) {
          base64Data = Buffer.from((doc.fileData as any).buffer).toString(
            "base64",
          );
        }
      }
      if (!base64Data) continue; // Skip docs without actual content

      const docRefUUID = generateUUID();
      docRefUUIDs.push(docRefUUID);
      bundleEntries.push({
        fullUrl: `urn:uuid:${docRefUUID}`,
        resource: {
          resourceType: "DocumentReference",
          id: docRefUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentReference",
            ],
          },
          status: "current",
          docStatus: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "419891008",
                display: "Record artifact",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          date: doc.uploadDate
            ? toSafeISOString(doc.uploadDate)
            : new Date().toISOString(),
          author: [{ reference: `urn:uuid:${practitionerUUID}` }],
          description: doc.fileName || "Uploaded document",
          content: [
            {
              attachment: {
                contentType: doc.mimeType || "application/octet-stream",
                data: base64Data,
                title: doc.fileName || "document",
              },
            },
          ],
        },
      });
    }
  } else {
    parts.push(`<p>No documents uploaded for this visit.</p>`);
  }

  if (parts.length > 0) {
    sections.push({
      title: "Health Document",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "419891008",
            display: "Record artifact",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${parts.join("")}</div>`,
      },
      entry: [
        { reference: `urn:uuid:${encounterUUID}` },
        ...docRefUUIDs.map((id) => ({ reference: `urn:uuid:${id}` })),
      ],
    });
  } else {
    sections.push({
      title: "Health Document",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "419891008",
            display: "Record artifact",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No additional health documents for this visit.</p></div>`,
      },
    });
  }

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/HealthDocumentRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "419891008",
                display: "Record artifact",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: `urn:uuid:${practitionerUUID}` }],
          title: `Health Document - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildWellnessRecordBundle = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const vitalsDocId = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const bundleDate = toSafeISOString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  (encounter.resource as any).participant = [
    {
      individual: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctor,
      },
    },
  ];
  bundleEntries.push(encounter);

  const sections: any[] = [];

  // ── Vital Signs ──
  if (optionalData?.assessment?.vitals) {
    const vitalEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
    const vitalRows: string[] = [];
    const vitals = optionalData.assessment.vitals as Record<
      string,
      string | number | undefined
    >;

    Object.keys(vitals).forEach((assessmentKey) => {
      if (!VITAL_KEYS.includes(assessmentKey as (typeof VITAL_KEYS)[number]))
        return;
      // Skip Body Measurement keys (height/weight/bsa/bmi) from Vital Signs in WellnessRecord
      if (["height", "weight", "bsa", "bmi"].includes(assessmentKey)) return;

      const valueAndUnit = getVitalValueAndUnit(
        vitals[assessmentKey],
        assessmentKey,
      );
      if (valueAndUnit === null) return;
      const { value, unit } = valueAndUnit;
      if (Number.isNaN(value) || typeof value !== "number") return;

      const obsUUID = generateUUID();
      bundleEntries.push(
        buildVitalObservation(
          obsUUID,
          patientUUID,
          bundleDate,
          assessmentKey,
          "",
          value,
          unit,
        ),
      );
      vitalEntryRefs.push({ reference: `urn:uuid:${obsUUID}` });
      vitalRows.push(
        `<tr><td>${escapeHtml(assessmentKey)}</td><td>${value}</td><td>${escapeHtml(unit)}</td></tr>`,
      );
    });

    const vitalsNarrativeHtml =
      vitalRows.length > 0
        ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Vital</th><th>Value</th><th>Unit</th></tr></thead><tbody>${vitalRows.join("")}</tbody></table>`
        : `<p>No vital signs recorded for this visit.</p>`;

    // Attach PDF doc ref to Vital Signs section if available (will add after PDF gen)
    sections.push({
      title: "Vital Signs",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "8716-3",
            display: "Vital signs",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${vitalsNarrativeHtml}</div>`,
      },
      entry: vitalEntryRefs,
    });
  }

  // ── Body Measurement ──
  {
    const bmRows: string[] = [];
    const bmEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
    const vitals = optionalData?.assessment?.vitals as
      | Record<string, string | number | undefined>
      | undefined;
    if (vitals) {
      Object.keys(vitals).forEach((assessmentKey) => {
        if (!["height", "weight", "bsa", "bmi"].includes(assessmentKey)) return;
        const valueAndUnit = getVitalValueAndUnit(
          vitals[assessmentKey],
          assessmentKey,
        );
        if (valueAndUnit === null) return;
        const { value, unit } = valueAndUnit;
        if (Number.isNaN(value) || typeof value !== "number") return;
        const obsUUID = generateUUID();
        bundleEntries.push(
          buildVitalObservation(
            obsUUID,
            patientUUID,
            bundleDate,
            assessmentKey,
            "",
            value,
            unit,
          ),
        );
        bmEntryRefs.push({ reference: `urn:uuid:${obsUUID}` });
        bmRows.push(
          `<tr><td>${escapeHtml(assessmentKey)}</td><td>${value}</td><td>${escapeHtml(unit)}</td></tr>`,
        );
      });
    }
    const bmNarrativeHtml =
      bmRows.length > 0
        ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Measurement</th><th>Value</th><th>Unit</th></tr></thead><tbody>${bmRows.join("")}</tbody></table>`
        : `<p>No body measurements recorded.</p>`;
    sections.push({
      title: "Body Measurement",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "8716-3",
            display: "Vital signs",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${bmNarrativeHtml}</div>`,
      },
      entry: bmEntryRefs,
    });
  }

  // ── General Assessment ──
  {
    const gaParts: string[] = [];
    const gaEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];

    if (optionalData?.assessment?.symptomsComplaints) {
      gaParts.push(
        `<p><strong>Symptoms/Complaints:</strong> ${escapeHtml(optionalData.assessment.symptomsComplaints).replace(/\n/g, "<br/>")}</p>`,
      );
      const condUUID = generateUUID();
      bundleEntries.push(
        buildConditionResource(
          optionalData.assessment.symptomsComplaints,
          condUUID,
          patientUUID,
          bundleDate,
          practitionerUUID,
          false,
        ),
      );
      gaEntryRefs.push({ reference: `urn:uuid:${condUUID}` });
    }

    if (
      optionalData?.assessment?.medicalHistory &&
      optionalData.assessment.medicalHistory.length > 0
    ) {
      const medRows = optionalData.assessment.medicalHistory
        .map((h: any) => {
          if (h.disease) {
            const condUUID = generateUUID();
            bundleEntries.push(
              buildConditionResource(
                h.disease,
                condUUID,
                patientUUID,
                bundleDate,
                practitionerUUID,
                false,
              ),
            );
            gaEntryRefs.push({ reference: `urn:uuid:${condUUID}` });
          }
          return `<tr><td>${escapeHtml(h.disease || "-")}</td><td>${escapeHtml(h.duration || "-")}</td><td>${escapeHtml(h.medications || "-")}</td></tr>`;
        })
        .join("");
      gaParts.push(
        `<p><strong>Medical History:</strong></p><table border="1" cellpadding="4"><thead><tr><th>Disease</th><th>Duration</th><th>Medications</th></tr></thead><tbody>${medRows}</tbody></table>`,
      );
    }

    if (
      optionalData?.assessment?.surgicalHistory &&
      optionalData.assessment.surgicalHistory.length > 0
    ) {
      const surgRows = optionalData.assessment.surgicalHistory
        .map((h: any) => {
          if (h.surgical) {
            const condUUID = generateUUID();
            bundleEntries.push(
              buildConditionResource(
                h.surgical,
                condUUID,
                patientUUID,
                bundleDate,
                practitionerUUID,
                false,
              ),
            );
            gaEntryRefs.push({ reference: `urn:uuid:${condUUID}` });
          }
          return `<tr><td>${escapeHtml(h.surgical || "-")}</td><td>${escapeHtml(h.surgeonName || "-")}</td><td>${escapeHtml(h.hospital || "-")}</td><td>${escapeHtml(h.date || "-")}</td></tr>`;
        })
        .join("");
      gaParts.push(
        `<p><strong>Surgical History:</strong></p><table border="1" cellpadding="4"><thead><tr><th>Surgical</th><th>Surgeon Name</th><th>Hospital</th><th>Date</th></tr></thead><tbody>${surgRows}</tbody></table>`,
      );
    }

    const gaNarrativeHtml =
      gaParts.length > 0
        ? gaParts.join("")
        : `<p>No general assessment recorded.</p>`;
    sections.push({
      title: "General Assessment",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "371530004",
            display: "Clinical consultation report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${gaNarrativeHtml}</div>`,
      },
      entry: gaEntryRefs,
    });
  }

  // ── Physical Activity ──
  {
    const paParts: string[] = [];
    const paEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
    const paObsUUID = generateUUID();
    const paObservation: any = {
      resourceType: "Observation",
      id: paObsUUID,
      status: "final",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "68130003",
            display: "Physical activity",
          },
        ],
      },
      subject: { reference: `urn:uuid:${patientUUID}` },
    };

    if (optionalData?.assessment?.physicalActivity) {
      const pa = optionalData.assessment.physicalActivity as any;
      const paSummary = `Steps: ${pa.stepsPerDay || "-"}, Calories: ${pa.caloriesBurned || "-"}, Sleep: ${pa.sleepDuration || "-"} hr`;
      paObservation.valueString = paSummary;
      paParts.push(`<p><strong>Physical Activity:</strong> ${paSummary}</p>`);
    } else {
      paObservation.valueString = "No physical activity details recorded.";
      paParts.push(`<p>No physical activity details recorded.</p>`);
    }
    bundleEntries.push({
      fullUrl: `urn:uuid:${paObsUUID}`,
      resource: paObservation,
    });
    paEntryRefs.push({ reference: `urn:uuid:${paObsUUID}` });

    sections.push({
      title: "Physical Activity",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "68130003",
            display: "Physical activity",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${paParts.join("")}</div>`,
      },
      entry: paEntryRefs,
    });
  }

  // ── Lifestyle ──
  {
    const lifeParts: string[] = [];
    const lifeEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
    const lifeObsUUID = generateUUID();
    const lifeObservation: any = {
      resourceType: "Observation",
      id: lifeObsUUID,
      status: "final",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "228272008",
            display: "Health-related behavior",
          },
        ],
      },
      subject: { reference: `urn:uuid:${patientUUID}` },
    };

    if (optionalData?.assessment?.lifestyle) {
      const ls = optionalData.assessment.lifestyle as any;
      const lsSummary = `Diet: ${ls.dietType || "-"}, Smoking: ${ls.smokingBehavior || "-"}, Alcohol: ${ls.alcoholBehavior || "-"}`;
      lifeObservation.valueString = lsSummary;
      lifeParts.push(`<p><strong>Lifestyle:</strong> ${lsSummary}</p>`);
    } else {
      lifeObservation.valueString = "No lifestyle details recorded.";
      lifeParts.push(`<p>No lifestyle details recorded.</p>`);
    }
    bundleEntries.push({
      fullUrl: `urn:uuid:${lifeObsUUID}`,
      resource: lifeObservation,
    });
    lifeEntryRefs.push({ reference: `urn:uuid:${lifeObsUUID}` });

    sections.push({
      title: "Lifestyle",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "228272008",
            display: "Health-related behavior",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${lifeParts.join("")}</div>`,
      },
      entry: lifeEntryRefs,
    });
  }

  // ── Women Health ──
  {
    const whParts: string[] = [];
    const whEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
    const whPlaceholderUUID = generateUUID();
    const whPlaceholderObs: any = {
      resourceType: "Observation",
      id: whPlaceholderUUID,
      status: "final",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "42798-9",
            display: "Age at menarche",
          },
        ],
      },
      subject: { reference: `urn:uuid:${patientUUID}` },
    };

    const wh = optionalData?.assessment?.womenHealth as any;
    let hasWhData = false;
    if (wh && typeof wh === "object") {
      if (wh.ageAtMenarche !== undefined && wh.ageAtMenarche !== null) {
        hasWhData = true;
        whPlaceholderObs.valueQuantity = {
          value: wh.ageAtMenarche,
          unit: "years",
          system: "http://unitsofmeasure.org",
          code: "a",
        };
        whParts.push(
          `<p><strong>Age at Menarche:</strong> ${wh.ageAtMenarche} years</p>`,
        );
      }
      if (wh.lastMenstrualPeriod) {
        hasWhData = true;
        const lmpDate =
          wh.lastMenstrualPeriod instanceof Date
            ? wh.lastMenstrualPeriod.toISOString().split("T")[0]
            : String(wh.lastMenstrualPeriod).split("T")[0];
        const lmpUUID = generateUUID();
        bundleEntries.push({
          fullUrl: `urn:uuid:${lmpUUID}`,
          resource: {
            resourceType: "Observation",
            id: lmpUUID,
            status: "final",
            code: {
              coding: [
                {
                  system: "http://loinc.org",
                  code: "8665-2",
                  display: "Last menstrual period start date",
                },
              ],
            },
            subject: { reference: `urn:uuid:${patientUUID}` },
            valueDateTime: lmpDate,
          },
        });
        whEntryRefs.push({ reference: `urn:uuid:${lmpUUID}` });
        whParts.push(
          `<p><strong>Last Menstrual Period:</strong> ${lmpDate}</p>`,
        );
      }
    }

    if (!hasWhData) {
      whPlaceholderObs.valueString = "No Women Health data recorded.";
      whParts.push(`<p>No Women Health data recorded.</p>`);
    }
    bundleEntries.push({
      fullUrl: `urn:uuid:${whPlaceholderUUID}`,
      resource: whPlaceholderObs,
    });
    whEntryRefs.push({ reference: `urn:uuid:${whPlaceholderUUID}` });

    sections.push({
      title: "Women Health",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "42798-9",
            display: "Age at menarche",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${whParts.join("")}</div>`,
      },
      entry: whEntryRefs,
    });
  }

  // ── Document Reference ──
  sections.push({
    title: "Document Reference",
    code: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "371530004",
          display: "Clinical document",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Wellness Record Documentation</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });

  // ── PDF Generation ──
  if (
    browser &&
    optionalData?.assessment?.vitals &&
    Object.keys(optionalData.assessment.vitals).length > 0
  ) {
    try {
      const buffers = await generateMultiplePdfs(
        [
          getVitalsTemplate(
            patient,
            visit,
            optionalData.assessment.vitals as Record<
              string,
              string | number | undefined
            >,
          ),
        ],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            vitalsDocId,
            patientUUID,
            "Wellness/Vitals Record PDF",
            "371530004",
            "Clinical consultation report",
            bundleDate,
            buffers[0].toString("base64"),
          ),
        );
        // Attach to Vital Signs section entry if present
        const vsSection = sections.find((s) => s.title === "Vital Signs");
        if (vsSection && vsSection.entry) {
          vsSection.entry.push({ reference: `urn:uuid:${vitalsDocId}` });
        }
      }
    } catch (err) {
      console.error("[Builders] WellnessRecord PDF generation failed:", err);
      try {
        const buf = await generatePdfFromHtml(
          getVitalsTemplate(
            patient,
            visit,
            optionalData.assessment.vitals as Record<
              string,
              string | number | undefined
            >,
          ),
          browser,
        );
        bundleEntries.push(
          buildPdfDocumentReference(
            vitalsDocId,
            patientUUID,
            "Wellness/Vitals Record PDF",
            "371530004",
            "Clinical consultation report",
            bundleDate,
            buf.toString("base64"),
          ),
        );
        const vsSection = sections.find((s) => s.title === "Vital Signs");
        if (vsSection && vsSection.entry) {
          vsSection.entry.push({ reference: `urn:uuid:${vitalsDocId}` });
        }
      } catch (e) {
        console.error("[Builders] WellnessRecord fallback PDF failed:", e);
      }
    }
  }

  // Dangling reference cleanup
  const availableIds = new Set(bundleEntries.map((e: any) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
      if (section.entry.length === 0) delete section.entry;
    }
  });

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/WellnessRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "371530004",
                display: "Clinical consultation report",
              },
            ],
            text: "Wellness Record",
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
          ],
          title: `Wellness Record - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildInvoiceRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const bundleDate = toSafeISOString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));

  const encounter = buildEncounterResource(visit, encounterUUID, patientUUID);
  bundleEntries.push(encounter);

  const patientRef = `urn:uuid:${patientUUID}`;
  const practRef = `urn:uuid:${practitionerUUID}`;

  const parseNum = (val: any) => parseFloat(val) || 0;

  const sectionEntry: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
  let billingRows = "";

  if (
    optionalData?.billing?.billings &&
    optionalData.billing.billings.length > 0
  ) {
    const billings = optionalData.billing.billings;

    // Build one ChargeItem per billing line
    const chargeItemIds: string[] = [];
    for (const billing of billings) {
      const ciId = generateUUID();
      chargeItemIds.push(ciId);
      bundleEntries.push({
        fullUrl: `urn:uuid:${ciId}`,
        resource: {
          resourceType: "ChargeItem",
          id: ciId,
          meta: {
            versionId: "1",
            lastUpdated: bundleDate,
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ChargeItem",
            ],
          },
          status: "billed",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes",
                code: "07",
                display: "Consultation",
              },
            ],
          },
          subject: { reference: patientRef, display: "Patient" },
          performer: [
            { actor: { reference: practRef, display: "Practitioner" } },
          ],
          quantity: { value: billing.unit || 1 },
          productCodeableConcept: { text: billing.particulars || "Service" },
        },
      });
    }

    // Build lineItems + priceComponents for Invoice resource
    let calculatedTotalGross = 0;
    let calculatedTotalNet = 0;
    const lineItems = billings.map((b: any, index: number) => {
      const qty = parseNum(b.unit) || 1;
      const rate = parseNum(b.rate) || 0;
      const mrp = parseNum(b.mrp) || rate;
      const discount = parseNum(b.discount) || 0;
      const cgstPct = parseNum(b.cgst) || 6;
      const sgstPct = parseNum(b.sgst) || 6;

      // Use pre-computed amounts if available (written by controller), else derive them
      const taxableAmount =
        b.taxableAmount !== undefined
          ? parseNum(b.taxableAmount)
          : parseFloat(Math.max(rate * qty - discount, 0).toFixed(2));
      const cgstAmt =
        b.cgstAmount !== undefined
          ? parseNum(b.cgstAmount)
          : parseFloat(((taxableAmount * cgstPct) / 100).toFixed(2));
      const sgstAmt =
        b.sgstAmount !== undefined
          ? parseNum(b.sgstAmount)
          : parseFloat(((taxableAmount * sgstPct) / 100).toFixed(2));
      const lineGross = parseFloat(
        (taxableAmount + cgstAmt + sgstAmt).toFixed(2),
      );

      calculatedTotalNet += taxableAmount;
      calculatedTotalGross += lineGross;

      const priceComponents: any[] = [
        {
          type: "base",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
                code: "01",
                display: "Rate",
              },
            ],
          },
          factor: qty,
          amount: { value: rate, currency: "INR" },
        },
        {
          type: "informational",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
                code: "00",
                display: "MRP",
              },
            ],
          },
          amount: { value: mrp, currency: "INR" },
        },
        {
          type: "discount",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
                code: "02",
                display: "Discount",
              },
            ],
          },
          amount: { value: discount, currency: "INR" },
        },
        {
          type: "tax",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
                code: "03",
                display: `CGST`,
              },
            ],
          },
          factor: cgstPct / 100,
          amount: { value: cgstAmt, currency: "INR" },
        },
        {
          type: "tax",
          code: {
            coding: [
              {
                system:
                  "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
                code: "04",
                display: `SGST`,
              },
            ],
          },
          factor: sgstPct / 100,
          amount: { value: sgstAmt, currency: "INR" },
        },
      ];

      billingRows += `<tr>
        <td style="padding:4px;">${escapeHtml(b.particulars || "Service")}</td>
        <td style="padding:4px;text-align:center;">${qty}</td>
        <td style="padding:4px;text-align:right;">${mrp.toFixed(2)}</td>
        <td style="padding:4px;text-align:right;">${rate.toFixed(2)}</td>
        <td style="padding:4px;text-align:right;">${discount.toFixed(2)}</td>
        <td style="padding:4px;text-align:right;">${taxableAmount.toFixed(2)}</td>
        <td style="padding:4px;text-align:right;">${cgstPct}% (${cgstAmt.toFixed(2)})</td>
        <td style="padding:4px;text-align:right;">${sgstPct}% (${sgstAmt.toFixed(2)})</td>
        <td style="padding:4px;text-align:right;font-weight:bold;">${lineGross.toFixed(2)}</td>
      </tr>`;

      return {
        sequence: index + 1,
        chargeItemReference: {
          reference: `urn:uuid:${chargeItemIds[index]}`,
          display: b.particulars || "Service",
        },
        priceComponent: priceComponents,
      };
    });

    // Build Invoice resource
    const invoiceResId = generateUUID();
    const invoiceHtml = `<div xmlns="http://www.w3.org/1999/xhtml">
      <p><b>Invoice</b></p>
      <table border="1" style="border-collapse:collapse;width:100%;font-size:12px;">
        <thead>
          <tr>
            <th style="padding:4px;">Item</th>
            <th style="padding:4px;">Qty</th>
            <th style="padding:4px;">MRP (₹)</th>
            <th style="padding:4px;">Rate (₹)</th>
            <th style="padding:4px;">Discount (₹)</th>
            <th style="padding:4px;">Taxable (₹)</th>
            <th style="padding:4px;">CGST</th>
            <th style="padding:4px;">SGST</th>
            <th style="padding:4px;">Gross (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${billingRows}
          <tr>
            <td colspan="5" style="padding:4px;"><b>Total Net (pre-tax)</b></td>
            <td colspan="4" style="padding:4px;"><b>₹ ${calculatedTotalNet.toFixed(2)}</b></td>
          </tr>
          <tr>
            <td colspan="5" style="padding:4px;"><b>Total Gross (payable)</b></td>
            <td colspan="4" style="padding:4px;"><b>₹ ${calculatedTotalGross.toFixed(2)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>`;

    bundleEntries.push({
      fullUrl: `urn:uuid:${invoiceResId}`,
      resource: {
        resourceType: "Invoice",
        id: invoiceResId,
        meta: {
          versionId: "1",
          lastUpdated: bundleDate,
          profile: [
            "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Invoice",
          ],
        },
        text: { status: "generated", div: invoiceHtml },
        identifier: [{ value: invoiceResId }],
        status: "issued",
        type: {
          coding: [
            {
              system:
                "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes",
              code: "07",
              display: "Consultation",
            },
          ],
        },
        subject: { reference: patientRef, display: "Patient" },
        date: bundleDate,
        participant: [
          { actor: { reference: practRef, display: "Practitioner" } },
        ],
        lineItem: lineItems,
        totalNet: { value: calculatedTotalNet, currency: "INR" },
        totalGross: { value: calculatedTotalGross, currency: "INR" },
      },
    });

    sectionEntry.push({
      reference: `urn:uuid:${invoiceResId}`,
      type: "Invoice",
    } as any);

    // Narrative section rows (summary view for section text)
    const narRows = billings
      .map((item: any) => {
        const qty = parseNum(item.unit) || 1;
        const rate = parseNum(item.rate) || 0;
        const mrp = parseNum(item.mrp) || rate;
        const discount = parseNum(item.discount) || 0;
        const taxable =
          item.taxableAmount !== undefined
            ? parseNum(item.taxableAmount)
            : parseFloat(Math.max(rate * qty - discount, 0).toFixed(2));
        const gross = parseNum(item.amount) || taxable;
        return `<tr>
            <td style="padding:4px;">${escapeHtml(item.particulars || "Service")}</td>
            <td style="padding:4px;text-align:center;">${qty}</td>
            <td style="padding:4px;text-align:right;">${mrp.toFixed(2)}</td>
            <td style="padding:4px;text-align:right;">${rate.toFixed(2)}</td>
            <td style="padding:4px;text-align:right;">${discount.toFixed(2)}</td>
            <td style="padding:4px;text-align:right;">${taxable.toFixed(2)}</td>
            <td style="padding:4px;text-align:right;font-weight:bold;">${gross.toFixed(2)}</td>
          </tr>`;
      })
      .join("");
    const totalRow = `<tr>
      <td colspan="5" style="padding:4px;"><strong>Total Net</strong></td>
      <td style="padding:4px;"><strong>₹ ${calculatedTotalNet.toFixed(2)}</strong></td>
      <td></td>
    </tr>
    <tr>
      <td colspan="5" style="padding:4px;"><strong>Total Gross</strong></td>
      <td colspan="2" style="padding:4px;"><strong>₹ ${calculatedTotalGross.toFixed(2)}</strong></td>
    </tr>`;
    billingRows = narRows + totalRow;
  } else {
    billingRows = `<tr><td colspan="4" style="padding: 4px;">No billing items recorded for this visit.</td></tr>`;
  }

  const sectionNarrativeDiv = `<div xmlns="http://www.w3.org/1999/xhtml">
    <p><strong>Invoice - ( Invoice )</strong></p>
    <table border="1" style="border-collapse:collapse;width:100%;font-size:12px;">
      <thead>
        <tr>
          <th style="padding:4px;">Item Name</th>
          <th style="padding:4px;">Qty</th>
          <th style="padding:4px;">MRP (₹)</th>
          <th style="padding:4px;">Rate (₹)</th>
          <th style="padding:4px;">Discount (₹)</th>
          <th style="padding:4px;">Taxable (₹)</th>
          <th style="padding:4px;">Gross (₹)</th>
        </tr>
      </thead>
      <tbody>${billingRows}</tbody>
    </table>
  </div>`;

  return {
    resourceType: "Bundle",
    id: bundleId,
    meta: { lastUpdated: new Date().toISOString() },
    identifier: {
      system: `https://${facilityId}.abdm.gov.in`,
      value: careContext.careContextReference,
    },
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [
      {
        fullUrl: `urn:uuid:${compositionUUID}`,
        resource: {
          resourceType: "Composition",
          id: compositionUUID,
          meta: {
            profile: [
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/InvoiceRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "52471000210109",
                display: "Invoice",
              },
            ],
            text: "Invoice",
          },
          subject: { reference: patientRef },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: practRef, display: doctor }],
          title: `Invoice - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: [
            {
              title: "Invoice",
              code: {
                coding: [
                  {
                    system: "http://snomed.info/sct",
                    code: "52471000210109",
                    display: "Invoice",
                  },
                ],
              },
              text: { status: "generated", div: sectionNarrativeDiv },
              entry: sectionEntry,
            },
          ],
        },
      },
      ...bundleEntries,
    ],
  };
};

export const generateFhirBundle = async (
  hiType: HIType,
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  browser?: Browser,
): Promise<any> => {
  switch (hiType) {
    case "OPConsultation":
      return await buildOPConsultationBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "Prescription":
      return await buildPrescriptionBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "DiagnosticReport":
      return await buildDiagnosticReportRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "DischargeSummary":
      return await buildDischargeSummaryRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "ImmunizationRecord":
      return await buildImmunizationRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "HealthDocumentRecord":
      return buildHealthDocumentRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "WellnessRecord":
      return await buildWellnessRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
    case "Invoice":
      return buildInvoiceRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    default:
      return await buildOPConsultationBundle(
        patient,
        visit,
        careContext,
        optionalData,
        browser,
      );
  }
};

export const generateFhirBundlesForCareContext = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any[] => {
  // Use hiType (singular canonical field) — NEVER iterate hiTypes array.
  const hiType = careContext.hiType
    || (Array.isArray(careContext.hiTypes) && careContext.hiTypes.length === 1
      ? careContext.hiTypes[0]
      : null);

  if (!hiType) {
    return [
      buildOPConsultationBundle(patient, visit, careContext, optionalData),
    ];
  }

  return [
    generateFhirBundle(hiType as HIType, patient, visit, careContext, optionalData),
  ];
};
