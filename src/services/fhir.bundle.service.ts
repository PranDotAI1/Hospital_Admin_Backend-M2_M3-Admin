import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { facilityId, facilityName } from "../utils/constant";

// const buildBloodPressureObservation = (
//   id: string,
//   patientUUID: string,
//   date: string,
//   bp: string,
// ) => {
//   const match = bp.match(/(\d+)\s*\/\s*(\d+)/);
//   if (!match) return null;

//   const systolic = Number(match[1]);
//   const diastolic = Number(match[2]);

//   return {
//     fullUrl: `urn:uuid:${id}`,
//     resource: {
//       resourceType: "Observation",
//       id,
//       status: "final",
//       category: [
//         {
//           coding: [
//             {
//               system:
//                 "http://terminology.hl7.org/CodeSystem/observation-category",
//               code: "vital-signs",
//               display: "Vital Signs",
//             },
//           ],
//         },
//       ],
//       code: {
//         coding: [
//           {
//             system: "http://loinc.org",
//             code: "85354-9",
//             display: "Blood pressure panel",
//           },
//         ],
//         text: "Blood pressure",
//       },
//       subject: { reference: `urn:uuid:${patientUUID}` },
//       effectiveDateTime: date,
//       component: [
//         {
//           code: {
//             coding: [
//               {
//                 system: "http://loinc.org",
//                 code: "8480-6",
//                 display: "Systolic blood pressure",
//               },
//             ],
//           },
//           valueQuantity: {
//             value: systolic,
//             unit: "mmHg",
//           },
//         },
//         {
//           code: {
//             coding: [
//               {
//                 system: "http://loinc.org",
//                 code: "8462-4",
//                 display: "Diastolic blood pressure",
//               },
//             ],
//           },
//           valueQuantity: {
//             value: diastolic,
//             unit: "mmHg",
//           },
//         },
//       ],
//     },
//   };
// };

interface ParsedVital {
  value: number;
  unit: string;
}

const parseVitalValue = (input: string): ParsedVital | null => {
  if (!input) return null;

  const cleaned = String(input).trim();
  if (!cleaned) return null;

  if (cleaned.includes("/")) {
    const match = cleaned.match(/(\d+)\s*\/\s*(\d+)\s*(\w+)?/);
    if (!match) return null;

    return {
      value: NaN,
      unit: match[3] ?? "mmHg",
    };
  }

  const match = cleaned.match(/([\d.]+)\s*([^\d\s]+)?/);
  if (!match) return null;

  const num = Number(match[1]);
  if (Number.isNaN(num)) return null;

  return {
    value: num,
    unit: match[2]?.trim() ?? "",
  };
};

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

const DEFAULT_VITAL_UNITS: Record<string, string> = {
  pulse: "BPM",
  spo2: "%",
  sbp: "mmHg",
  dbp: "mmHg",
  map: "mmHg",
  temp: "C",
  respiration: "bpm",
  painScore: "1",
  height: "CM",
  weight: "KG",
  bsa: "m2",
  bmi: "kg/m2",
  category: "",
  bs: "",
  creatinine: "mg/dL",
  egfr: "mL/min/1.73m2",
  egfr2: "mL/min/1.73m2",
};

const getVitalValueAndUnit = (
  rawValue: string | number | undefined | null,
  key: string,
): { value: number; unit: string } | null => {
  if (rawValue === undefined || rawValue === null || rawValue === "")
    return null;

  const str =
    typeof rawValue === "number" ? String(rawValue) : String(rawValue).trim();
  if (!str) return null;

  const parsed = parseVitalValue(str);
  const num = parsed ? parsed.value : Number(str);
  if (Number.isNaN(num) || typeof num !== "number") return null;

  const defaultUnit = DEFAULT_VITAL_UNITS[key] ?? "";
  const unit = (parsed?.unit?.trim() || defaultUnit).trim() || defaultUnit;
  return { value: num, unit };
};

const isValidDate = (dateString: string | Date): boolean => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/** Return ISO string for FHIR; never throws. Invalid/empty input → current time. */
const toSafeISOString = (date: Date | string | undefined | null): string => {
  if (date == null || date === "") return new Date().toISOString();
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/** Return en-IN date string for display; never throws. Invalid/empty → current date. */
const toSafeLocaleDateString = (
  date: Date | string | undefined | null,
): string => {
  if (date == null || date === "")
    return new Date().toLocaleDateString("en-IN");
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime())
    ? new Date().toLocaleDateString("en-IN")
    : d.toLocaleDateString("en-IN");
};

const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildObservationBase = (
  obsId: string,
  patientUUID: string,
  effectiveDate: string,
  categoryCode: "vital-signs" | "laboratory" | "exam",
  categoryDisplay: string,
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
            code: categoryCode,
            display: categoryDisplay,
          },
        ],
      },
    ],
    subject: { reference: `urn:uuid:${patientUUID}` },
    effectiveDateTime: effectiveDate,
  },
});

const buildVitalObservation = (
  obsId: string,
  patientUUID: string,
  date: string,
  name: string,
  loincCode: string,
  value: number,
  unit: string,
) => {
  const base = buildObservationBase(
    obsId,
    patientUUID,
    date,
    "vital-signs",
    "Vital Signs",
  );

  const code = {
    text: name,
  };

  const valueQuantity = {
    value,
    unit,
  };

  const resource = {
    ...base,
    resource: {
      ...base.resource,
      code,
      valueQuantity,
    },
  };

  return resource;
};

const buildLabObservation = (
  obsId: string,
  patientUUID: string,
  date: string,
  testName: string,
  loincCode: string | null,
  value: string | number,
  unit?: string,
) => {
  const base = buildObservationBase(
    obsId,
    patientUUID,
    date,
    "laboratory",
    "Laboratory",
  );

  const code = loincCode
    ? {
        coding: [
          {
            system: "http://loinc.org",
            code: loincCode,
            display: testName,
          },
        ],
        text: testName,
      }
    : { text: testName };

  const valueQuantity =
    typeof value === "number"
      ? {
          value,
          unit,
        }
      : undefined;

  const valueString = typeof value === "string" ? value : undefined;

  const resource = {
    ...base,
    resource: {
      ...base.resource,
      code,
      valueQuantity,
      valueString,
    },
  };

  return resource;
};

const buildPatientResource = (patient: IPatient, patientUUID: string) => {
  const identifiers: any[] = [];

  if (patient.abhaaddress) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "MR",
            display: "Medical record number",
          },
        ],
      },
      system: "https://healthid.abdm.gov.in",
      value: patient.abhaaddress,
    });
  }

  if (patient.ABHANumber) {
    identifiers.push({
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0203",
            code: "SN",
            display: "Subscriber Number",
          },
        ],
      },
      system: "https://healthid.abdm.gov.in",
      value: patient.ABHANumber,
    });
  }

  let fhirGender = "unknown";
  if (patient.gender) {
    const g = patient.gender.toUpperCase();
    if (g === "M" || g === "MALE") fhirGender = "male";
    else if (g === "F" || g === "FEMALE") fhirGender = "female";
    else if (g === "O" || g === "OTHER") fhirGender = "other";
  }

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();

  return {
    fullUrl: `urn:uuid:${patientUUID}`,
    resource: {
      resourceType: "Patient",
      id: patientUUID,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"],
      },
      identifier: identifiers,
      name: [
        {
          text: patientName,
          family: patient.l_name || "",
          given: [patient.f_name, patient.m_name].filter(Boolean),
        },
      ],
      gender: fhirGender,
      ...(patient.dob && { birthDate: patient.dob }),
      ...(patient.mobile && {
        telecom: [
          {
            system: "phone",
            value: patient.mobile,
            use: "home",
          },
        ],
      }),
    },
  };
};

const buildOrganizationResource = (orgUUID: string) => {
  return {
    fullUrl: `urn:uuid:${orgUUID}`,
    resource: {
      resourceType: "Organization",
      id: orgUUID,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization",
        ],
      },
      identifier: [
        {
          system: "https://facility.abdm.gov.in",
          value: facilityId,
        },
      ],
      name: facilityName,
    },
  };
};

const buildPractitionerResource = (
  doctorName: string,
  practitionerUUID: string,
) => {
  const nameParts = doctorName.split(" ");
  const family = nameParts.length > 1 ? nameParts.pop() : "";
  const given = nameParts;

  return {
    fullUrl: `urn:uuid:${practitionerUUID}`,
    resource: {
      resourceType: "Practitioner",
      id: practitionerUUID,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Practitioner",
        ],
      },
      identifier: [
        {
          system: "https://doctor.ndhm.gov.in",
          value: "DOC-ID-PENDING",
        },
      ],
      name: [
        {
          text: doctorName,
          family: family,
          given: given,
        },
      ],
    },
  };
};

const buildEncounterResource = (
  visit: IScanShareVisit,
  encounterUUID: string,
  patientRef: string,
) => {
  return {
    fullUrl: `urn:uuid:${encounterUUID}`,
    resource: {
      resourceType: "Encounter",
      id: encounterUUID,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Encounter",
        ],
      },
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: "AMB",
        display: "ambulatory",
      },
      subject: { reference: `urn:uuid:${patientRef}` },
      period: {
        start: toSafeISOString(visit.visitDate),
      },
      ...(visit.department && {
        serviceType: {
          coding: [
            {
              display: visit.department,
            },
          ],
        },
      }),
    },
  };
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

  const prescriptionLines: string[] = [];
  if (patient.ongoingMedications) {
    prescriptionLines.push(
      `<p><strong>Ongoing (from records):</strong> ${patient.ongoingMedications}</p>`,
    );
  }
  prescriptionLines.push(
    "<p><strong>Prescribed at this visit:</strong></p><ul>" +
      "<li>Paracetamol 500mg - 1-0-1 (after food) x 5 days</li>" +
      "<li>Cetirizine 10mg - 0-0-1 (at night) x 5 days</li>" +
      "<li>ORS sachets - as needed for hydration</li>" +
      "</ul><p>Advice: Rest, adequate fluids. Review if no improvement in 3 days.</p>",
  );
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${prescriptionLines.join("")}</div>`,
    },
  });

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
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const compositionUUID = generateUUID();

  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const dept = visit.department || "OPD";
  const doctor = visit.doctorName || "Doctor";

  const prescriptionHtml =
    `<p><strong>Consultation:</strong> ${dept} - ${visitDateStr} - ${doctor}</p>` +
    (patient.ongoingMedications
      ? `<p><strong>Ongoing medications (from records):</strong> ${patient.ongoingMedications}</p>`
      : "") +
    `<p>No digital prescription records available for this visit.</p>`;

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
          author: [{ reference: `urn:uuid:${orgUUID}` }],
          title: `Prescription - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: [
            {
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
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
    ],
  };
};

const buildDiagnosticReportRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const labHtml =
    `<p>Diagnostic/lab report for visit: ${visit.department || "OPD"} - ${visitDateStr}</p>` +
    `<p>No lab results stored for this visit. Results will appear here when the facility links lab reports.</p>`;
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
          author: [{ reference: `urn:uuid:${orgUUID}` }],
          title: `Diagnostic Report - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: [
            {
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
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${labHtml}</div>`,
              },
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
      buildEncounterResource(visit, encounterUUID, patientUUID),
    ],
  };
};

const buildDischargeSummaryRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const html =
    `<p>OPD visit. Discharge summary applicable for inpatient admissions.</p>` +
    `<p>Visit: ${visit.department || "OPD"} - ${visitDateStr}. Inpatient discharge summaries will be included when available.</p>`;
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
          author: [{ reference: `urn:uuid:${orgUUID}` }],
          title: `Discharge Summary - ${patientName} - ${visitDateStr}`,
          custodian: { reference: `urn:uuid:${orgUUID}` },
          section: [
            {
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
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
              },
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
      buildEncounterResource(visit, encounterUUID, patientUUID),
    ],
  };
};

const buildImmunizationRecordBundle = (
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
  const html =
    `<p>Immunization record for visit: ${visit.department || "OPD"} - ${visitDateStr}</p>` +
    `<p>No immunization events stored for this visit. Records will appear when the facility captures them.</p>`;
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
          section: [
            {
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
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
              },
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
    ],
  };
};

const buildHealthDocumentRecordBundle = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
): any => {
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const patientName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const visitDateStr = toSafeLocaleDateString(visit.visitDate);
  const html =
    `<p>Health document for visit: ${visit.department || "OPD"} - ${visitDateStr}</p>` +
    `<p>Additional health documents can be attached when the facility supports them.</p>`;
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
          section: [
            {
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
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
              },
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
      buildEncounterResource(visit, encounterUUID, patientUUID),
    ],
  };
};

const buildWellnessRecordBundle = (
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
  const html =
    `<p>Wellness record for visit: ${visit.department || "OPD"} - ${visitDateStr}</p>` +
    `<p>Wellness and lifestyle records can be included when the facility captures them.</p>`;
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
          section: [
            {
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
                div: `<div xmlns="http://www.w3.org/1999/xhtml">${html}</div>`,
              },
            },
          ],
        },
      },
      buildPatientResource(patient, patientUUID),
      buildOrganizationResource(orgUUID),
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
      return buildPrescriptionBundle(patient, visit, careContext);
    case "DiagnosticReport":
      return buildDiagnosticReportRecordBundle(patient, visit, careContext);
    case "DischargeSummary":
      return buildDischargeSummaryRecordBundle(patient, visit, careContext);
    case "ImmunizationRecord":
      return buildImmunizationRecordBundle(patient, visit, careContext);
    case "HealthDocumentRecord":
      return buildHealthDocumentRecordBundle(patient, visit, careContext);
    case "WellnessRecord":
      return buildWellnessRecordBundle(patient, visit, careContext);
    default:
      return buildOPConsultationBundle(
        patient,
        visit,
        careContext,
        optionalData,
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

export interface ICombinedBundleOptionalData {
  prescription?: {
    medications?: Array<{
      medicine: string;
      dosage: string;
      frequency?: string;
      duration?: string;
      instructions?: string;
    }>;
    advice?: string;
  } | null;
  labReports?: Array<{
    testType?: string;
    resultValue?: string;
    measurementUnit?: string;
    reportDate?: Date;
    sampleId?: string;
    additionalObservations?: string;
    analystName?: string;
  }>;
  soapNotes?: {
    subjective?: string;
    objective?: string;
    assessment?: string;
    plan?: string;
  } | null;
  dischargeSummary?: {
    diagnosis?: string;
    clinicalSummary?: string;
    treatmentGiven?: string;
    dischargeMedications?: Array<{
      medicine: string;
      dosage: string;
      frequency?: string;
      duration?: string;
      instructions?: string;
    }>;
  } | null;
  assessment?: {
    vitals?: Record<string, unknown>;
    immunization?: {
      covid19Dose1Date?: Date;
      covid19Dose2Date?: Date;
      tetanusBoosterDate?: Date;
      fluVaccineDate?: Date;
    };
    symptomsComplaints?: string;
    medicalHistory?: Array<{
      disease?: string;
      duration?: string;
      medications?: string;
    }>;
  } | null;
}

const getMedicationDetails = (med: any) => {
  const name =
    med.medicine != null && String(med.medicine).trim() !== ""
      ? String(med.medicine).toLowerCase()
      : "unknown";

  let form = {
    code: "385055001",
    display: "Tablet dose form",
    text: "Tablet",
  };
  let route = {
    code: "26643006",
    display: "Oral Route",
    text: "Oral",
  };
  let method = {
    code: "738995006",
    display: "Swallow",
    text: "Swallow",
  };

  if (med.form && med.form !== "NA") {
    const formLower = String(med.form).toLowerCase();
    if (formLower === "tablet") {
      form = { code: "385055001", display: "Tablet dose form", text: "Tablet" };
    } else if (formLower === "capsule") {
      form = {
        code: "428641000",
        display: "Capsule dose form",
        text: "Capsule",
      };
    } else if (formLower === "syrup") {
      form = { code: "385057009", display: "Syrup", text: "Syrup" };
    } else if (formLower === "injection") {
      form = { code: "385218009", display: "Injection", text: "Injection" };
    } else if (formLower === "drops") {
      form = { code: "385018001", display: "Drops", text: "Drops" };
    } else if (formLower === "cream" || formLower === "ointment") {
      form = { code: "385099005", display: "Cream", text: "Cream" };
    } else {
      form = { code: "736542009", display: med.form, text: med.form };
    }
  }

  if (!med.form) {
    if (name.includes("syr") || name.includes("susp") || name.includes("liq")) {
      form = { code: "385057009", display: "Syrup", text: "Syrup" };
      route = { code: "26643006", display: "Oral Route", text: "Oral" };
      method = { code: "738996007", display: "Drink", text: "Drink" };
    } else if (name.includes("inj") || name.includes("iv")) {
      form = { code: "385218009", display: "Injection", text: "Injection" };
      route = {
        code: "47625008",
        display: "Intravenous route",
        text: "Intravenous",
      };
      method = { code: "422145002", display: "Inject", text: "Inject" };
    } else if (name.includes("cap")) {
      form = {
        code: "428641000",
        display: "Capsule dose form",
        text: "Capsule",
      };
    } else if (
      name.includes("cream") ||
      name.includes("oint") ||
      name.includes("gel")
    ) {
      form = { code: "385099005", display: "Cream", text: "Cream" };
      route = { code: "6064005", display: "Topical route", text: "Topical" };
      method = { code: "419747000", display: "Apply", text: "Apply" };
    } else if (name.includes("drop")) {
      form = { code: "385018001", display: "Drops", text: "Drops" };
    }
  } else if (med.form && String(med.form).trim() !== "" && med.form !== "NA") {
    const formLower = String(med.form).toLowerCase();
    if (formLower === "syrup") {
      route = { code: "26643006", display: "Oral Route", text: "Oral" };
      method = { code: "738996007", display: "Drink", text: "Drink" };
    } else if (formLower === "injection") {
      route = {
        code: "47625008",
        display: "Intravenous route",
        text: "Intravenous",
      };
      method = { code: "422145002", display: "Inject", text: "Inject" };
    } else if (formLower === "cream" || formLower === "ointment") {
      route = { code: "6064005", display: "Topical route", text: "Topical" };
      method = { code: "419747000", display: "Apply", text: "Apply" };
    }
  }

  if (med.route && String(med.route).trim() !== "" && med.route !== "NA") {
    const routeLower = String(med?.route ?? "").toLowerCase();
    if (routeLower === "oral")
      route = { code: "26643006", display: "Oral Route", text: "Oral" };
    else if (routeLower === "intravenous")
      route = {
        code: "47625008",
        display: "Intravenous route",
        text: "Intravenous",
      };
    else if (routeLower === "topical")
      route = { code: "6064005", display: "Topical route", text: "Topical" };
    else route = { code: "26643006", display: med.route, text: med.route };
  }

  if (med.method && String(med.method).trim() !== "" && med.method !== "NA") {
    const methodLower = String(med.method).toLowerCase();
    if (methodLower === "swallow")
      method = { code: "738995006", display: "Swallow", text: "Swallow" };
    else if (methodLower === "drink")
      method = { code: "738996007", display: "Drink", text: "Drink" };
    else if (methodLower === "inject")
      method = { code: "422145002", display: "Inject", text: "Inject" };
    else if (methodLower === "apply")
      method = { code: "419747000", display: "Apply", text: "Apply" };
    else
      method = {
        code: "738995006",
        display: med.method,
        text: med.method,
      };
  }

  return { form, route, method };
};

const buildMedicationRequest = (
  med: any,
  patientUUID: string,
  orgUUID: string,
  practitionerUUID: string,
  doctorName: string,
  date: string,
  medRequestId: string,
) => {
  const { form, route, method } = getMedicationDetails(med);

  return {
    fullUrl: `urn:uuid:${medRequestId}`,
    resource: {
      resourceType: "MedicationRequest",
      id: medRequestId,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/MedicationRequest",
        ],
      },
      status: "active",
      intent: "order",
      medicationCodeableConcept: {
        text: med.medicine,
        coding:
          form.display === "NA"
            ? []
            : [
                {
                  system: "http://snomed.info/sct",
                  code: form.code,
                  display: form.display,
                },
              ],
      },
      subject: { reference: `urn:uuid:${patientUUID}` },
      authoredOn: date,
      requester: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctorName,
      },
      dosageInstruction: [
        {
          text: `${med.dosage ? "dosage: " + med.dosage : ""} ${med.frequency ? " - frequency: " + med.frequency : ""} ${med.duration ? " - duration: " + med.duration : ""} ${med.instructions ? " - instructions: " + med.instructions : ""}`,
          additionalInstruction: [
            {
              coding: [
                {
                  system: "http://snomed.info/sct",
                  code: "311504000",
                  display: med.instructions ?? "",
                },
              ],
            },
          ],
          // ...(med?.frequency
          //   ? {
          //       timing: {
          //         code: {
          //           text: med.frequency ?? "",
          //         },
          //         // repeat: {
          //         //   frequency: 1,
          //         //   period: 1,
          //         //   periodUnit: "d",
          //         // },
          //       },
          //     }
          //   : {}),
          route: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: route.code,
                display: route.display,
              },
            ],
            text: route.text,
          },
          method: {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: method.code,
                display: method.display,
              },
            ],
            text: method.text,
          },
        },
      ],
    },
  };
};

const buildObservationResource = (
  observationText: string,
  obsId: string,
  patId: string,
  date: string,
  practitionerUUID: string,
) => {
  return {
    fullUrl: `urn:uuid:${obsId}`,
    resource: {
      resourceType: "Observation",
      id: obsId,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationLifestyle",
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p class="res-header-id"><b>Generated Narrative: Observation</b></p><a name="example-36"> </a><a name="hcexample-36"> </a><a name="example-36-hi-IN"> </a><p><b>status</b>: Final</p><p><b>code</b>: <span title="Codes:{http://snomed.info/sct 228509002}">Finding relating to tobacco chewing</span></p><p><b>subject</b>: <a href="Patient-example-01.html">ABC Male, DoB: 1981-01-12 ( Medical record number: 22-7225-4829-5255)</a></p><p><b>effective</b>: 2020-09-29</p><p><b>performer</b>: <a href="Organization-example-01.html">Organization XYZ Lab Pvt.Ltd.</a></p><p><b>value</b>: <span title="Codes:{http://snomed.info/sct 228512004}">${observationText}</span></p></div>`,
      },
      status: "final",
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "228509002",
            display: observationText,
          },
        ],
        text: observationText,
      },
      subject: {
        reference: `urn:uuid:${patId}`,
      },
      effectiveDateTime: date,
      performer: [
        {
          reference: `urn:uuid:${practitionerUUID}`,
        },
      ],
      valueCodeableConcept: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "228512004",
            display: observationText,
          },
        ],
        text: observationText,
      },
    },
  };
};

const buildConditionResource = (
  complaintText: string,
  condId: string,
  patId: string,
  date: string,
  practitionerUUID: string,
  isAssessment: boolean = false,
) => {
  return {
    fullUrl: `urn:uuid:${condId}`,
    resource: {
      resourceType: "Condition",
      id: condId,
      meta: {
        profile: [
          "https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition",
        ],
      },
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: "active",
            display: "Active",
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            code: "confirmed",
            display: "Confirmed",
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: isAssessment ? "409586006" : "409586006",
              display: isAssessment ? "Assessment" : "Complaint",
            },
          ],
        },
      ],
      code: {
        text: complaintText,
      },
      subject: { reference: `urn:uuid:${patId}` },
      onsetDateTime: date,
      recorder: { reference: `urn:uuid:${practitionerUUID}` },
    },
  };
};

const buildPlanResource = (
  planText: string,
  condId: string,
  patId: string,
  date: string,
  practitionerUUID: string,
) => {
  return {
    fullUrl: `urn:uuid:${condId}`,
    resource: {
      resourceType: "CarePlan",
      id: condId,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/CarePlan"],
      },
      text: {
        status: "additional",
        div: '<div xmlns="http://www.w3.org/1999/xhtml">Care Plan</div>',
      },
      // status: "active",
      intent: "plan",
      // category: [
      //   {
      //     coding: [
      //       {
      //         system: "http://snomed.info/sct",
      //         code: "736368003",
      //         display: "Coronary heart disease care plan",
      //       },
      //     ],
      //   },
      // ],

      code: {
        text: planText,
      },
      title: "Coronary heart disease care plan",
      description: planText,
      subject: { reference: `urn:uuid:${patId}` },
      // author: "author",
      // goal:" goal ",
      // period: {
      //   start: date,
      // },
      recorder: { reference: `urn:uuid:${practitionerUUID}` },
    },
  };
};

/** Section title → hiType(s) for consent-based filtering (share only consented hiTypes) */
const SECTION_HITYPE: Record<string, HIType | HIType[]> = {
  "Chief Complaint": "OPConsultation",
  "Physical Examination": "OPConsultation",
  "Assessment and Diagnosis": "OPConsultation",
  "Plan of Care": "OPConsultation",
  "Diagnostic Test Results": "DiagnosticReport",
  "Vital Signs": "WellnessRecord",
  "Medical History": "OPConsultation",
  Prescription: "Prescription",
  "Diagnostic Report / Lab": "DiagnosticReport",
  "Discharge Summary": "DischargeSummary",
  "Immunization Record": "ImmunizationRecord",
  "Health Document / Wellness": ["WellnessRecord", "HealthDocumentRecord"],
};

const includeSectionByHiType = (
  sectionTitle: string,
  allowedHiTypes: HIType[] | undefined,
): boolean => {
  if (!allowedHiTypes || allowedHiTypes.length === 0) return true;
  const hiType = SECTION_HITYPE[sectionTitle];
  if (!hiType) return true;
  const types = Array.isArray(hiType) ? hiType : [hiType];
  return types.some((t) => allowedHiTypes.includes(t));
};

export const generateCombinedBundleForCareContext = (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  /** When set, only include sections for these hiTypes (consent-based filtering per ABDM) */
  allowedHiTypes?: HIType[],
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

  const dept = visit.department || "OPD";
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

  // sections.push({
  //   title: "Encounter",
  //   entry: [
  //     {
  //       reference: `urn:uuid:${encounterUUID}`,
  //     },
  //   ],
  // });

  const chiefComplaint = visit.complaint || "General OPD consultation";
  const visitInfoParts: string[] = [];
  if (dept) visitInfoParts.push(`Department: ${dept}`);
  if (doctor) visitInfoParts.push(`Doctor: ${doctor}`);
  visitInfoParts.push(`Visit Date: ${visitDateStr}`);
  visitInfoParts.push(
    `Token: ${visit.tokenNumber || careContext.careContextReference || "N/A"}`,
  );
  // S
  sections.push({
    title: "Chief Complaint",
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
      bundleDate,
      practitionerUUID,
    );
    bundleEntries.push(condition);
    sections[sections.length - 1].entry.push({
      reference: `urn:uuid:${conditionUUID}`,
    });
  }

  // O
  sections.push({
    title: "Physical Examination",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "10154-3",
          display: "Physical Examination",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Physical Examination:</strong> ${optionalData?.soapNotes?.objective}</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });

  if (optionalData?.soapNotes?.objective) {
    const conditionUUID = generateUUID();
    const condition = buildObservationResource(
      optionalData?.soapNotes?.objective,
      conditionUUID,
      patientUUID,
      bundleDate,
      practitionerUUID,
    );
    bundleEntries.push(condition);
    sections[sections.length - 1].entry.push({
      reference: `urn:uuid:${conditionUUID}`,
    });
  }

  // A
  sections.push({
    title: "Assessment and Diagnosis",
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Assessment and Diagnosis:</strong> ${optionalData?.soapNotes?.assessment}</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });

  if (optionalData?.soapNotes?.assessment) {
    const assessmentUUID = generateUUID();
    const assessment = buildConditionResource(
      optionalData?.soapNotes?.assessment,
      assessmentUUID,
      patientUUID,
      bundleDate,
      practitionerUUID,
      true,
    );
    bundleEntries.push(assessment);
    sections[sections.length - 1].entry.push({
      reference: `urn:uuid:${assessmentUUID}`,
    });
  }

  // P
  sections.push({
    title: "Plan of Care",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "18776-5",
          display: "Plan of care note",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Plan of care:</strong> ${optionalData?.soapNotes?.plan}</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });
  if (optionalData?.soapNotes?.plan) {
    const planUUID = generateUUID();
    const plan = buildPlanResource(
      optionalData?.soapNotes?.plan,
      planUUID,
      patientUUID,
      bundleDate,
      practitionerUUID,
    );
    bundleEntries.push(plan);
    sections[sections.length - 1].entry.push({
      reference: `urn:uuid:${planUUID}`,
    });
  }

  // sample
  sections.push({
    title: "Diagnostic Test Results",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "18776-5",
          display: "Diagnostic Test Results",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Diagnostic Test Results:</strong> "{labs reports}"</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });
  if (optionalData?.labReports?.length) {
    //     obsId: string,
    // patientUUID: string,
    // date: string,
    // testName: string,
    // loincCode: string | null,
    // value: string | number,
    // unit?: string,
    optionalData?.labReports?.map((report) => {
      const planUUID = generateUUID();

      const plan = buildLabObservation(
        planUUID,
        patientUUID,
        toSafeISOString(report?.reportDate),
        report?.testType ?? "",
        "",
        report?.resultValue ?? "",
        report?.measurementUnit ?? "",
      );
      bundleEntries.push(plan);
      sections[sections.length - 1].entry.push({
        reference: `urn:uuid:${planUUID}`,
      });
    });
  }
  // vitals sample
  sections.push({
    title: "Vital Signs",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "18776-5",
          display: "Vital Signs",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Diagnostic Test Results:</strong> "{labs reports}"</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });
  if (optionalData?.assessment?.vitals) {
    const vitals = optionalData.assessment.vitals as Record<
      string,
      string | number | undefined
    >;

    Object.keys(vitals).forEach((assessmentKey) => {
      if (!VITAL_KEYS.includes(assessmentKey as (typeof VITAL_KEYS)[number]))
        return;

      const valueAndUnit = getVitalValueAndUnit(
        vitals[assessmentKey],
        assessmentKey,
      );
      if (valueAndUnit === null) return;

      const { value, unit } = valueAndUnit;
      if (Number.isNaN(value) || typeof value !== "number") return;

      const assessmentUUID = generateUUID();
      const assessment = buildVitalObservation(
        assessmentUUID,
        patientUUID,
        bundleDate,
        assessmentKey,
        "",
        value,
        unit,
      );
      bundleEntries.push(assessment);
      sections[sections.length - 1].entry.push({
        reference: `urn:uuid:${assessmentUUID}`,
      });
    });
  }

  const prescriptionMeds =
    (optionalData?.prescription?.medications?.length ?? 0) > 0
      ? optionalData!.prescription!.medications!
      : optionalData?.dischargeSummary?.dischargeMedications;

  if (prescriptionMeds && prescriptionMeds.length > 0) {
    const medRequestEntries: any[] = [];

    prescriptionMeds.forEach((m) => {
      const medRequestId = generateUUID();
      const medResource = buildMedicationRequest(
        m,
        patientUUID,
        orgUUID,
        practitionerUUID,
        doctor,
        bundleDate,
        medRequestId,
      );
      bundleEntries.push(medResource);
      medRequestEntries.push({ reference: `urn:uuid:${medRequestId}` });
    });

    const prescriptionTable = prescriptionMeds
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.medicine)}</td><td>${escapeHtml(m.dosage)}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
      )
      .join("");
    const prescriptionAdvice = optionalData?.prescription?.advice ?? "";
    const prescriptionHtml =
      `<p><strong>Consultation:</strong> ${dept} - ${visitDateStr} - ${doctor}</p>` +
      (patient.ongoingMedications
        ? `<p><strong>Ongoing medications (from records):</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
        : "") +
      `<p><strong>Prescribed at this visit:</strong></p>` +
      `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${prescriptionTable}</tbody></table>` +
      (prescriptionAdvice
        ? `<p><strong>Advice:</strong> ${escapeHtml(prescriptionAdvice)}</p>`
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
      entry: medRequestEntries,
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
  const assessHistory = optionalData?.assessment?.medicalHistory;
  if (assessHistory && assessHistory.length > 0) {
    assessHistory.forEach((h) => {
      const line = [h.disease, h.duration, h.medications]
        .filter(Boolean)
        .join(" – ");
      if (line) historyParts.push(line);
    });
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${historyParts.join("<br/>")}</p></div>`,
      },
    });
  }

  const labReports = optionalData?.labReports;
  const labHtml =
    labReports && labReports.length > 0
      ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Sample ID</th><th>Report Date</th><th>Analyst</th><th>Notes</th></tr></thead><tbody>` +
        labReports
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.testType ?? "-")}</td><td>${escapeHtml(r.resultValue ?? "-")}</td><td>${escapeHtml(r.measurementUnit ?? "-")}</td><td>${escapeHtml(r.sampleId ?? "-")}</td><td>${r.reportDate != null ? toSafeLocaleDateString(r.reportDate) : "-"}</td><td>${escapeHtml(r.analystName ?? "-")}</td><td>${escapeHtml(r.additionalObservations ?? "-")}</td></tr>`,
          )
          .join("") +
        `</tbody></table>`
      : `<p>No lab reports stored for this visit at the facility.</p>`;
  sections.push({
    title: "Diagnostic Report / Lab",
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${labHtml}</div>`,
    },
  });

  const ds = optionalData?.dischargeSummary;
  const dischargeHtml =
    ds && (ds.diagnosis || ds.clinicalSummary || ds.treatmentGiven)
      ? [
          ds.diagnosis &&
            `<p><strong>Diagnosis:</strong> ${escapeHtml(ds.diagnosis)}</p>`,
          ds.clinicalSummary &&
            `<p><strong>Clinical Summary:</strong> ${escapeHtml(ds.clinicalSummary)}</p>`,
          ds.treatmentGiven &&
            `<p><strong>Treatment Given:</strong> ${escapeHtml(ds.treatmentGiven)}</p>`,
        ]
          .filter(Boolean)
          .join("")
      : `<p>OPD visit. No discharge summary applicable. Inpatient discharge summaries will be included when available.</p>`;
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${dischargeHtml}</div>`,
    },
  });

  const imm = optionalData?.assessment?.immunization;
  const immParts: string[] = [];
  if (imm) {
    if (imm.covid19Dose1Date)
      immParts.push(
        `COVID-19 Dose 1: ${toSafeLocaleDateString(imm.covid19Dose1Date)}`,
      );
    if (imm.covid19Dose2Date)
      immParts.push(
        `COVID-19 Dose 2: ${toSafeLocaleDateString(imm.covid19Dose2Date)}`,
      );
    if (imm.tetanusBoosterDate)
      immParts.push(
        `Tetanus Booster: ${toSafeLocaleDateString(imm.tetanusBoosterDate)}`,
      );
    if (imm.fluVaccineDate)
      immParts.push(
        `Flu Vaccine: ${toSafeLocaleDateString(imm.fluVaccineDate)}`,
      );
  }
  const immunizationHtml =
    immParts.length > 0
      ? `<p>${immParts.join("<br/>")}</p>`
      : `<p>No immunization records stored for this visit.</p>`;
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${immunizationHtml}</div>`,
    },
  });

  const symptoms = optionalData?.assessment?.symptomsComplaints;
  const wellnessHtml = symptoms
    ? `<p><strong>Symptoms / Complaints:</strong> ${escapeHtml(symptoms)}</p>`
    : `<p>Additional health documents and wellness records can be shared when the HIP supports them.</p>`;
  sections.push({
    title: "Health Document / Wellness",
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${wellnessHtml}</div>`,
    },
  });

  // Filter sections by consented hiTypes when provided (ABDM: share only what consent allows)
  const filteredSections =
    allowedHiTypes && allowedHiTypes.length > 0
      ? sections.filter((s) =>
          includeSectionByHiType(s.title, allowedHiTypes),
        )
      : sections;

  const compositionResource = {
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
      title: `Health Record - ${patientName} - ${visitDateStr}`,
      custodian: { reference: `urn:uuid:${orgUUID}` },
      section: filteredSections,
    },
  };

  bundleEntries.unshift(compositionResource);

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
    entry: bundleEntries,
  };
};

export const FhirBundleService = {
  generateFhirBundle,
  generateFhirBundlesForCareContext,
  generateCombinedBundleForCareContext,
  buildPatientResource,
  buildOrganizationResource,
  buildEncounterResource,
};

export default FhirBundleService;
