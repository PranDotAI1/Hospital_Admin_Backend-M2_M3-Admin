import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { IVisitDayCareBilling } from "../models/VisitDayCareBilling";
import { Browser } from "puppeteer";

import { facilityId, facilityName } from "../utils/constant";
import { generateMultiplePdfs, generatePdfFromHtml } from "./pdf.service";
import {
  getPrescriptionTemplate,
  getDiagnosticReportTemplate,
  getDischargeSummaryTemplate,
  getOPConsultationTemplate,
  getInvoiceTemplate,
} from "../utils/report-templates";

interface ParsedVital {
  value: number;
  unit: string;
}

export const parseVitalValue = (input: string): ParsedVital | null => {
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

export const getVitalValueAndUnit = (
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

const toFhirDate = (dob: string | Date | undefined | null): string => {
  if (dob == null || dob === "") return "";
  if (dob instanceof Date) {
    return Number.isNaN(dob.getTime()) ? "" : dob.toISOString().slice(0, 10);
  }
  const s = String(dob).trim();
  const ddmmyyyy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
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

const getPriceComponent = (
  sequence: number,
  chargeItemReference: string,
  basePrice: number,
  mrp: number,
  discount: number,
  cgst: number,
  sgst: number,
) => {
  return {
    sequence: sequence,
    chargeItemReference: {
      reference: chargeItemReference,
    },
    priceComponent: [
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
        amount: {
          value: basePrice,
          currency: "INR",
        },
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
        amount: {
          value: mrp,
          currency: "INR",
        },
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
        amount: {
          value: discount,
          currency: "INR",
        },
      },
      {
        type: "tax",
        code: {
          coding: [
            {
              system:
                "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
              code: "03",
              display: "CGST",
            },
          ],
        },
        amount: {
          value: cgst,
          currency: "INR",
        },
      },
      {
        type: "tax",
        code: {
          coding: [
            {
              system:
                "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components",
              code: "04",
              display: "SGST",
            },
          ],
        },
        amount: {
          value: sgst,
          currency: "INR",
        },
      },
    ],
  };
};

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

const buildInvoiceResource = (
  invoiceId: string,
  date: string,
  totalValue: number,
  billings: any[],
) => {
  const lineItems = billings.map((b, index) => ({
    sequence: index + 1,
    chargeItemCodeableConcept: {
      coding: [
        {
          system: "http://snomed.info/sct",
          code: "183654001", // Medical consultation
          display: b.particulars || "Service",
        },
      ],
      text: b.particulars,
    },
    priceComponent: [
      {
        type: "base",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "183654001", // Medical consultation
              display: "Rate",
            },
          ],
        },
        amount: {
          value: b.amount,
          currency: "INR",
        },
      },
    ],
  }));

  const billingRows = billings
    .map(
      (b) =>
        `<tr><td>${b.particulars || "Service"}</td><td>${b.amount}</td></tr>`,
    )
    .join("");

  return {
    fullUrl: `urn:uuid:${invoiceId}`,
    resource: {
      resourceType: "Invoice",
      id: invoiceId,
      meta: {
        versionId: "1",
        lastUpdated: date,
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Invoice"],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">
          <p><b>Invoice Details</b></p>
          <table border="1" style="border-collapse: collapse;">
            <thead>
              <tr><th>Item</th><th>Cost</th></tr>
            </thead>
            <tbody>
              ${billingRows}
              <tr><td><b>Total</b></td><td><b>${totalValue}</b></td></tr>
            </tbody>
          </table>
        </div>`,
      },
      identifier: [
        {
          system: "https://nrces.in/ndhm/fhir/r4/Identifier/Invoice",
          value: invoiceId,
        },
      ],
      status: "issued",
      date: date,
      totalNet: {
        value: totalValue,
        currency: "INR",
      },
      totalGross: {
        value: totalValue,
        currency: "INR",
      },
      lineItem: lineItems,
    },
  };
};

export const buildPatientResource = (
  patient: IPatient,
  patientUUID: string,
) => {
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
      ...(patient.dob && {
        birthDate: toFhirDate(patient.dob),
      }),
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

export const buildOrganizationResource = (orgUUID: string) => {
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

export const buildPractitionerResource = (
  doctorName: string,
  practitionerUUID: string,
  doctorId?: string,
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
          value: doctorId ?? doctorName,
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

export const buildEncounterResource = (
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

export interface ICombinedBundleOptionalData {
  billing?: IVisitDayCareBilling | null;
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
    admissionDate?: Date;
    dischargeDate?: Date;
    ward?: string;
    bed?: string;
    conditionAtDischarge?: string;
    followUpInstructions?: string;
    surgicalProcedures?: string;
    surgicalNote?: string;
    admissionNotes?: string;
    investigationsResults?: string;
    doctorSignature?: string;
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
    surgicalHistory?: Array<{
      surgical?: string;
      surgeonName?: string;
      date?: Date;
      hospital?: string;
    }>;
    personalHistory?: Array<{
      diet?: string;
      appetite?: string;
      sleep?: string;
      blader?: string;
      bowel?: string;
    }>;
    additionalDetails?: Array<{
      type?: string;
      duration?: string;
      units?: string;
      frequency?: string;
      action?: string;
    }>;
    documentUploads?: string[];
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

export const buildMedicationRequest = (
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
          text: `${med.frequency ? "frequency: " + med.frequency : ""} ${med.duration ? " - duration: " + med.duration : ""} ${med.instructions ? " - instructions: " + med.instructions : ""}`,
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><b>Observation:</b> ${escapeHtml(observationText)}</p><p><b>Date:</b> ${date}</p></div>`,
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
      // valueCodeableConcept: {
      //   coding: [
      //     {
      //       system: "http://snomed.info/sct",
      //       code: "228512004",
      //       display: observationText,
      //     },
      //   ],
      //   text: observationText,
      // },
    },
  };
};

export const buildConditionResource = (
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

export const buildProcedureResource = (
  procedureText: string,
  procId: string,
  patId: string,
  date: string,
  practitionerUUID: string,
) => {
  return {
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
      code: {
        text: procedureText,
      },
      subject: { reference: `urn:uuid:${patId}` },
      performedDateTime: date,
      performer: [
        {
          actor: { reference: `urn:uuid:${practitionerUUID}` },
        },
      ],
    },
  };
};

export const buildSocialObservation = (
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
      status: "final",
      category: [
        {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "social-history",
              display: "Social History",
            },
          ],
        },
      ],
      code: {
        text: observationText,
      },
      subject: { reference: `urn:uuid:${patId}` },
      effectiveDateTime: date,
      performer: [
        {
          reference: `urn:uuid:${practitionerUUID}`,
        },
      ],
      valueString: observationText,
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

/** Section title → hiType(s) for consent-based filtering (share only consented hiTypes) */
const SECTION_HITYPE: Record<string, HIType | HIType[]> = {
  "Chief Complaint": "OPConsultation",
  Symptoms: "OPConsultation",
  "Physical Examination": "OPConsultation",
  "Assessment and Diagnosis": "OPConsultation",
  "Plan of Care": "OPConsultation",
  "Diagnostic Test Results": "DiagnosticReport",
  "Vital Signs": ["OPConsultation", "WellnessRecord"],
  "Medical History": "OPConsultation",
  "Surgical History": "OPConsultation",
  "Social History": "OPConsultation",
  Prescription: "Prescription",
  "Discharge Summary": "DischargeSummary",
  "Immunization Record": ["OPConsultation", "ImmunizationRecord"],
  "Health Document / Wellness": [
    "OPConsultation",
    "WellnessRecord",
    "HealthDocumentRecord",
  ],
  Invoice: ["OPConsultation", "Invoice"],
  "Consultation Fee": ["Invoice", "OPConsultation"],
  "Health Document": [
    "HealthDocumentRecord",
    "OPConsultation",
    "WellnessRecord",
    "DischargeSummary",
  ],
  Documents: [
    "OPConsultation",
    "DiagnosticReport",
    "Prescription",
    "DischargeSummary",
    "ImmunizationRecord",
    "HealthDocumentRecord",
    "WellnessRecord",
    "Invoice",
  ],
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

export const generateCombinedBundleForCareContext = async (
  patient: IPatient,
  visit: IScanShareVisit,
  careContext: ICareContext,
  optionalData?: ICombinedBundleOptionalData,
  /** When set, only include sections for these hiTypes (consent-based filtering per ABDM) */
  allowedHiTypes?: HIType[],
  browser?: Browser,
): Promise<any> => {
  console.log("allowedHiTypes", allowedHiTypes);
  const bundleId = generateUUID();
  const patientUUID = generateUUID();
  const orgUUID = generateUUID();
  const practitionerUUID = generateUUID();
  const encounterUUID = generateUUID();
  const compositionUUID = generateUUID();
  const dischargeSummaryDocId = generateUUID();
  const prescriptionDocId = generateUUID();
  const diagnosticReportDocId = generateUUID();
  const opConsultationDocId = generateUUID();

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
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Chief Complaint:</strong> ${escapeHtml(chiefComplaint).replace(/\n/g, "<br/>")}</p><p><strong>Visit Details:</strong><br/>${visitInfoParts.join("<br/>")}</p></div>`,
    },
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
  });

  if (visit.complaint) {
    const conditionUUID = generateUUID();
    const condition = buildConditionResource(
      chiefComplaint,
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

  // Symptoms Section
  if (optionalData?.assessment?.symptomsComplaints) {
    sections.push({
      title: "Symptoms",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "10164-2", // History of present illness
            display: "History of present illness",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Symptoms:</strong> ${escapeHtml(optionalData.assessment.symptomsComplaints).replace(/\n/g, "<br/>")}</p></div>`,
      },
      entry: [{ reference: `urn:uuid:${encounterUUID}` }],
    });
  }

  // O
  sections.push({
    title: "Physical Examination",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "29545-1",
          display: "Physical examination",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Physical Examination:</strong></p><p>${escapeHtml(optionalData?.soapNotes?.objective || "No physical examination notes").replace(/\n/g, "<br/>")}</p></div>`,
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
          code: "51848-0",
          display: "Assessment",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Assessment and Diagnosis:</strong></p><p>${escapeHtml(optionalData?.soapNotes?.assessment || "No assessment notes").replace(/\n/g, "<br/>")}</p></div>`,
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
      div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Plan of care:</strong></p><p>${escapeHtml(optionalData?.soapNotes?.plan || "No plan of care notes").replace(/\n/g, "<br/>")}</p></div>`,
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

  // Vital Signs — with real vitals in the narrative
  const vitalRows: string[] = [];
  const vitalEntryRefs: any[] = [{ reference: `urn:uuid:${encounterUUID}` }];
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
      vitalEntryRefs.push({ reference: `urn:uuid:${assessmentUUID}` });
      vitalRows.push(
        `<tr><td>${escapeHtml(assessmentKey)}</td><td>${value}</td><td>${escapeHtml(unit)}</td></tr>`,
      );
    });
  }
  const vitalsNarrativeHtml =
    vitalRows.length > 0
      ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Vital</th><th>Value</th><th>Unit</th></tr></thead><tbody>${vitalRows.join("")}</tbody></table>`
      : `<p>No vital signs recorded for this visit.</p>`;
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

  // OP Consultation Section (for the generated PDF report)
  if (
    optionalData?.soapNotes ||
    (optionalData?.assessment?.vitals &&
      Object.keys(optionalData.assessment.vitals).length > 0)
  ) {
    sections.push({
      title: "OP Consultation record",
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>OP Consultation Report</p></div>`,
      },
      entry: [
        { reference: `urn:uuid:${encounterUUID}` },
        { reference: `urn:uuid:${opConsultationDocId}` },
      ],
    });
  }

  const docId = generateUUID();

  // --- PDF Generation & Embedding ---

  // --- PDF Generation & Embedding (Optimized Batch) ---

  const pdfRequests: Array<{
    title: string;
    typeCode: string;
    typeDisplay: string;
    html: string;
    docId?: string;
  }> = [];

  // 1. Prescription PDF
  if (
    (optionalData?.prescription?.medications &&
      optionalData.prescription.medications.length > 0) ||
    patient.ongoingMedications
  ) {
    pdfRequests.push({
      title: "Prescription PDF",
      typeCode: "440545006",
      typeDisplay: "Prescription record",
      html: getPrescriptionTemplate(
        patient,
        visit,
        optionalData?.prescription?.medications || [],
        optionalData?.prescription?.advice,
      ),
      docId: prescriptionDocId,
    });
  }

  // 2. OP Consultation PDF (SOAP + Vitals)
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

  // 3. Discharge Summary PDF
  if (optionalData?.dischargeSummary) {
    pdfRequests.push({
      title: "Discharge Summary PDF",
      typeCode: "373942005",
      typeDisplay: "Discharge summary",
      html: getDischargeSummaryTemplate(
        patient,
        visit,
        optionalData.dischargeSummary,
      ),
      docId: dischargeSummaryDocId,
    });
  }

  // 4. Diagnostic Report PDF
  if (optionalData?.labReports && optionalData.labReports.length > 0) {
    pdfRequests.push({
      title: "Diagnostic Report PDF",
      typeCode: "4241000179101",
      typeDisplay: "Laboratory report",
      html: getDiagnosticReportTemplate(
        patient,
        visit,
        optionalData.labReports,
      ),
      docId: diagnosticReportDocId,
    });
  }

  // Batch Generate PDFs
  if (pdfRequests.length > 0) {
    try {
      const htmls = pdfRequests.map((r) => r.html);
      const buffers = await generateMultiplePdfs(htmls, browser);

      buffers.forEach((buffer, index) => {
        const req = pdfRequests[index];
        const pdfBase64 = buffer.toString("base64");
        const pdfDocId = req.docId || generateUUID();

        const pdfDocRef = buildPdfDocumentReference(
          pdfDocId,
          patientUUID,
          req.title,
          req.typeCode,
          req.typeDisplay,
          bundleDate,
          pdfBase64,
        );

        bundleEntries.push(pdfDocRef);
        // Removed generic section push
      });
    } catch (e: any) {
      console.error("Failed to generate batch PDFs", e);
    }
  }

  // Diagnostic Test Results — with real lab data in the narrative
  const labDataRows = optionalData?.labReports?.length
    ? optionalData.labReports
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.testType ?? "-")}</td><td>${escapeHtml(r.resultValue ?? "-")}</td><td>${escapeHtml(r.measurementUnit ?? "-")}</td><td>${r.reportDate != null ? toSafeLocaleDateString(r.reportDate) : "-"}</td><td>${escapeHtml(r.analystName ?? "-")}</td></tr>`,
        )
        .join("")
    : "";
  const labNarrativeHtml = labDataRows
    ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th><th>Analyst</th></tr></thead><tbody>${labDataRows}</tbody></table>`
    : `<p>No lab results stored for this visit.</p>`;

  sections.push({
    title: "Diagnostic Test Results",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "30954-2",
          display: "Diagnostic results",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${labNarrativeHtml}</div>`,
    },
    entry: [
      { reference: `urn:uuid:${encounterUUID}` },
      ...(optionalData?.labReports?.length
        ? [{ reference: `urn:uuid:${diagnosticReportDocId}` }]
        : []),
    ],
  });
  if (optionalData?.labReports?.length) {
    optionalData.labReports.map((report) => {
      const labObsUUID = generateUUID();
      const labObs = buildLabObservation(
        labObsUUID,
        patientUUID,
        toSafeISOString(report?.reportDate),
        report?.testType ?? "",
        "",
        report?.resultValue ?? "",
        report?.measurementUnit ?? "",
      );
      bundleEntries.push(labObs);
      sections[sections.length - 1].entry.push({
        reference: `urn:uuid:${labObsUUID}`,
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
        {
          ...m,
          medicine: `${m.medicine || ""} ${m.dosage || ""}`,
        },
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
          `<tr><td>${escapeHtml(`${m.medicine || ""} ${m.dosage || ""}`)}</td><td>${escapeHtml(m.dosage || "-")}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
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

    if (
      (optionalData?.prescription?.medications &&
        optionalData.prescription.medications.length > 0) ||
      patient.ongoingMedications
    ) {
      medRequestEntries.push({ reference: `urn:uuid:${prescriptionDocId}` });
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${prescriptionHtml}</div>`,
      },
      entry: medRequestEntries,
    });
  }
  // 1. Medical History Section (11329-0)
  const assessHistory = optionalData?.assessment?.medicalHistory;
  const medicalHistoryEntries: any[] = [];
  const medicalHistoryTextParts: string[] = [];

  // Add existing conditions from patient record as text context
  if (patient.existingMedicalConditions) {
    medicalHistoryTextParts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  }
  if (patient.allergies) {
    medicalHistoryTextParts.push(
      `<p><strong>Allergies:</strong> ${escapeHtml(patient.allergies)}</p>`,
    );
  }

  if (assessHistory && assessHistory.length > 0) {
    medicalHistoryTextParts.push(`<p><strong>Past Illness:</strong></p><ul>`);
    assessHistory.forEach((h) => {
      const conditionText = [h.disease, h.duration, h.medications]
        .filter(Boolean)
        .join(" - ");

      medicalHistoryTextParts.push(`<li>${escapeHtml(conditionText)}</li>`);

      if (h.disease) {
        const condUUID = generateUUID();
        const conditionResource = buildConditionResource(
          h.disease,
          condUUID,
          patientUUID,
          bundleDate,
          practitionerUUID,
          false,
        );
        bundleEntries.push(conditionResource);
        medicalHistoryEntries.push({ reference: `urn:uuid:${condUUID}` });
      }
    });
    medicalHistoryTextParts.push(`</ul>`);
  }

  // Always push section if we have data
  if (medicalHistoryEntries.length > 0 || medicalHistoryTextParts.length > 0) {
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
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${medicalHistoryTextParts.join("") || "No medical history recorded."}</div>`,
      },
      entry: medicalHistoryEntries,
    });
  }

  // 2. Surgical History Section (47519-4)
  const surgicalHistory = optionalData?.assessment?.surgicalHistory;
  if (surgicalHistory && surgicalHistory.length > 0) {
    const surgicalEntries: any[] = [];
    const surgicalTextParts: string[] = [`<ul>`];

    surgicalHistory.forEach((h) => {
      const parts = [
        h.surgical,
        h.date ? toSafeLocaleDateString(h.date) : null,
        h.surgeonName ? `Dr. ${h.surgeonName}` : null,
        h.hospital,
      ]
        .filter(Boolean)
        .join(" - ");

      surgicalTextParts.push(`<li>${escapeHtml(parts)}</li>`);

      if (h.surgical) {
        const procUUID = generateUUID();
        const procResource = buildProcedureResource(
          h.surgical,
          procUUID,
          patientUUID,
          h.date ? toSafeISOString(h.date) : bundleDate,
          practitionerUUID,
        );
        bundleEntries.push(procResource);
        surgicalEntries.push({ reference: `urn:uuid:${procUUID}` });
      }
    });
    surgicalTextParts.push(`</ul>`);

    sections.push({
      title: "Surgical History",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "47519-4",
            display: "History of Procedures",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Surgical History:</strong></p>${surgicalTextParts.join("")}</div>`,
      },
      entry: surgicalEntries,
    });
  }

  // 3. Social History Section (29762-2) - Merging Personal History & Additional Details
  const personalHistory = optionalData?.assessment?.personalHistory;
  const additionalDetails = optionalData?.assessment?.additionalDetails;

  const socialEntries: any[] = [];
  const socialTextParts: string[] = [];

  if (personalHistory && personalHistory.length > 0) {
    socialTextParts.push(`<p><strong>Lifestyle:</strong></p><ul>`);
    personalHistory.forEach((h) => {
      const parts = [
        h.diet ? `Diet: ${h.diet}` : null,
        h.appetite ? `Appetite: ${h.appetite}` : null,
        h.sleep ? `Sleep: ${h.sleep}` : null,
        h.blader ? `Bladder: ${h.blader}` : null,
        h.bowel ? `Bowel: ${h.bowel}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      if (parts) {
        socialTextParts.push(`<li>${escapeHtml(parts)}</li>`);
        // Select one key aspect for the observation resource, or create multiple if needed.
        // For now, mapping the whole text string to one observation for simplicity as 'Lifestyle'
        const obsUUID = generateUUID();
        const obsResource = buildSocialObservation(
          parts,
          obsUUID,
          patientUUID,
          bundleDate,
          practitionerUUID,
        );
        bundleEntries.push(obsResource);
        socialEntries.push({ reference: `urn:uuid:${obsUUID}` });
      }
    });
    socialTextParts.push(`</ul>`);
  }

  if (additionalDetails && additionalDetails.length > 0) {
    socialTextParts.push(`<p><strong>Habits / Other:</strong></p><ul>`);
    additionalDetails.forEach((h) => {
      const parts = [
        h.type ? `${h.type}` : null,
        h.duration ? `Duration: ${h.duration}` : null,
        h.frequency ? `Frequency: ${h.frequency}` : null,
        h.action ? `Status: ${h.action}` : null,
      ]
        .filter(Boolean)
        .join(" - ");

      if (parts) {
        socialTextParts.push(`<li>${escapeHtml(parts)}</li>`);
        const obsUUID = generateUUID();
        const obsResource = buildSocialObservation(
          parts,
          obsUUID,
          patientUUID,
          bundleDate,
          practitionerUUID,
        );
        bundleEntries.push(obsResource);
        socialEntries.push({ reference: `urn:uuid:${obsUUID}` });
      }
    });
    socialTextParts.push(`</ul>`);
  }

  if (socialEntries.length > 0 || socialTextParts.length > 0) {
    sections.push({
      title: "Social History",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "29762-2",
            display: "Social history",
          },
        ],
      },
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${socialTextParts.join("")}</div>`,
      },
      entry: socialEntries,
    });
  }

  // (Duplicate "Diagnostic Report / Lab" section removed — lab data is already in "Diagnostic Test Results" above)

  // Invoice Section
  if (
    optionalData?.billing &&
    optionalData.billing.billings &&
    optionalData.billing.billings.length > 0 &&
    includeSectionByHiType("Invoice", allowedHiTypes)
  ) {
    const billingEntries = optionalData.billing.billings
      .map(
        (item) =>
          `<tr><td style="padding: 4px;">${escapeHtml(item.particulars)}</td><td style="padding: 4px;">${item.amount}</td></tr>`,
      )
      .join("");
    const totalRow = `<tr><td style="padding: 4px;"><strong>Total</strong></td><td style="padding: 4px;"><strong>${optionalData.billing.totalAmount}</strong></td></tr>`;

    // Generate Invoice PDF
    const invoiceHtml = getInvoiceTemplate(
      patient,
      visit,
      optionalData.billing,
    );
    try {
      const invoicePdfBuffer = await generatePdfFromHtml(invoiceHtml, browser);
      const invoiceBase64 = invoicePdfBuffer.toString("base64");
      const invoiceDocId = generateUUID();
      const invoiceDocRef = buildPdfDocumentReference(
        invoiceDocId,
        patientUUID,
        "Invoice",
        "183654001", // Medical consultation
        "Invoice",
        bundleDate,
        invoiceBase64,
      );
      bundleEntries.push(invoiceDocRef);

      // Create Structured Invoice Resource
      const invoiceResId = generateUUID();
      const invoiceRes = buildInvoiceResource(
        invoiceResId,
        toSafeISOString(bundleDate),
        optionalData.billing.totalAmount,
        optionalData.billing.billings,
      );
      bundleEntries.push(invoiceRes);

      sections.push({
        title: "Invoice",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "183654001", // Medical consultation for Invoice/Bill
              display: "Invoice",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">
            <p><strong>Invoice Details:</strong></p>
            <table border="1" style="border-collapse: collapse; width: 100%;">
              <thead>
                <tr>
                  <th style="padding: 4px;">Item</th>
                  <th style="padding: 4px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${billingEntries}
                ${totalRow}
              </tbody>
            </table>
            <p>Status: ${optionalData.billing.status}</p>
          </div>`,
        },
        entry: [
          { reference: `urn:uuid:${encounterUUID}` },
          { reference: `urn:uuid:${invoiceDocId}` },
          { reference: `urn:uuid:${invoiceResId}` },
        ],
      });
    } catch (pdfError) {
      console.error("Error generating Invoice PDF:", pdfError);

      // Fallback: Add Structured Invoice Resource even if PDF fails
      const invoiceResId = generateUUID();
      const invoiceRes = buildInvoiceResource(
        invoiceResId,
        toSafeISOString(bundleDate),
        optionalData.billing.totalAmount,
        optionalData.billing.billings,
      );
      bundleEntries.push(invoiceRes);

      sections.push({
        title: "Invoice",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "183654001", // Medical consultation for Invoice/Bill
              display: "Invoice",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml">
            <p><strong>Invoice Details:</strong></p>
            <table border="1" style="border-collapse: collapse; width: 100%;">
              <thead>
                <tr>
                  <th style="padding: 4px;">Item</th>
                  <th style="padding: 4px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${billingEntries}
                ${totalRow}
              </tbody>
            </table>
            <p>Status: ${optionalData.billing.status}</p>
          </div>`,
        },
        entry: [
          { reference: `urn:uuid:${encounterUUID}` },
          { reference: `urn:uuid:${invoiceResId}` },
        ],
      });
    }
  }

  // Health Document Section (Uploaded Documents)
  const uploadedDocEntries: any[] = [];
  if (
    optionalData?.assessment?.documentUploads &&
    optionalData.assessment.documentUploads.length > 0 &&
    includeSectionByHiType("Health Document", allowedHiTypes)
  ) {
    (optionalData.assessment.documentUploads as any[])?.forEach(
      (upload: any) => {
        const docId = generateUUID();
        let base64Data = "";
        let contentType = upload.mimeType || "application/octet-stream";

        if (upload.fileUrl) {
          console.warn("S3 URL found but fetch logic not implemented yet.");
          return;
        } else if (upload.fileData) {
          if (typeof upload.fileData === "string") {
            base64Data = upload.fileData;
          } else if (Buffer.isBuffer(upload.fileData)) {
            base64Data = upload.fileData.toString("base64");
          } else if ((upload.fileData as any).buffer) {
            base64Data = Buffer.from((upload.fileData as any).buffer).toString(
              "base64",
            );
          }
        }

        if (!base64Data) return;

        const docRefResource = {
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
                code: "419891008", // Record artifact
                display: "Health Record",
              },
            ],
            text: "Health Document",
          },
          subject: {
            reference: `urn:uuid:${patientUUID}`,
          },
          context: {
            encounter: [
              {
                reference: `urn:uuid:${encounterUUID}`,
              },
            ],
          },
          date: upload.uploadDate
            ? new Date(upload.uploadDate).toISOString()
            : bundleDate,
          content: [
            {
              attachment: {
                contentType: contentType,
                data: base64Data,
                title: upload.fileName,
              },
            },
          ],
        };

        bundleEntries.push({
          fullUrl: `urn:uuid:${docId}`,
          resource: docRefResource,
        });
        uploadedDocEntries.push({ reference: `urn:uuid:${docId}` });
      },
    );

    if (uploadedDocEntries.length > 0) {
      sections.push({
        title: "Health Document",
        code: {
          coding: [
            {
              system: "http://snomed.info/sct",
              code: "419891008",
              display: "Health Record",
            },
          ],
        },
        text: {
          status: "generated",
          div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>Health Documents attached.</p></div>`,
        },
        entry: uploadedDocEntries,
      });
    }
  }

  // Discharge Summary — with FHIR MedicationRequest resources for discharge meds
  const ds = optionalData?.dischargeSummary;
  const dischargeParts: string[] = [];
  const dischargeEntryRefs: any[] = [
    { reference: `urn:uuid:${encounterUUID}` },
  ];
  if (
    ds &&
    (ds.diagnosis ||
      ds.clinicalSummary ||
      ds.treatmentGiven ||
      ds.admissionDate ||
      ds.conditionAtDischarge ||
      ds.followUpInstructions ||
      ds.surgicalProcedures)
  ) {
    if (ds.admissionDate || ds.dischargeDate || ds.ward)
      dischargeParts.push(
        `<p><strong>Admission:</strong> ${ds.admissionDate ? toSafeLocaleDateString(ds.admissionDate) : "N/A"} → <strong>Discharge:</strong> ${ds.dischargeDate ? toSafeLocaleDateString(ds.dischargeDate) : "N/A"}${ds.ward ? ` | Ward: ${escapeHtml(ds.ward)}` : ""}</p>`,
      );
    if (ds.diagnosis)
      dischargeParts.push(
        `<p><strong>Diagnosis:</strong> ${escapeHtml(ds.diagnosis)}</p>`,
      );
    if (ds.conditionAtDischarge)
      dischargeParts.push(
        `<p><strong>Condition at Discharge:</strong> ${escapeHtml(ds.conditionAtDischarge)}</p>`,
      );
    if (ds.clinicalSummary)
      dischargeParts.push(
        `<p><strong>Clinical Summary:</strong> ${escapeHtml(ds.clinicalSummary)}</p>`,
      );
    if (ds.treatmentGiven)
      dischargeParts.push(
        `<p><strong>Treatment Given:</strong> ${escapeHtml(ds.treatmentGiven)}</p>`,
      );
    if (ds.surgicalProcedures)
      dischargeParts.push(
        `<p><strong>Surgical Procedures:</strong> ${escapeHtml(ds.surgicalProcedures)}</p>`,
      );
    if (ds.followUpInstructions)
      dischargeParts.push(
        `<p><strong>Follow-up Instructions:</strong> ${escapeHtml(ds.followUpInstructions)}</p>`,
      );
  }
  if (ds?.dischargeMedications && ds.dischargeMedications.length > 0) {
    const medRows = ds.dischargeMedications
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.medicine || m.dosage || "-")}</td><td>${escapeHtml(m.dosage || "-")}</td><td>${m.frequency ?? "-"}</td><td>${m.duration ?? "-"}</td><td>${m.instructions ?? "-"}</td></tr>`,
      )
      .join("");
    dischargeParts.push(
      `<p><strong>Discharge Medications:</strong></p><table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${medRows}</tbody></table>`,
    );
    ds.dischargeMedications.forEach((m) => {
      const medId = generateUUID();
      bundleEntries.push(
        buildMedicationRequest(
          {
            ...m,
            medicine: `${m.medicine || ""} ${m.dosage || ""}`,
          },
          patientUUID,
          orgUUID,
          practitionerUUID,
          doctor,
          bundleDate,
          medId,
        ),
      );
      dischargeEntryRefs.push({ reference: `urn:uuid:${medId}` });
    });
  }
  // Add PDF DocumentReference to the section entry if it exists
  if (optionalData?.dischargeSummary) {
    dischargeEntryRefs.push({ reference: `urn:uuid:${dischargeSummaryDocId}` });
  }

  const dischargeHtml =
    dischargeParts.length > 0
      ? dischargeParts.join("")
      : `<p>OPD visit. No discharge summary applicable.</p>`;
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
    ...(dischargeEntryRefs.length > 0 ? { entry: dischargeEntryRefs } : {}),
  });

  // Immunization Record — with FHIR Immunization resources
  const imm = optionalData?.assessment?.immunization;
  const vaccineEntries: Array<{ name: string; code: string; date?: Date }> = [];
  if (imm) {
    if (imm.covid19Dose1Date)
      vaccineEntries.push({
        name: "COVID-19 Vaccine Dose 1",
        code: "28531000087107",
        date: imm.covid19Dose1Date,
      });
    if (imm.covid19Dose2Date)
      vaccineEntries.push({
        name: "COVID-19 Vaccine Dose 2",
        code: "28531000087107",
        date: imm.covid19Dose2Date,
      });
    if (imm.tetanusBoosterDate)
      vaccineEntries.push({
        name: "Tetanus Booster",
        code: "333621002",
        date: imm.tetanusBoosterDate,
      });
    if (imm.fluVaccineDate)
      vaccineEntries.push({
        name: "Influenza Vaccine",
        code: "46233009",
        date: imm.fluVaccineDate,
      });
  }
  const immEntryRefs: any[] = [];
  const immRows: string[] = [];
  vaccineEntries.forEach((v) => {
    const immId = generateUUID();
    bundleEntries.push({
      fullUrl: `urn:uuid:${immId}`,
      resource: {
        resourceType: "Immunization",
        id: immId,
        status: "completed",
        vaccineCode: {
          coding: [
            { system: "http://snomed.info/sct", code: v.code, display: v.name },
          ],
          text: v.name,
        },
        patient: { reference: `urn:uuid:${patientUUID}` },
        occurrenceDateTime: v.date ? toSafeISOString(v.date) : bundleDate,
      },
    });
    immEntryRefs.push({ reference: `urn:uuid:${immId}` });
    immRows.push(
      `<tr><td>${escapeHtml(v.name)}</td><td>${v.date ? toSafeLocaleDateString(v.date) : "-"}</td></tr>`,
    );
  });
  const immunizationHtml =
    immRows.length > 0
      ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Vaccine</th><th>Date</th></tr></thead><tbody>${immRows.join("")}</tbody></table>`
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
    ...(immEntryRefs.length > 0 ? { entry: immEntryRefs } : {}),
  });

  // Health Document / Wellness — enriched with symptoms, allergies, medical history
  const wellnessParts: string[] = [];
  // Symptoms removed from here as they have their own section now
  if (patient.allergies)
    wellnessParts.push(
      `<p><strong>Allergies:</strong> ${escapeHtml(typeof patient.allergies === "string" ? patient.allergies : String(patient.allergies))}</p>`,
    );
  if (patient.existingMedicalConditions)
    wellnessParts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  const wellnessAdditionalDetails = optionalData?.assessment?.additionalDetails;
  if (wellnessAdditionalDetails && wellnessAdditionalDetails.length > 0) {
    wellnessParts.push(`<p><strong>Additional Details:</strong></p>`);
    const detailsRows = wellnessAdditionalDetails
      .map(
        (d) =>
          `<tr><td>${escapeHtml(d.type ?? "-")}</td><td>${escapeHtml(d.action ?? "-")}</td><td>${escapeHtml(d.duration ?? "-")} ${escapeHtml(d.units ?? "")}</td><td>${escapeHtml(d.frequency ?? "-")}</td></tr>`,
      )
      .join("");
    wellnessParts.push(
      `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Type</th><th>Action</th><th>Duration</th><th>Frequency</th></tr></thead><tbody>${detailsRows}</tbody></table>`,
    );
  }
  // const documentUploads = optionalData?.assessment?.documentUploads;
  // const wellnessEntryRefs: any[] = [];
  // if (documentUploads && documentUploads.length > 0) {
  //   wellnessParts.push(`<p><strong>Uploaded Documents:</strong></p><ul>`);
  //   documentUploads.forEach((docUrl, index) => {
  //     wellnessParts.push(
  //       `<li><a href="${escapeHtml(docUrl)}" target="_blank">Document ${index + 1}</a></li>`,
  //     );
  //     // Create DocumentReference for each upload
  //     const docUUID = generateUUID();
  //     const docRef = {
  //       resource: {
  //         resourceType: "DocumentReference",
  //         id: docUUID,
  //         status: "current",
  //         docStatus: "final",
  //         type: {
  //           coding: [
  //             {
  //               system: "http://snomed.info/sct",
  //               code: "371530004",
  //               display: "Clinical consultation report",
  //             },
  //           ],
  //         },
  //         subject: { reference: `urn:uuid:${patientUUID}` },
  //         content: [
  //           { attachment: { url: docUrl, title: `Document ${index + 1}` } },
  //         ],
  //       },
  //     };
  //     bundleEntries.push(docRef);
  //     wellnessEntryRefs.push({ reference: `urn:uuid:${docUUID}` });
  //   });
  //   wellnessParts.push(`</ul>`);
  // }
  const wellnessHtml =
    wellnessParts.length > 0
      ? wellnessParts.join("")
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
    // ...(wellnessEntryRefs.length > 0 ? { entry: wellnessEntryRefs } : {}),
  });

  // Invoice section — payment/fee data from visit (defaults to ₹0 for manual patients)
  const invoiceParts: string[] = [];
  invoiceParts.push(
    `<p><strong>Visit:</strong> ${escapeHtml(dept)} - ${visitDateStr}</p>`,
  );
  const fee = visit.consultationFee ?? 0;
  invoiceParts.push(`<p><strong>Consultation Fee:</strong> ₹${fee}</p>`);
  const payment = visit.payment;
  if (payment) {
    if (payment.mode)
      invoiceParts.push(
        `<p><strong>Payment Mode:</strong> ${escapeHtml(payment.mode)}</p>`,
      );
    if (payment.amount)
      invoiceParts.push(
        `<p><strong>Amount Paid:</strong> ₹${payment.amount}</p>`,
      );
  }
  const insurance = visit.insurance;
  if (insurance && insurance.provider) {
    invoiceParts.push(
      `<p><strong>Insurance:</strong> ${escapeHtml(insurance.provider)} (Policy: ${escapeHtml(insurance.policyNumber || "N/A")})</p>`,
    );
  }
  sections.push({
    title: "Consultation Fee",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "48768-6",
          display: "Payment sources",
        },
      ],
    },
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${invoiceParts.join("")}</div>`,
    },
    entry: [], // Will be populated
  });
  //-----------------------------------------------
  // Create a DocumentReference for the Invoice (Fail-safe visibility)
  const invoiceHtmlContent = `
    <html>
    <head><style>body{font-family:sans-serif;padding:15px;}</style></head>
    <body>
      <h2>Invoice</h2>
      <p><strong>Hospital:</strong> ${escapeHtml(facilityName)}</p>
      <p><strong>Date:</strong> ${visitDateStr}</p>
      <hr/>
      <div style="margin:20px 0;">
        ${invoiceParts.join("")}
      </div>
      <hr/>
      <p style="text-align:right;"><strong>Total Amount: ₹${fee}</strong></p>
    </body>
    </html>
  `;

  const invoiceBase64 = Buffer.from(invoiceHtmlContent).toString("base64");
  const invoiceUUID = generateUUID();
  const invoiceReport = buildInvoiceResource(
    invoiceUUID,
    toSafeISOString(visitDateStr),
    fee,
    [{ particulars: "Consultation Fee", amount: fee }],
  );
  bundleEntries.push(invoiceReport);

  const invoiceSection = sections.find((s) => s.title === "Consultation Fee");
  if (invoiceSection) {
    if (!invoiceSection.entry) invoiceSection.entry = [];
    invoiceSection.entry.push({ reference: `urn:uuid:${invoiceUUID}` });
  }
  console.log(
    `[FHIR] Generated Invoice section with ${invoiceParts.length} parts. Fee: ${fee}`,
  );
  // -------------------------------------------------
  // -------------------------------------------------
  // CLEANUP: Remove dangling references (e.g. failed PDF generation)
  // If a referenced resource wasn't added to bundleEntries (e.g. PDF gen failed), remove the reference from the section.
  const availableIds = new Set(bundleEntries.map((e) => e.fullUrl));
  sections.forEach((section) => {
    if (section.entry) {
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
    }
  });

  // Filter sections by consented hiTypes when provided (ABDM: share only what consent allows)
  const filteredSections =
    allowedHiTypes && allowedHiTypes.length > 0
      ? sections.filter((s) => includeSectionByHiType(s.title, allowedHiTypes))
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
  generateCombinedBundleForCareContext,
  buildPatientResource,
  buildOrganizationResource,
  buildEncounterResource,
};

export default FhirBundleService;
