/**
 * Per-HI-type FHIR Bundle Builders — standalone bundles for new per-HI-type CareContexts.
 */
import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { facilityId } from "../utils/constant";
import { Browser } from "puppeteer";
import { generateMultiplePdfs } from "./pdf.service";
import {
  getPrescriptionTemplate,
  getDiagnosticReportTemplate,
  getDischargeSummaryTemplate,
  getOPConsultationTemplate,
} from "../utils/report-templates";
import {
  ICombinedBundleOptionalData,
  buildPatientResource,
  buildOrganizationResource,
  buildPractitionerResource,
  buildEncounterResource,
  buildMedicationRequest,
  buildConditionResource,
  parseVitalValue,
  getVitalValueAndUnit,
} from "./fhir.bundle.service";

// ── Local helpers (duplicated from fhir.bundle.service to keep this file standalone) ──

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const toSafeISOString = (date: Date | string | undefined | null): string => {
  if (!date) return new Date().toISOString();
  const d = new Date(date);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

const toSafeLocaleDateString = (
  date: Date | string | undefined | null,
): string => {
  if (!date) return new Date().toLocaleDateString("en-IN");
  const d = new Date(date);
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
  const opConsultDocId = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
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

  const visitInfoParts: string[] = [];
  if (visit.department) visitInfoParts.push(`Department: ${visit.department}`);
  if (visit.doctorName) visitInfoParts.push(`Doctor: ${visit.doctorName}`);
  visitInfoParts.push(`Visit Date: ${toSafeLocaleDateString(visit.visitDate)}`);
  visitInfoParts.push(
    `Token: ${visit.tokenNumber || careContext.careContextReference || "N/A"}`,
  );

  const chiefComplaint = visit.complaint || "General OPD consultation";
  sections.push({
    title: "Case Summary",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "10154-3",
          display: "Chief complaint",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Chief Complaint:</strong> ${chiefComplaint}</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [
      { reference: `urn:uuid:${encounterUUID}` },
      { reference: `urn:uuid:${opConsultDocId}` },
    ],
  });

  if (visit.complaint) {
    const conditionUUID = generateUUID();
    const condition = buildConditionResource(
      visit.complaint,
      conditionUUID,
      patientUUID,
      toSafeISOString(visit.visitDate),
      practitionerUUID,
    );
    bundleEntries.push(condition);
    sections[sections.length - 1].entry.push({
      reference: `urn:uuid:${conditionUUID}`,
    });
  }

  const soap = optionalData?.soapNotes;
  if (
    soap &&
    (soap.subjective || soap.objective || soap.assessment || soap.plan)
  ) {
    const soapParts: string[] = [];
    if (soap.subjective)
      soapParts.push(
        `<p><strong>Subjective:</strong> ${escapeHtml(soap.subjective)}</p>`,
      );
    if (soap.objective)
      soapParts.push(
        `<p><strong>Objective:</strong> ${escapeHtml(soap.objective)}</p>`,
      );
    if (soap.assessment)
      soapParts.push(
        `<p><strong>Assessment:</strong> ${escapeHtml(soap.assessment)}</p>`,
      );
    if (soap.plan)
      soapParts.push(`<p><strong>Plan:</strong> ${escapeHtml(soap.plan)}</p>`);
    sections.push({
      title: "Clinical Notes (SOAP)",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "10164-2",
            display: "History of present illness",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${soapParts.join("")}</div>`,
      },
      entry: [{ reference: `urn:uuid:${encounterUUID}` }],
    });
  }

  const meds = optionalData?.prescription?.medications;
  if (meds && meds.length > 0) {
    const medEntries: any[] = [];
    meds.forEach((m) => {
      const medId = generateUUID();
      const medResource = buildMedicationRequest(
        m,
        patientUUID,
        orgUUID,
        practitionerUUID,
        doctor,
        toSafeISOString(visit.visitDate),
        medId,
      );
      bundleEntries.push(medResource);
      medEntries.push({ reference: `urn:uuid:${medId}` });
    });
    const medTable = meds
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.medicine)}</td><td>${escapeHtml(m.dosage)}</td><td>${m.frequency ?? "-"}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
      )
      .join("");
    const prescriptionHtml =
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<p><strong>Prescribed at this visit:</strong></p>` +
      `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medTable}</tbody></table>` +
      (optionalData?.prescription?.advice
        ? `<p><strong>Advice:</strong> ${escapeHtml(optionalData.prescription.advice)}</p>`
        : "");
    sections.push({
      title: "Prescription",
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
      entry: medEntries,
    });
  } else if (patient.ongoingMedications) {
    sections.push({
      title: "Prescription",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p><p>No new prescriptions at this visit.</p></div>`,
      },
    });
  }

  const assessment = optionalData?.assessment;

  // Symptoms/Complaints from assessment
  if (assessment?.symptomsComplaints) {
    sections.push({
      title: "Symptoms",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "418799008",
            display: "Finding reported by subject or history provider",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${escapeHtml(assessment.symptomsComplaints)}</p></div>`,
      },
      entry: [{ reference: `urn:uuid:${encounterUUID}` }],
    });
  }

  // Medical History from assessment (structured table)
  const medHistRows = assessment?.medicalHistory?.filter((h) => h.disease);
  const historyParts: string[] = [];
  if (patient.allergies)
    historyParts.push(
      `<p><strong>Allergies:</strong> ${escapeHtml(String(patient.allergies))}</p>`,
    );
  if (patient.existingMedicalConditions)
    historyParts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  if (patient.ongoingMedications)
    historyParts.push(
      `<p><strong>Ongoing Medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`,
    );

  if (medHistRows && medHistRows.length > 0) {
    const rows = medHistRows
      .map(
        (h) =>
          `<tr><td>${escapeHtml(h.disease || "-")}</td><td>${escapeHtml(h.duration || "-")}</td><td>${escapeHtml(h.medications || "-")}</td></tr>`,
      )
      .join("");
    historyParts.push(
      `<p><strong>Medical History:</strong></p><table border="1" cellpadding="4"><thead><tr><th>Condition</th><th>Duration</th><th>Medications</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }

  if (historyParts.length > 0) {
    sections.push({
      title: "Medical History",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "371529009",
            display: "History and physical report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${historyParts.join("")}</div>`,
      },
    });
  }

  // Surgical History from assessment
  const surgHistRows = assessment?.surgicalHistory?.filter((h) => h.surgical);
  if (surgHistRows && surgHistRows.length > 0) {
    const rows = surgHistRows
      .map(
        (h) =>
          `<tr><td>${escapeHtml(h.surgical || "-")}</td><td>${escapeHtml(h.surgeonName || "-")}</td><td>${h.date ? toSafeLocaleDateString(h.date) : "-"}</td><td>${escapeHtml(h.hospital || "-")}</td></tr>`,
      )
      .join("");
    sections.push({
      title: "Surgical History",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "418285008",
            display: "Surgical procedure",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><table border="1" cellpadding="4"><thead><tr><th>Procedure</th><th>Surgeon</th><th>Date</th><th>Hospital</th></tr></thead><tbody>${rows}</tbody></table></div>`,
      },
    });
  }



  // Batch PDF generation (mirrors fhir.bundle.service.ts pattern)
  if (browser) {
    try {
      const buffers = await generateMultiplePdfs(
        [
          getOPConsultationTemplate(
            patient,
            visit,
            optionalData?.soapNotes,
            optionalData?.assessment?.vitals,
          ),
        ],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            opConsultDocId,
            patientUUID,
            "OP Consultation Report",
            "371530004",
            "Clinical consultation report",
            toSafeISOString(visit.visitDate),
            buffers[0].toString("base64"),
          ),
        );
      }
    } catch (err) {
      console.error("[Builders] OPConsultation PDF generation failed:", err);
    }
  }

  // Dangling reference cleanup — removes refs to resources that weren't added (e.g. failed PDF)
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
    meta: {
      lastUpdated: new Date().toISOString(),
    },
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
            {
              reference: `urn:uuid:${practitionerUUID}`,
              display: doctor,
            },
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
  medRequestRefs.push({ reference: `urn:uuid:${conditionUUID}` });

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
      medRequestRefs.push({ reference: `urn:uuid:${medId}` });
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

    const prescriptionHtml =
      `<p><strong>Consultation:</strong> ${escapeHtml(dept)} - ${visitDateStr} - ${escapeHtml(doctor)}</p>` +
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Duration</th><th>Form</th><th>Instructions</th></tr></thead><tbody>${medTable}</tbody></table>` +
      (optionalData?.prescription?.advice
        ? `<p><strong>Advice:</strong> ${escapeHtml(optionalData.prescription.advice)}</p>`
        : "");

    // Wire PDF reference into section entries BEFORE pushing (matches fhir.bundle.service.ts pattern)
    medRequestRefs.push({ reference: `urn:uuid:${prescDocId}` });
    sections.push({
      title: "Prescription",
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
      entry: medRequestRefs,
    });
  } else {
    const fallbackHtml =
      `<p><strong>Consultation:</strong> ${escapeHtml(dept)} - ${visitDateStr} - ${escapeHtml(doctor)}</p>` +
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<p>No digital prescription records available for this visit.</p>`;
    const fallbackEntry: any[] = [];
    if (patient.ongoingMedications) {
      fallbackEntry.push({ reference: `urn:uuid:${prescDocId}` });
    }
    sections.push({
      title: "Prescription",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${fallbackHtml}</div>`,
      },
      ...(fallbackEntry.length > 0 ? { entry: fallbackEntry } : {}),
    });
  }

  // Batch PDF generation (mirrors fhir.bundle.service.ts pattern)
  const hasPrescriptionData =
    (meds && meds.length > 0) || !!patient.ongoingMedications;
  if (browser && hasPrescriptionData) {
    try {
      const buffers = await generateMultiplePdfs(
        [
          getPrescriptionTemplate(
            patient,
            visit,
            meds || [],
            optionalData?.prescription?.advice,
          ),
        ],
        browser,
      );
      if (buffers[0]) {
        bundleEntries.push(
          buildPdfDocumentReference(
            prescDocId,
            patientUUID,
            "Prescription PDF",
            "440545006",
            "Prescription record",
            bundleDate,
            buffers[0].toString("base64"),
          ),
        );
      }
    } catch (err) {
      console.error("[Builders] Prescription PDF generation failed:", err);
    }
  }

  // Dangling reference cleanup — removes refs to resources that weren't added (e.g. failed PDF)
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
  bundleEntries.push(buildEncounterResource(visit, encounterUUID, patientUUID));

  const sections: any[] = [];
  const sectionEntries: any[] = [];

  if (labs && labs.length > 0) {
    const labRows: string[] = [];

    // Create a separate DiagnosticReport for each lab test (matching example bundle)
    labs.forEach((lab) => {
      const drId = generateUUID();
      const obsId = generateUUID();
      const reportDate = lab.reportDate
        ? toSafeISOString(lab.reportDate)
        : bundleDate;

      // Build one Observation per test
      const obsResource: any = {
        fullUrl: `urn:uuid:${obsId}`,
        resource: {
          resourceType: "Observation",
          id: obsId,
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
          valueString: lab.resultValue
            ? `${lab.resultValue}${lab.measurementUnit ? " " + lab.measurementUnit : ""}`
            : undefined,
        },
      };
      bundleEntries.push(obsResource);
      // Do NOT add Observation to sectionEntries — it's referenced via DiagnosticReport.result[].
      // Only DiagnosticReport goes in the section so PHR shows one card per test.

      const drResource: any = {
        fullUrl: `urn:uuid:${drId}`,
        resource: {
          resourceType: "DiagnosticReport",
          id: drId,
          status: "final",
          category: [
            {
              coding: [
                {
                  system: "http://snomed.info/sct",
                  code: "708196005",
                  display: "Hematology service",
                },
              ],
            },
          ],
          code: {
            text: lab.testType || "Laboratory Report",
            coding: [
              {
                system: "http://loinc.org",
                code: "11502-2",
                display: lab.testType || "Laboratory Report",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          effectiveDateTime: reportDate,
          issued: new Date().toISOString(),
          // performer = Organisation (the lab), NOT the individual analyst
          performer: [{ reference: `urn:uuid:${orgUUID}` }],
          // resultsInterpreter = the analyst who interprets results (per NRCES spec)
          resultsInterpreter: [
            { reference: `urn:uuid:${practitionerUUID}`, display: analystName },
          ],
          result: [{ reference: `urn:uuid:${obsId}` }],
          presentedForm: [],
        },
      };

      // Add conclusion from additionalObservations if available
      if (lab.additionalObservations) {
        drResource.resource.conclusion = lab.additionalObservations;
      }

      bundleEntries.push(drResource);
      sectionEntries.push({ reference: `urn:uuid:${drId}` });

      labRows.push(
        `<tr><td>${escapeHtml(lab.testType || "-")}</td><td>${escapeHtml(lab.resultValue || "-")}</td><td>${escapeHtml(lab.measurementUnit || "-")}</td><td>${lab.reportDate ? toSafeLocaleDateString(lab.reportDate) : "-"}</td><td>${escapeHtml(lab.analystName || "-")}</td></tr>`,
      );
    });

    const labTable = `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th><th>Analyst</th></tr></thead><tbody>${labRows.join("")}</tbody></table>`;

    // Wire PDF reference into section entries BEFORE pushing
    sectionEntries.push({ reference: `urn:uuid:${drDocId}` });
    sections.push({
      title: "Diagnostic Report",
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
      title: "Diagnostic Report",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No lab results stored for this visit.</p></div>`,
      },
    });
  }

  // Batch PDF generation (mirrors fhir.bundle.service.ts pattern)
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
            },
          ],
          title: `Diagnostic Report - ${patientName} - ${visitDateStr}`,
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
    ds?.chiefComplaints || ds?.diagnosis || assessment?.symptomsComplaints || "";
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
    medHistoryParts.push(
      `<p><strong>Bed:</strong> ${escapeHtml(ds.bed)}</p>`,
    );
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
             false
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
       false
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
    investigationParts.push(
      `<p>${escapeHtml(ds.investigationsResults)}</p>`,
    );
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
          chiefComplaintText
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
  if (ds?.carePlan)
    carePlanParts.push(`<p>${escapeHtml(ds.carePlan)}</p>`);
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

const buildImmunizationRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));

  const sections: any[] = [];
  const immunization = optionalData?.assessment?.immunization;
  const vaccineMap: Array<{ name: string; code: string; date?: Date }> = [];

  if (immunization) {
    if (immunization.covid19Dose1Date)
      vaccineMap.push({
        name: "COVID-19 Vaccine Dose 1",
        code: "28531000087107",
        date: immunization.covid19Dose1Date,
      });
    if (immunization.covid19Dose2Date)
      vaccineMap.push({
        name: "COVID-19 Vaccine Dose 2",
        code: "28531000087107",
        date: immunization.covid19Dose2Date,
      });
    if (immunization.tetanusBoosterDate)
      vaccineMap.push({
        name: "Tetanus Booster",
        code: "333621002",
        date: immunization.tetanusBoosterDate,
      });
    if (immunization.fluVaccineDate)
      vaccineMap.push({
        name: "Influenza Vaccine",
        code: "46233009",
        date: immunization.fluVaccineDate,
      });
  }

  if (vaccineMap.length > 0) {
    const immunizationRefs: any[] = [];
    const rows: string[] = [];
    vaccineMap.forEach((v) => {
      const immId = generateUUID();
      bundleEntries.push({
        fullUrl: `urn:uuid:${immId}`,
        resource: {
          resourceType: "Immunization",
          id: immId,
          status: "completed",
          vaccineCode: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: v.code,
                display: v.name,
              },
            ],
            text: v.name,
          },
          patient: { reference: `urn:uuid:${patientUUID}` },
          occurrenceDateTime: v.date
            ? toSafeISOString(v.date)
            : toSafeISOString(visit.visitDate),
        },
      });
      immunizationRefs.push({ reference: `urn:uuid:${immId}` });
      rows.push(
        `<tr><td>${escapeHtml(v.name)}</td><td>${v.date ? toSafeLocaleDateString(v.date) : "-"}</td></tr>`,
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><table border="1" cellpadding="4"><thead><tr><th>Vaccine</th><th>Date</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
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
          author: [{ reference: `urn:uuid:${orgUUID}` }],
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
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildEncounterResource(visit, encounterUUID, patientUUID));

  const sections: any[] = [];
  const parts: string[] = [];

  // Uploaded documents (primary content for HealthDocumentRecord)
  const docUploads = (optionalData?.assessment as any)?.documentUploads as
    | Array<{
        fileName?: string;
        mimeType?: string;
        uploadDate?: Date | string;
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
            code: "371530004",
            display: "Clinical consultation report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${parts.join("")}</div>`,
      },
      entry: [{ reference: `urn:uuid:${encounterUUID}` }],
    });
  } else {
    sections.push({
      title: "Health Document",
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
                code: "371530004",
                display: "Clinical consultation report",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: `urn:uuid:${orgUUID}` }],
          title: `Health Document - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: sections,
        },
      },
      ...bundleEntries,
    ],
  };
};

const buildWellnessRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const visitDate = toSafeISOString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));

  const sections: any[] = [];
  const vitals = optionalData?.assessment?.vitals;

  if (vitals && typeof vitals === "object" && Object.keys(vitals).length > 0) {
    const obsRefs: any[] = [];
    const vitalRows: string[] = [];

    Object.entries(vitals).forEach(([key, rawVal]) => {
      if (rawVal === null || rawVal === undefined || rawVal === "") return;
      const obsId = generateUUID();
      const vitalResult = getVitalValueAndUnit(rawVal as string | number, key);
      const value = vitalResult?.value ?? null;
      const unit = vitalResult?.unit ?? "";
      const obsResource: any = {
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
          code: { text: key },
          subject: { reference: `urn:uuid:${patientUUID}` },
          effectiveDateTime: visitDate,
        },
      };
      if (value !== null && !isNaN(value)) {
        obsResource.resource.valueQuantity = { value, unit };
      } else {
        obsResource.resource.valueString = String(rawVal);
      }
      bundleEntries.push(obsResource);
      obsRefs.push({ reference: `urn:uuid:${obsId}` });
      vitalRows.push(
        `<tr><td>${escapeHtml(key)}</td><td>${value !== null ? value : escapeHtml(String(rawVal))}</td><td>${escapeHtml(unit)}</td></tr>`,
      );
    });

    if (obsRefs.length > 0) {
      sections.push({
        title: "Vital Signs",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "1184593002",
              display: "Vital signs",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><table border="1" cellpadding="4"><thead><tr><th>Vital</th><th>Value</th><th>Unit</th></tr></thead><tbody>${vitalRows.join("")}</tbody></table></div>`,
        },
        entry: obsRefs,
      });
    }
  }

  // Personal / lifestyle data can go here too
  if (sections.length === 0) {
    sections.push({
      title: "Wellness Record",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No wellness/vital sign data recorded for this visit.</p></div>`,
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
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: `urn:uuid:${orgUUID}` }],
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
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));

  const parts: string[] = [];
  parts.push(
    `<p><strong>Visit:</strong> ${escapeHtml(visit.department || "OPD")} - ${visitDateStr}</p>`,
  );
  if ((visit as any).consultationFee)
    parts.push(
      `<p><strong>Consultation Fee:</strong> ₹${(visit as any).consultationFee}</p>`,
    );
  const payment = (visit as any).payment;
  if (payment) {
    if (payment.mode)
      parts.push(
        `<p><strong>Payment Mode:</strong> ${escapeHtml(payment.mode)}</p>`,
      );
    if (payment.amount)
      parts.push(`<p><strong>Amount Paid:</strong> ₹${payment.amount}</p>`);
    if (payment.status)
      parts.push(
        `<p><strong>Payment Status:</strong> ${escapeHtml(payment.status)}</p>`,
      );
  }
  const insurance = (visit as any).insurance;
  if (insurance && insurance.provider) {
    parts.push(
      `<p><strong>Insurance:</strong> ${escapeHtml(insurance.provider)} (Policy: ${escapeHtml(insurance.policyNumber || "N/A")})</p>`,
    );
  }
  if (parts.length <= 1) {
    parts.push(`<p>No billing/invoice details recorded for this visit.</p>`);
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
          subject: { reference: `urn:uuid:${patientUUID}` },
          date: new Date().toISOString(),
          author: [{ reference: `urn:uuid:${orgUUID}` }],
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
              text: {
                status: "generated",
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${parts.join("")}</div>`,
              },
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
      return buildImmunizationRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "HealthDocumentRecord":
      return buildHealthDocumentRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "WellnessRecord":
      return buildWellnessRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "Invoice":
      return buildInvoiceRecordBundle(patient, visit, careContext);
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
  optionalData?: ICombinedBundleOptionalData, // Add optionalData
): any[] => {
  const hiTypes = careContext.hiTypes;
  if (!hiTypes || hiTypes.length === 0) {
    return [
      buildOPConsultationBundle(patient, visit, careContext, optionalData),
    ];
  }

  return hiTypes.map((hiType) =>
    generateFhirBundle(hiType, patient, visit, careContext, optionalData),
  );
};
