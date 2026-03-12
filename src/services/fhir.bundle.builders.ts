/**
 * Per-HI-type FHIR Bundle Builders (standalone bundles, NOT currently used in production).
 *
 * Production flows use `generateCombinedBundleForCareContext` in fhir.bundle.service.ts
 * with `allowedHiTypes` filtering for both per-type and legacy CareContexts.
 *
 * These builders are kept for potential future use and reference.
 */
import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { facilityId } from "../utils/constant";
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

const buildOPConsultationBundle = (
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
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
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

  const historyParts: string[] = [];
  if (patient.allergies) historyParts.push(`Allergies: ${patient.allergies}`);
  if (patient.existingMedicalConditions)
    historyParts.push(
      `Existing Conditions: ${patient.existingMedicalConditions}`,
    );
  if (patient.ongoingMedications)
    historyParts.push(`Ongoing Medications: ${patient.ongoingMedications}`);

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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${historyParts.join("<br/>")}</p></div>`,
      },
    });
  }

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

const buildPrescriptionBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();

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
        
        const durStr = m.duration ? `${m.duration} ${m.durationUnit || "days"}` : "-";
        
        let instParts = [];
        if (m.instructions && m.instructions !== "Other") instParts.push(m.instructions);
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

const buildDiagnosticReportRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));
  bundleEntries.push(buildEncounterResource(visit, encounterUUID, patientUUID));

  const sections: any[] = [];
  const labs = optionalData?.labReports;

  if (labs && labs.length > 0) {
    const obsRefs: any[] = [];
    const labRows: string[] = [];
    labs.forEach((lab) => {
      const obsId = generateUUID();
      const parsed = lab.resultValue ? parseVitalValue(lab.resultValue) : null;
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
                  code: "laboratory",
                  display: "Laboratory",
                },
              ],
            },
          ],
          code: { text: lab.testType || "Lab Test" },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          effectiveDateTime: lab.reportDate
            ? toSafeISOString(lab.reportDate)
            : toSafeISOString(visit.visitDate),
          performer: lab.analystName
            ? [{ display: lab.analystName }]
            : [{ reference: `urn:uuid:${orgUUID}` }],
        },
      };
      if (parsed && parsed.value !== null) {
        obsResource.resource.valueQuantity = {
          value: parsed.value,
          unit: lab.measurementUnit || parsed.unit || "",
        };
      } else if (lab.resultValue) {
        obsResource.resource.valueString = lab.resultValue;
      }
      if (lab.additionalObservations) {
        obsResource.resource.note = [{ text: lab.additionalObservations }];
      }
      bundleEntries.push(obsResource);
      obsRefs.push({ reference: `urn:uuid:${obsId}` });
      labRows.push(
        `<tr><td>${escapeHtml(lab.testType || "-")}</td><td>${escapeHtml(lab.resultValue || "-")}</td><td>${escapeHtml(lab.measurementUnit || "-")}</td><td>${lab.reportDate ? toSafeLocaleDateString(lab.reportDate) : "-"}</td><td>${escapeHtml(lab.analystName || "-")}</td></tr>`,
      );
    });

    // DiagnosticReport resource referencing the observations
    const drId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${drId}`,
      resource: {
        resourceType: "DiagnosticReport",
        id: drId,
        status: "final",
        code: { text: "Laboratory Report" },
        subject: { reference: `urn:uuid:${patientUUID}` },
        encounter: { reference: `urn:uuid:${encounterUUID}` },
        effectiveDateTime: toSafeISOString(visit.visitDate),
        result: obsRefs,
      },
    });

    const labTable = `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th><th>Analyst</th></tr></thead><tbody>${labRows.join("")}</tbody></table>`;
    sections.push({
      title: "Diagnostic Report",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "4241000179101",
            display: "Diagnostic report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${labTable}</div>`,
      },
      entry: [{ reference: `urn:uuid:${drId}` }, ...obsRefs],
    });
  } else {
    sections.push({
      title: "Diagnostic Report",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "4241000179101",
            display: "Diagnostic report",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>No lab results stored for this visit.</p></div>`,
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
              "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord",
            ],
          },
          status: "final",
          type: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: "4241000179101",
                display: "Diagnostic report",
              },
            ],
          },
          subject: { reference: `urn:uuid:${patientUUID}` },
          encounter: { reference: `urn:uuid:${encounterUUID}` },
          date: new Date().toISOString(),
          author: [
            { reference: `urn:uuid:${practitionerUUID}`, display: doctor },
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

const buildDischargeSummaryRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const doctor = visit.doctorName || "Doctor";

  const bundleEntries: any[] = [];
  bundleEntries.push(buildPatientResource(patient, patientUUID));
  bundleEntries.push(buildOrganizationResource(orgUUID));
  bundleEntries.push(buildPractitionerResource(doctor, practitionerUUID));
  bundleEntries.push(buildEncounterResource(visit, encounterUUID, patientUUID));

  const sections: any[] = [];
  const ds = optionalData?.dischargeSummary;

  if (
    ds &&
    (ds.diagnosis ||
      ds.clinicalSummary ||
      ds.treatmentGiven ||
      (ds.dischargeMedications && ds.dischargeMedications.length > 0))
  ) {
    const parts: string[] = [];
    if (ds.diagnosis)
      parts.push(
        `<p><strong>Diagnosis:</strong> ${escapeHtml(ds.diagnosis)}</p>`,
      );
    if (ds.clinicalSummary)
      parts.push(
        `<p><strong>Clinical Summary:</strong> ${escapeHtml(ds.clinicalSummary)}</p>`,
      );
    if (ds.treatmentGiven)
      parts.push(
        `<p><strong>Treatment Given:</strong> ${escapeHtml(ds.treatmentGiven)}</p>`,
      );
    if (ds.dischargeMedications && ds.dischargeMedications.length > 0) {
      const medRows = ds.dischargeMedications
        .map(
          (m) =>
            `<tr><td>${escapeHtml(m.medicine)}</td><td>${escapeHtml(m.dosage)}</td><td>${m.frequency ?? "-"}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
        )
        .join("");
      parts.push(
        `<p><strong>Discharge Medications:</strong></p><table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medRows}</tbody></table>`,
      );

      // Also create MedicationRequest entries for discharge meds
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
          ),
        );
      });
    }

    sections.push({
      title: "Discharge Summary",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${parts.join("")}</div>`,
      },
    });
  } else {
    sections.push({
      title: "Discharge Summary",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>OPD visit. Discharge summary applicable for inpatient admissions.</p><p>Visit: ${escapeHtml(visit.department || "OPD")} - ${visitDateStr}.</p></div>`,
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

  // Medical history from assessment
  const medHist = optionalData?.assessment?.medicalHistory;
  if (medHist && medHist.length > 0) {
    const histRows = medHist
      .map(
        (h) =>
          `<tr><td>${escapeHtml(h.disease || "-")}</td><td>${escapeHtml(h.duration || "-")}</td><td>${escapeHtml(h.medications || "-")}</td></tr>`,
      )
      .join("");
    parts.push(
      `<p><strong>Medical History:</strong></p><table border="1" cellpadding="4"><thead><tr><th>Condition</th><th>Duration</th><th>Medications</th></tr></thead><tbody>${histRows}</tbody></table>`,
    );
  }

  // Patient-level history
  if (patient.allergies)
    parts.push(
      `<p><strong>Allergies:</strong> ${escapeHtml(typeof patient.allergies === "string" ? patient.allergies : String(patient.allergies))}</p>`,
    );
  if (patient.existingMedicalConditions)
    parts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  if (patient.ongoingMedications)
    parts.push(
      `<p><strong>Ongoing Medications:</strong> ${escapeHtml(patient.ongoingMedications)}</p>`,
    );

  // SOAP notes as document text
  const soap = optionalData?.soapNotes;
  if (
    soap &&
    (soap.subjective || soap.objective || soap.assessment || soap.plan)
  ) {
    if (soap.subjective)
      parts.push(
        `<p><strong>Subjective:</strong> ${escapeHtml(soap.subjective)}</p>`,
      );
    if (soap.objective)
      parts.push(
        `<p><strong>Objective:</strong> ${escapeHtml(soap.objective)}</p>`,
      );
    if (soap.assessment)
      parts.push(
        `<p><strong>Assessment:</strong> ${escapeHtml(soap.assessment)}</p>`,
      );
    if (soap.plan)
      parts.push(`<p><strong>Plan:</strong> ${escapeHtml(soap.plan)}</p>`);
  }

  // Symptoms/complaints from assessment
  if (optionalData?.assessment?.symptomsComplaints) {
    parts.push(
      `<p><strong>Symptoms/Complaints:</strong> ${escapeHtml(optionalData.assessment.symptomsComplaints)}</p>`,
    );
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

export const generateFhirBundle = (
  hiType: HIType,
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData, // Add optionalData
): any => {
  switch (hiType) {
    case "OPConsultation":
      return buildOPConsultationBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "Prescription":
      return buildPrescriptionBundle(patient, visit, careContext, optionalData);
    case "DiagnosticReport":
      return buildDiagnosticReportRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
    case "DischargeSummary":
      return buildDischargeSummaryRecordBundle(
        patient,
        visit,
        careContext,
        optionalData,
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
      return buildOPConsultationBundle(
        patient,
        visit,
        careContext,
        optionalData,
      );
  }
};

const buildPdfDocumentReference = (
  docId: string,
  patientUUID: string,
  title: string,
  typeCode: string, // LOINC or SNOMED code
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
