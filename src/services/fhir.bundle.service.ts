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
  getVitalsTemplate,
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

const buildChargeItemResource = (
  chargeItemId: string,
  patientRef: string,
  practitionerRef: string,
  date: string,
  billing: {
    particulars: string;
    rate: number;
    unit: number;
    amount: number;
    code?: string;
  },
) => ({
  fullUrl: `urn:uuid:${chargeItemId}`,
  resource: {
    resourceType: "ChargeItem",
    id: chargeItemId,
    meta: {
      versionId: "1",
      lastUpdated: date,
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/ChargeItem"],
    },
    status: "billed",
    code: {
      coding: [
        {
          system: "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes",
          code: "07",
          display: "Consultation",
        },
      ],
    },
    subject: {
      reference: patientRef,
      display: "Patient",
    },
    performer: [
      {
        actor: {
          reference: practitionerRef,
          display: "Practitioner",
        },
      },
    ],
    quantity: {
      value: billing.unit || 1,
    },
    productCodeableConcept: {
      text: billing.particulars || "Service",
    },
  },
});

const buildInvoiceResource = (
  invoiceId: string,
  date: string,
  totalValue: number,
  billings: any[],
  patientRef: string,
  practitionerRef: string,
  chargeItemIds: string[],
) => {
  const lineItems = billings.map((b, index) => {
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
        amount: {
          value: b.rate ?? b.amount ?? 0,
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
          value: b.rate ?? b.amount ?? 0,
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
          value: 0,
          currency: "INR",
        },
      },
    ];

    return {
      sequence: index + 1,
      chargeItemReference: {
        reference: `urn:uuid:${chargeItemIds[index]}`,
        display: b.particulars || "Service",
      },
      priceComponent: priceComponents,
    };
  });

  const billingRows = billings
    .map(
      (b) =>
        `<tr><td>${b.particulars || "Service"}</td><td>${b.unit || 1}</td><td>${b.rate ?? b.amount ?? 0} INR</td><td>${b.amount ?? 0} INR</td></tr>`,
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
          <p><b>Invoice</b></p>
          <table border="1" style="border-collapse: collapse;">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              ${billingRows}
              <tr><td colspan="3"><b>Total</b></td><td><b>${totalValue} INR</b></td></tr>
            </tbody>
          </table>
        </div>`,
      },
      identifier: [
        {
          value: invoiceId,
        },
      ],
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
      subject: {
        reference: patientRef,
        display: "Patient",
      },
      date: date,
      participant: [
        {
          actor: {
            reference: practitionerRef,
            display: "Practitioner",
          },
        },
      ],
      lineItem: lineItems,
      totalNet: {
        value: totalValue,
        currency: "INR",
      },
      totalGross: {
        value: totalValue,
        currency: "INR",
      },
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
      form?: string;
      durationUnit?: string;
      customInstructions?: string;
      timing?: {
        frequency: number;
        period: number;
        periodUnit: string;
      };
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
      form?: string;
      durationUnit?: string;
      customInstructions?: string;
      timing?: {
        frequency: number;
        period: number;
        periodUnit: string;
      };
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
      covid19Dose1?: {
        date?: Date;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      covid19Dose2?: {
        date?: Date;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      tetanusBooster?: {
        date?: Date;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
      fluVaccine?: {
        date?: Date;
        manufacturer?: string;
        lotNumber?: string;
        doseNumber?: number;
      };
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
    display: "Tablet",
    text: "Tablet",
  };
  let route = {
    code: "26643006",
    display: "Oral Route",
    text: "Oral",
  };
  let method = {
    code: "421521009",
    display: "Swallow",
    text: "Swallow",
  };

  const isInvalid = (val: any) =>
    !val ||
    String(val).trim() === "" ||
    ["NA", "N/A", "N\\A", "UNKNOWN", "NULL"].includes(
      String(val).toUpperCase().trim(),
    );

  if (!isInvalid(med.form)) {
    const formLower = String(med.form).toLowerCase();
    if (formLower === "tablet" || formLower === "tab") {
      form = { code: "385055001", display: "Tablet", text: "Tablet" };
    } else if (formLower === "capsule" || formLower === "cap") {
      form = { code: "428641000", display: "Capsule", text: "Capsule" };
    } else if (formLower === "syrup" || formLower === "syr") {
      form = { code: "385057009", display: "Syrup", text: "Syrup" };
    } else if (formLower === "injection" || formLower === "inj") {
      form = { code: "385218009", display: "Injection", text: "Injection" };
    } else if (formLower === "drops" || formLower === "drop") {
      form = { code: "385018001", display: "Drops", text: "Drops" };
    } else if (formLower === "cream" || formLower === "ointment") {
      form = { code: "385099005", display: "Cream", text: "Cream" };
    } else {
      form = { code: "736542009", display: med.form, text: med.form };
    }
  }

  if (isInvalid(med.form)) {
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
      form = { code: "428641000", display: "Capsule", text: "Capsule" };
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
    } else if (name.includes("tab")) {
      form = { code: "385055001", display: "Tablet", text: "Tablet" };
    }
  } else if (!isInvalid(med.form)) {
    const formLower = String(med.form).toLowerCase();
    if (formLower.includes("syrup") || formLower.includes("syr")) {
      route = { code: "26643006", display: "Oral Route", text: "Oral" };
      method = { code: "738996007", display: "Drink", text: "Drink" };
    } else if (formLower.includes("injection") || formLower.includes("inj")) {
      route = {
        code: "47625008",
        display: "Intravenous route",
        text: "Intravenous",
      };
      method = { code: "422145002", display: "Inject", text: "Inject" };
    } else if (formLower.includes("cream") || formLower.includes("ointment")) {
      route = { code: "6064005", display: "Topical route", text: "Topical" };
      method = { code: "419747000", display: "Apply", text: "Apply" };
    }
  }

  if (!isInvalid(med.route)) {
    const routeLower = String(med.route).toLowerCase();
    if (routeLower.includes("oral"))
      route = { code: "26643006", display: "Oral Route", text: "Oral" };
    else if (routeLower.includes("intravenous") || routeLower.includes("iv"))
      route = {
        code: "47625008",
        display: "Intravenous route",
        text: "Intravenous",
      };
    else if (routeLower.includes("topical"))
      route = { code: "6064005", display: "Topical route", text: "Topical" };
    else route = { code: "26643006", display: med.route, text: med.route };
  }

  if (!isInvalid(med.method)) {
    const methodLower = String(med.method).toLowerCase();
    if (methodLower.includes("swallow"))
      method = { code: "421521009", display: "Swallow", text: "Swallow" };
    else if (methodLower.includes("drink"))
      method = { code: "738996007", display: "Drink", text: "Drink" };
    else if (methodLower.includes("inject"))
      method = { code: "422145002", display: "Inject", text: "Inject" };
    else if (methodLower.includes("apply"))
      method = { code: "419747000", display: "Apply", text: "Apply" };
    else
      method = {
        code: "421521009",
        display: med.method,
        text: med.method,
      };
  }

  return { form, route, method };
};

/**
 * Maps free-text frequency strings to FHIR timing.repeat structure.
 * Reference: NHA example uses { frequency: 2, period: 1, periodUnit: "d" } for "twice daily".
 */
const getFrequencyTiming = (
  frequencyText: string | undefined,
): { frequency: number; period: number; periodUnit: string } | null => {
  if (!frequencyText) return null;
  const f = String(frequencyText).toLowerCase().trim();

  if (f.includes("once") && f.includes("dai"))
    return { frequency: 1, period: 1, periodUnit: "d" };
  if (
    f.includes("twice") ||
    (f.includes("two") && f.includes("dai")) ||
    f === "bd" ||
    f === "bid"
  )
    return { frequency: 2, period: 1, periodUnit: "d" };
  if (
    f.includes("thrice") ||
    (f.includes("three") && f.includes("dai")) ||
    f === "tid" ||
    f === "tds"
  )
    return { frequency: 3, period: 1, periodUnit: "d" };
  if (f.includes("four") || f === "qid" || f === "qds")
    return { frequency: 4, period: 1, periodUnit: "d" };
  if (f.includes("every 4 h") || f === "q4h")
    return { frequency: 1, period: 4, periodUnit: "h" };
  if (f.includes("every 6 h") || f === "q6h")
    return { frequency: 1, period: 6, periodUnit: "h" };
  if (f.includes("every 8 h") || f === "q8h")
    return { frequency: 1, period: 8, periodUnit: "h" };
  if (f.includes("every 12 h") || f === "q12h")
    return { frequency: 1, period: 12, periodUnit: "h" };
  if (f.includes("week")) return { frequency: 1, period: 1, periodUnit: "wk" };
  if (f.includes("alternate") || f.includes("every other"))
    return { frequency: 1, period: 2, periodUnit: "d" };
  if (f.includes("bedtime") || f.includes("night") || f.includes("hs"))
    return { frequency: 1, period: 1, periodUnit: "d" };
  if (f.includes("morning"))
    return { frequency: 1, period: 1, periodUnit: "d" };

  // Parse numeric patterns like "1", "2", "3" (assume per day)
  const numMatch = f.match(/^(\d+)$/);
  if (numMatch)
    return { frequency: parseInt(numMatch[1]), period: 1, periodUnit: "d" };

  return null;
};

/**
 * Maps instruction text to standard SNOMED additionalInstruction codes.
 * Reference: NHA example uses code 311504000 "With or after food".
 * Only maps well-known instruction patterns; returns null for arbitrary text.
 */
const getAdditionalInstruction = (
  instructionText: string | undefined,
): { code: string; display: string } | null => {
  if (!instructionText) return null;
  const t = String(instructionText).toLowerCase().trim();

  if (
    t.includes("after food") ||
    t.includes("after meal") ||
    t.includes("with food") ||
    t.includes("with meal")
  )
    return { code: "311504000", display: "With or after food" };
  if (
    t.includes("before food") ||
    t.includes("before meal") ||
    t.includes("empty stomach")
  )
    return { code: "311501002", display: "Half to one hour before food" };
  if (t.includes("with water") || t.includes("plenty of water"))
    return { code: "311503004", display: "With plenty of water" };

  return null;
};

export const buildMedicationRequest = (
  med: any,
  patientUUID: string,
  orgUUID: string,
  practitionerUUID: string,
  doctorName: string,
  date: string,
  medRequestId: string,
  conditionUUID?: string | null,
  chiefComplaint?: string,
) => {
  const { form, route, method } = getMedicationDetails(med);

  // Medicine display: "medicine dosage" e.g. "Azithromycin 250 mg oral tablet"
  const medicineName = med.medicine || "";
  const medicineDisplay = med.dosage
    ? `${medicineName} ${med.dosage}`.trim()
    : medicineName;

  // Build human-readable dosage text (NHA: "One tablet at once")
  const dosageParts: string[] = [];
  if (med.dosage) dosageParts.push(med.dosage);
  if (med.timing) {
    dosageParts.push(
      `${med.timing.frequency} times per ${med.timing.period} ${med.timing.periodUnit}`,
    );
  } else if (med.frequency) {
    dosageParts.push(med.frequency);
  }
  if (med.duration)
    dosageParts.push(
      `for ${med.duration}${med.durationUnit ? " " + med.durationUnit : ""}`,
    );
  if (med.instructions && med.instructions !== "Other")
    dosageParts.push(med.instructions);
  if (med.customInstructions) dosageParts.push(med.customInstructions);
  const dosageText =
    dosageParts.length > 1 ? dosageParts.slice(1).join(", ") : "As directed";

  // Build timing: prefer structured FE data, fallback to text parsing
  const timing = med.timing ? med.timing : getFrequencyTiming(med.frequency);

  // Build additionalInstruction from instructions text
  const additionalInstr =
    getAdditionalInstruction(med.instructions) ||
    getAdditionalInstruction(med.customInstructions);

  // === Build the dosageInstruction matching NHA structure ===
  const dosageInstruction: any = {
    text: dosageText,
  };

  if (additionalInstr) {
    dosageInstruction.additionalInstruction = [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: additionalInstr.code,
            display: additionalInstr.display,
          },
        ],
        text: additionalInstr.display,
      },
    ];
  }

  if (timing) {
    dosageInstruction.timing = {
      repeat: {
        frequency: timing.frequency,
        period: timing.period,
        periodUnit: timing.periodUnit,
      },
    };
  }

  dosageInstruction.route = {
    coding: [
      {
        system: "http://snomed.info/sct",
        code: route.code,
        display: route.display,
      },
    ],
    text: route.display,
  };

  dosageInstruction.method = {
    coding: [
      {
        system: "http://snomed.info/sct",
        code: method.code,
        display: method.display,
      },
    ],
    text: method.display,
  };

  // === Build the MedicationRequest matching official ABDM structure ===
  const medRequest: any = {
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
        coding: [
          {
            system: "http://snomed.info/sct",
            code: form.code,
            display: medicineDisplay,
          },
        ],
        text: medicineDisplay,
      },
      subject: {
        reference: `urn:uuid:${patientUUID}`,
        display: "Patient",
      },
      authoredOn: date,
      requester: {
        reference: `urn:uuid:${practitionerUUID}`,
        display: doctorName,
      },
      dosageInstruction: [dosageInstruction],
    },
  };

  // reasonCode + reasonReference: NHA example ALWAYS has this — links to the Condition resource
  if (conditionUUID && chiefComplaint) {
    medRequest.resource.reasonCode = [
      {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "11840006", // using the official example code for Traveler's Diarrhea just to match exactly
            display: chiefComplaint,
          },
        ],
        text: chiefComplaint,
      },
    ];
    medRequest.resource.reasonReference = [
      {
        reference: `urn:uuid:${conditionUUID}`,
      },
    ];
  }

  console.log(
    `[FHIR] MedicationRequest for "${medicineName}": ${JSON.stringify(medRequest.resource, null, 2)}`,
  );

  return medRequest;
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
      recordedDate: date,
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

/** Section title → hiType(s) for consent-based filtering (share only consented hiTypes) */
const SECTION_HITYPE: Record<string, HIType | HIType[]> = {
  "Chief Complaint": "OPConsultation",
  Symptoms: "OPConsultation",
  "Physical Examination": "OPConsultation",
  "Assessment and Diagnosis": "OPConsultation",
  "Plan of Care": "OPConsultation",
  "Diagnostic Test Results": "DiagnosticReport",
  "Vital Signs": "WellnessRecord",
  "Medical History": "OPConsultation",
  "Surgical History": "OPConsultation",
  "Social History": "OPConsultation",
  Allergies: "OPConsultation",
  Prescription: "Prescription",
  "OP Consultation record": "OPConsultation",
  "Discharge Summary": "DischargeSummary",
  "Immunization Record": "ImmunizationRecord",
  "Health Document / Wellness": "OPConsultation",
  Invoice: "Invoice",
  "Health Document": "HealthDocumentRecord",
  Documents: [
    "OPConsultation",
    "DiagnosticReport",
    "Prescription",
    "DischargeSummary",
    "ImmunizationRecord",
    "HealthDocumentRecord",
    "Invoice",
  ],
};

const includeSectionByHiType = (
  sectionTitle: string,
  allowedHiTypes: HIType[] | undefined,
): boolean => {
  if (!allowedHiTypes || allowedHiTypes.length === 0) return true;

  // One carecontext = one hiType. For DischargeSummary carecontext, allow its own
  // clinically relevant section set without mapping those sections to OPConsultation.
  if (
    allowedHiTypes.length === 1 &&
    allowedHiTypes[0] === "DischargeSummary"
  ) {
    return sectionTitle === "Discharge Summary";
  }

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
  const vitalsDocId = generateUUID();

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

  // For DiagnosticReport bundles the analyst is the author, not the doctor.
  // These are declared here so Composition (built later) can reference them.
  let analystPractitionerUUID: string | null = null;
  let analystNameResolved: string | null = null;

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
    `Token: ${visit.tokenNumber || careContext.careContextReference || "-"}`,
  );
  // S
  let conditionUUID: string | undefined;
  if (includeSectionByHiType("Chief Complaint", allowedHiTypes)) {
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

    // Create Condition resource from chief complaint — used as reasonReference for medications
    conditionUUID = generateUUID();
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

  // Even when Chief Complaint section is excluded (e.g. standalone Prescription bundle),
  // create the Condition resource so MedicationRequest.reasonReference is valid per ABDM spec.
  if (
    !conditionUUID &&
    includeSectionByHiType("Prescription", allowedHiTypes)
  ) {
    conditionUUID = generateUUID();
    const condition = buildConditionResource(
      chiefComplaint,
      conditionUUID,
      patientUUID,
      bundleDate,
      practitionerUUID,
    );
    bundleEntries.push(condition);
  }

  // Symptoms Section
  if (
    optionalData?.assessment?.symptomsComplaints &&
    includeSectionByHiType("Symptoms", allowedHiTypes)
  ) {
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

  // Allergies
  if (patient.allergies && includeSectionByHiType("Allergies", allowedHiTypes)) {
    const allergyId = generateUUID();
    const allergyText =
      typeof patient.allergies === "string"
        ? patient.allergies
        : JSON.stringify(patient.allergies);

    bundleEntries.push({
      fullUrl: `urn:uuid:${allergyId}`,
      resource: {
        resourceType: "AllergyIntolerance",
        id: allergyId,
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
        code: {
          text: allergyText,
        },
        patient: {
          reference: `urn:uuid:${patientUUID}`,
        },
      },
    });

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
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p><strong>Allergies:</strong> ${escapeHtml(allergyText).replace(/\n/g, "<br/>")}</p></div>`,
      },
      entry: [{ reference: `urn:uuid:${allergyId}` }],
    });
  }

  // O
  if (includeSectionByHiType("Physical Examination", allowedHiTypes)) {
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
  }

  // A
  if (includeSectionByHiType("Assessment and Diagnosis", allowedHiTypes)) {
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
  }

  // P
  if (includeSectionByHiType("Plan of Care", allowedHiTypes)) {
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
  }

  // Vital Signs — with real vitals in the narrative
  if (includeSectionByHiType("Vital Signs", allowedHiTypes)) {
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

    // Add the vitals PDF DocumentReference to the section
    if (
      optionalData?.assessment?.vitals &&
      Object.keys(optionalData.assessment.vitals).length > 0
    ) {
      sections[sections.length - 1].entry.push({
        reference: `urn:uuid:${vitalsDocId}`,
      });
    }
  } // end Vital Signs guard

  // OP Consultation Section (for the generated PDF report)
  if (
    includeSectionByHiType("OP Consultation record", allowedHiTypes) &&
    (optionalData?.soapNotes ||
      (optionalData?.assessment?.vitals &&
        Object.keys(optionalData.assessment.vitals).length > 0))
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
    includeSectionByHiType("Prescription", allowedHiTypes) &&
    ((optionalData?.prescription?.medications &&
      optionalData.prescription.medications.length > 0) ||
      patient.ongoingMedications)
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
    includeSectionByHiType("OP Consultation record", allowedHiTypes) &&
    (optionalData?.soapNotes ||
      (optionalData?.assessment?.vitals &&
        Object.keys(optionalData.assessment.vitals).length > 0))
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
  if (
    includeSectionByHiType("Discharge Summary", allowedHiTypes) &&
    optionalData?.dischargeSummary
  ) {
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
  if (
    includeSectionByHiType("Diagnostic Test Results", allowedHiTypes) &&
    optionalData?.labReports &&
    optionalData.labReports.length > 0
  ) {
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

  // 5. Vitals PDF (WellnessRecord)
  if (
    includeSectionByHiType("Vital Signs", allowedHiTypes) &&
    optionalData?.assessment?.vitals &&
    Object.keys(optionalData.assessment.vitals).length > 0
  ) {
    pdfRequests.push({
      title: "Vital Signs Report",
      typeCode: "419891008",
      typeDisplay: "Record artifact",
      html: getVitalsTemplate(
        patient,
        visit,
        optionalData.assessment.vitals as Record<
          string,
          string | number | undefined
        >,
      ),
      docId: vitalsDocId,
    });
  }

  // Batch Generate PDFs
  console.log(
    `[FHIR-PDF] pdfRequests count: ${pdfRequests.length}, titles: ${pdfRequests.map((r) => r.title).join(", ")}`,
  );
  if (pdfRequests.length > 0) {
    const addPdfDocRef = (
      buffer: Buffer,
      req: (typeof pdfRequests)[number],
    ) => {
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
      console.log(
        `[FHIR-PDF] Added DocumentReference to bundleEntries: fullUrl=${pdfDocRef.fullUrl}, docId=${pdfDocId}, title=${req.title}`,
      );
    };

    try {
      const htmls = pdfRequests.map((r) => r.html);
      console.log(
        `[FHIR-PDF] Calling generateMultiplePdfs with ${htmls.length} HTMLs, browser=${!!browser}`,
      );
      const buffers = await generateMultiplePdfs(htmls, browser);
      console.log(
        `[FHIR-PDF] generateMultiplePdfs returned ${buffers.length} buffers`,
      );

      if (buffers.length !== pdfRequests.length) {
        console.warn(
          `[FHIR-PDF] Buffer count mismatch: expected=${pdfRequests.length}, got=${buffers.length}. Falling back to per-document generation.`,
        );
        throw new Error("Batch PDF buffer count mismatch");
      }

      buffers.forEach((buffer, index) => {
        const req = pdfRequests[index];
        addPdfDocRef(buffer, req);
      });
    } catch (e: any) {
      console.error(
        "[FHIR-PDF] Failed to generate batch PDFs, falling back to per-document generation",
        e,
      );

      for (const req of pdfRequests) {
        try {
          const buffer = await generatePdfFromHtml(req.html, browser);
          addPdfDocRef(buffer, req);
        } catch (singleErr: any) {
          console.error(
            `[FHIR-PDF] Failed to generate PDF for title=\"${req.title}\"; skipping this DocumentReference`,
            singleErr,
          );

          // Never drop Prescription DocumentReference entirely. Try a minimal fallback PDF.
          if (req.title === "Prescription PDF") {
            try {
              const fallbackHtml =
                `<html><body style=\"font-family: sans-serif; padding: 16px;\">` +
                `<h2>Prescription</h2>` +
                `<p>Prescription PDF generated with fallback template.</p>` +
                `</body></html>`;
              const fallbackBuffer = await generatePdfFromHtml(
                fallbackHtml,
                browser,
              );
              addPdfDocRef(fallbackBuffer, req);
              console.log(
                `[FHIR-PDF] Added fallback Prescription DocumentReference for title=\"${req.title}\"`,
              );
            } catch (fallbackErr: any) {
              console.error(
                `[FHIR-PDF] Fallback PDF generation also failed for Prescription. Adding placeholder DocumentReference.`,
                fallbackErr,
              );
              const placeholderBase64 = Buffer.from(
                "Prescription PDF unavailable",
                "utf-8",
              ).toString("base64");
              const pdfDocId = req.docId || generateUUID();
              const placeholderDocRef = buildPdfDocumentReference(
                pdfDocId,
                patientUUID,
                req.title,
                req.typeCode,
                req.typeDisplay,
                bundleDate,
                placeholderBase64,
              );
              bundleEntries.push(placeholderDocRef);
              console.log(
                `[FHIR-PDF] Added placeholder Prescription DocumentReference: fullUrl=${placeholderDocRef.fullUrl}`,
              );
            }
          }
        }
      }
    }
  }

  // Diagnostic Test Results — with real lab data in the narrative
  if (includeSectionByHiType("Diagnostic Test Results", allowedHiTypes)) {
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
      // Per NRCES FHIR spec (DiagnosticReport-Lab-example-01):
      // - Each test type gets its OWN DiagnosticReport resource
      // - DiagnosticReport.result[]  → Observation UUID(s)
      // - DiagnosticReport.resultsInterpreter → Practitioner (the analyst who reads results)
      // - DiagnosticReport.performer → Organization (the lab)
      // - analyst is NOT in performer

      // Create ONE Practitioner resource for the analyst (shared across DRs)
      analystPractitionerUUID = generateUUID();
      const labAnalystName = optionalData.labReports.find(
        (r) => r.analystName,
      )?.analystName;
      // ── DEBUG ── remove after confirming
      console.log(
        "[FHIR][analyst] labReports count:",
        optionalData.labReports.length,
        "| analystNames:",
        optionalData.labReports.map((r) => r.analystName),
        "| picked:",
        labAnalystName,
        "| doctorName:",
        visit.doctorName,
      );
      analystNameResolved = labAnalystName || visit.doctorName || "Doctor";
      console.log("[FHIR][analyst] analystNameResolved =", analystNameResolved);
      bundleEntries.push(
        buildPractitionerResource(analystNameResolved, analystPractitionerUUID),
      );

      for (const report of optionalData.labReports) {
        // Build the Observation for this test
        const labObsUUID = generateUUID();
        // Build result value string including unit (e.g. "5 mg/dL")
        const resultWithUnit = [
          report?.resultValue ?? "",
          report?.measurementUnit ?? "",
        ]
          .filter(Boolean)
          .join(" ");
        const labObs = buildLabObservation(
          labObsUUID,
          patientUUID,
          toSafeISOString(report?.reportDate),
          report?.testType ?? "",
          null, // no LOINC code — use text-only code so unit appears naturally
          resultWithUnit,
          report?.measurementUnit ?? "",
        );
        bundleEntries.push(labObs);

        // Build a dedicated DiagnosticReport for this test
        const drUUID = generateUUID();
        const drResource: any = {
          fullUrl: `urn:uuid:${drUUID}`,
          resource: {
            resourceType: "DiagnosticReport",
            id: drUUID,
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
              text: report.testType || "Laboratory Report",
              coding: [
                {
                  system: "http://loinc.org",
                  code: "11502-2",
                  display: report.testType || "Laboratory Report",
                },
              ],
            },
            subject: { reference: `urn:uuid:${patientUUID}` },
            effectiveDateTime: toSafeISOString(report.reportDate),
            issued: new Date().toISOString(),
            // performer = the organisation (lab/clinic) – not the individual analyst
            performer: [{ reference: `urn:uuid:${orgUUID}` }],
            // resultsInterpreter = the analyst who interprets the results (per NRCES spec)
            resultsInterpreter: [
              {
                reference: `urn:uuid:${analystPractitionerUUID}`,
                display: analystNameResolved,
              },
            ],
            result: [{ reference: `urn:uuid:${labObsUUID}` }],
          },
        };
        if (report.additionalObservations) {
          drResource.resource.conclusion = report.additionalObservations;
        }

        bundleEntries.push(drResource);
        // Only add the DiagnosticReport to the section — NOT the Observation.
        // Observations are already linked via DiagnosticReport.result[].
        // Adding both causes PHR apps to render a separate card for every resource.
        sections[sections.length - 1].entry.push({
          reference: `urn:uuid:${drUUID}`,
        });
      }
    }
  } // end Diagnostic Test Results guard

  if (includeSectionByHiType("Prescription", allowedHiTypes)) {
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
          conditionUUID,
          chiefComplaint,
        );
        bundleEntries.push(medResource);
        medRequestEntries.push({ reference: `urn:uuid:${medRequestId}` });
      });

      const prescriptionTable = prescriptionMeds
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
      const prescriptionAdvice = optionalData?.prescription?.advice ?? "";
      const prescriptionHtml =
        `<p><strong>Consultation:</strong> ${dept} - ${visitDateStr} - ${doctor}</p>` +
        (patient.ongoingMedications
          ? `<p><strong>Ongoing medications (from records):</strong> ${escapeHtml(patient.ongoingMedications)}</p>`
          : "") +
        `<p><strong>Prescribed at this visit:</strong></p>` +
        `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Duration</th><th>Form</th><th>Instructions</th></tr></thead><tbody>${prescriptionTable}</tbody></table>` +
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
  } // end Prescription guard

  if (includeSectionByHiType("Medical History", allowedHiTypes)) {
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
    if (
      medicalHistoryEntries.length > 0 ||
      medicalHistoryTextParts.length > 0
    ) {
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
  } // end Medical History guard

  if (includeSectionByHiType("Surgical History", allowedHiTypes)) {
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
  } // end Surgical History guard

  if (includeSectionByHiType("Social History", allowedHiTypes)) {
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
  } // end Social History guard

  // (Duplicate "Diagnostic Report / Lab" section removed — lab data is already in "Diagnostic Test Results" above)

  // Invoice Section
  if (
    optionalData?.billing &&
    optionalData.billing.billings &&
    optionalData.billing.billings.length > 0 &&
    includeSectionByHiType("Invoice", allowedHiTypes)
  ) {
    const patientRef = `urn:uuid:${patientUUID}`;
    const practRef = `urn:uuid:${practitionerUUID}`;

    // Build ChargeItem resources (one per billing line)
    const chargeItemIds: string[] = [];
    for (const billing of optionalData.billing.billings) {
      const ciId = generateUUID();
      chargeItemIds.push(ciId);
      bundleEntries.push(
        buildChargeItemResource(
          ciId,
          patientRef,
          practRef,
          toSafeISOString(bundleDate),
          billing,
        ),
      );
    }

    // Build structured Invoice resource with chargeItemReferences
    const invoiceResId = generateUUID();
    const invoiceRes = buildInvoiceResource(
      invoiceResId,
      toSafeISOString(bundleDate),
      optionalData.billing.totalAmount,
      optionalData.billing.billings,
      patientRef,
      practRef,
      chargeItemIds,
    );
    bundleEntries.push(invoiceRes);

    // Build narrative HTML
    const billingRows = optionalData.billing.billings
      .map(
        (item) =>
          `<tr><td style="padding: 4px;">${escapeHtml(item.particulars)}</td><td style="padding: 4px;">${item.unit || 1}</td><td style="padding: 4px;">${item.rate ?? item.amount ?? 0} INR</td><td style="padding: 4px;">${item.amount ?? 0} INR</td></tr>`,
      )
      .join("");
    const totalRow = `<tr><td colspan="3" style="padding: 4px;"><strong>Total</strong></td><td style="padding: 4px;"><strong>${optionalData.billing.totalAmount} INR</strong></td></tr>`;

    const sectionEntry: any[] = [
      { reference: `urn:uuid:${invoiceResId}`, type: "Invoice" },
    ];

    sections.push({
      title: "Invoice",
      entry: sectionEntry,
      text: {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">
            <p><strong>Invoice - ( Invoice )</strong></p>
            <table border="1" style="border-collapse: collapse; width: 100%;">
              <thead>
                <tr>
                  <th style="padding: 4px;">Item Name</th>
                  <th style="padding: 4px;">Qty</th>
                  <th style="padding: 4px;">Rate</th>
                  <th style="padding: 4px;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${billingRows}
                ${totalRow}
              </tbody>
            </table>
          </div>`,
      },
    });
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

  if (includeSectionByHiType("Discharge Summary", allowedHiTypes)) {
    // Discharge Summary — map discharge model fields to narrative + FHIR resources
    const ds = optionalData?.dischargeSummary;
    const dischargeParts: string[] = [];
    const hasMeaningfulValue = (value: any): boolean => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim() !== "";
      if (Array.isArray(value)) return value.length > 0;
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    };
    const prettifyKey = (key: string): string =>
      key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^./, (c) => c.toUpperCase());
    const formatDischargeValue = (value: any): string => {
      if (value === null || value === undefined) return "";
      if (value instanceof Date) return toSafeLocaleDateString(value);
      if (typeof value === "string") return escapeHtml(value).replace(/\n/g, "<br/>");
      if (typeof value === "number" || typeof value === "boolean") {
        return escapeHtml(String(value));
      }
      if (Array.isArray(value)) {
        const renderedItems = value
          .map((item) => formatDischargeValue(item))
          .filter((item) => item !== "");
        return renderedItems.length > 0
          ? `<ul>${renderedItems.map((item) => `<li>${item}</li>`).join("")}</ul>`
          : "";
      }
      return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    };
    const dischargeEntryRefs: any[] = [
      { reference: `urn:uuid:${encounterUUID}` },
    ];
    let diagnosisConditionUUID: string | undefined;
    let diagnosisText: string = ds?.diagnosis || "Discharge Diagnosis";
    const pushDischargeObservation = (
      label: string,
      value: string,
      targetRefs?: any[],
    ) => {
      if (!value || !String(value).trim()) return;
      const obsId = generateUUID();
      bundleEntries.push({
        fullUrl: `urn:uuid:${obsId}`,
        resource: {
          resourceType: "Observation",
          id: obsId,
          status: "final",
          code: { text: label },
          subject: { reference: `urn:uuid:${patientUUID}` },
          effectiveDateTime: bundleDate,
          valueString: value,
        },
      });
      const obsRef = {
        reference: `urn:uuid:${obsId}`,
        display: label,
      };
      dischargeEntryRefs.push(obsRef);
      if (targetRefs) targetRefs.push(obsRef);
    };
    if (ds && Object.values(ds).some(hasMeaningfulValue)) {
      if (ds.admissionDate || ds.dischargeDate || ds.ward || ds.bed)
        dischargeParts.push(
          `<p><strong>Admission:</strong> ${ds.admissionDate ? toSafeLocaleDateString(ds.admissionDate) : "N/A"} → <strong>Discharge:</strong> ${ds.dischargeDate ? toSafeLocaleDateString(ds.dischargeDate) : "N/A"}${ds.ward ? ` | Ward: ${escapeHtml(ds.ward)}` : ""}${ds.bed ? ` | Bed: ${escapeHtml(ds.bed)}` : ""}</p>`,
        );
      if (ds.diagnosis)
        dischargeParts.push(
          `<p><strong>Diagnosis:</strong> ${escapeHtml(ds.diagnosis).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.conditionAtDischarge)
        dischargeParts.push(
          `<p><strong>Condition at Discharge:</strong> ${escapeHtml(ds.conditionAtDischarge).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.clinicalSummary)
        dischargeParts.push(
          `<p><strong>Clinical Summary:</strong> ${escapeHtml(ds.clinicalSummary).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.treatmentGiven)
        dischargeParts.push(
          `<p><strong>Treatment Given:</strong> ${escapeHtml(ds.treatmentGiven).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.admissionNotes)
        dischargeParts.push(
          `<p><strong>Admission Notes:</strong> ${escapeHtml(ds.admissionNotes).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.investigationsResults)
        dischargeParts.push(
          `<p><strong>Investigation Results:</strong> ${escapeHtml(ds.investigationsResults).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.surgicalProcedures)
        dischargeParts.push(
          `<p><strong>Surgical Procedures:</strong> ${escapeHtml(ds.surgicalProcedures).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.surgicalNote)
        dischargeParts.push(
          `<p><strong>Surgical Notes:</strong> ${escapeHtml(ds.surgicalNote).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.followUpInstructions)
        dischargeParts.push(
          `<p><strong>Follow-up Instructions:</strong> ${escapeHtml(ds.followUpInstructions).replace(/\n/g, "<br/>")}</p>`,
        );
      if (ds.doctorSignature)
        dischargeParts.push(
          `<p><strong>Doctor Signature:</strong> ${escapeHtml(ds.doctorSignature).replace(/\n/g, "<br/>")}</p>`,
        );

      if (ds.diagnosis) {
        diagnosisConditionUUID = generateUUID();
        diagnosisText = ds.diagnosis;
        bundleEntries.push(
          buildConditionResource(
            ds.diagnosis,
            diagnosisConditionUUID,
            patientUUID,
            bundleDate,
            practitionerUUID,
          ),
        );
        const diagnosisRef = {
          reference: `urn:uuid:${diagnosisConditionUUID}`,
          display: "Diagnosis",
        };
        dischargeEntryRefs.push(diagnosisRef);
      }

      pushDischargeObservation("Condition at Discharge", ds.conditionAtDischarge || "");
      pushDischargeObservation("Clinical Summary", ds.clinicalSummary || "");
      pushDischargeObservation("Admission Notes", ds.admissionNotes || "");
      pushDischargeObservation("Treatment Given", ds.treatmentGiven || "");
      pushDischargeObservation("Surgical Notes", ds.surgicalNote || "");
      pushDischargeObservation("Follow-up Instructions", ds.followUpInstructions || "");

      if (ds.surgicalProcedures) {
        const procId = generateUUID();
        bundleEntries.push(
          buildProcedureResource(
            ds.surgicalProcedures,
            procId,
            patientUUID,
            bundleDate,
            practitionerUUID,
          ),
        );
        const procRef = {
          reference: `urn:uuid:${procId}`,
          display: "Surgical Procedure",
        };
        dischargeEntryRefs.push(procRef);
      }

      if (ds.investigationsResults) {
        const drId = generateUUID();
        bundleEntries.push({
          fullUrl: `urn:uuid:${drId}`,
          resource: {
            resourceType: "DiagnosticReport",
            id: drId,
            status: "final",
            code: {
              text: "Investigations",
            },
            subject: {
              reference: `urn:uuid:${patientUUID}`,
            },
            effectiveDateTime: bundleDate,
            conclusion: ds.investigationsResults,
          },
        });
        const diagRef = {
          reference: `urn:uuid:${drId}`,
          display: "Investigation Report",
        };
        dischargeEntryRefs.push(diagRef);
      }

      if (patient.allergies) {
        const allergyText =
          typeof patient.allergies === "string"
            ? patient.allergies
            : JSON.stringify(patient.allergies);
        const allergyId = generateUUID();
        bundleEntries.push({
          fullUrl: `urn:uuid:${allergyId}`,
          resource: {
            resourceType: "AllergyIntolerance",
            id: allergyId,
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
            code: {
              text: allergyText,
            },
            patient: {
              reference: `urn:uuid:${patientUUID}`,
            },
          },
        });
        const allergyRef = {
          reference: `urn:uuid:${allergyId}`,
          display: "Allergy",
        };
        dischargeEntryRefs.push(allergyRef);
      }

      const explicitlyRenderedKeys = new Set([
        "diagnosis",
        "clinicalSummary",
        "treatmentGiven",
        "admissionDate",
        "dischargeDate",
        "ward",
        "bed",
        "admissionNotes",
        "investigationsResults",
        "surgicalNote",
        "doctorSignature",
        "conditionAtDischarge",
        "followUpInstructions",
        "surgicalProcedures",
        "dischargeMedications",
      ]);
      const additionalRows = Object.entries(ds)
        .filter(
          ([key, value]) =>
            !explicitlyRenderedKeys.has(key) && hasMeaningfulValue(value),
        )
        .map(([key, value]) => {
          const renderedValue = formatDischargeValue(value);
          if (!renderedValue) return "";
          return `<tr><td><strong>${escapeHtml(prettifyKey(key))}</strong></td><td>${renderedValue}</td></tr>`;
        })
        .filter(Boolean)
        .join("");
      if (additionalRows) {
        dischargeParts.push(
          `<p><strong>Additional Discharge Details:</strong></p>` +
            `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4">` +
            `<thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${additionalRows}</tbody></table>`,
        );
      }
    }
    if (ds?.dischargeMedications && ds.dischargeMedications.length > 0) {
      const medRows = ds.dischargeMedications
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
      dischargeParts.push(
        `<p><strong>Discharge Medications:</strong></p><table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Duration</th><th>Form</th><th>Instructions</th></tr></thead><tbody>${medRows}</tbody></table>`,
      );
      if (!diagnosisConditionUUID) {
        diagnosisConditionUUID = generateUUID();
        const condition = buildConditionResource(
          diagnosisText,
          diagnosisConditionUUID,
          patientUUID,
          bundleDate,
          practitionerUUID,
        );
        bundleEntries.push(condition);
        dischargeEntryRefs.push({
          reference: `urn:uuid:${diagnosisConditionUUID}`,
          display: "Diagnosis",
        });
      }

      ds.dischargeMedications.forEach((m) => {
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
            diagnosisConditionUUID,
            diagnosisText,
          ),
        );
        const medRef = {
          reference: `urn:uuid:${medId}`,
          display: m.medicine || "Medication",
        };
        dischargeEntryRefs.push(medRef);
      });
    }
    // Add PDF DocumentReference to the section entry if it exists
    if (optionalData?.dischargeSummary) {
      const dischargeDocRef = {
        reference: `urn:uuid:${dischargeSummaryDocId}`,
        display: "Discharge Summary PDF",
      };
      dischargeEntryRefs.push(dischargeDocRef);
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
  } // end Discharge Summary guard

  if (includeSectionByHiType("Immunization Record", allowedHiTypes)) {
    // Immunization Record — with FHIR Immunization resources (NRCES compliant)
    const imm = optionalData?.assessment?.immunization;
    console.log("[FHIR] Immunization data:", JSON.stringify(imm));
    const vaccineEntries: Array<{
      name: string;
      code: string;
      date?: Date;
      doseNumber: number;
      seriesDoses: number;
      manufacturer?: string;
      lotNumber?: string;
    }> = [];
    if (imm) {
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
    const immEntryRefs: any[] = [];
    const immRows: string[] = [];
    vaccineEntries.forEach((v) => {
      const immId = generateUUID();
      const immResource: any = {
        resourceType: "Immunization",
        id: immId,
        status: "completed",
        vaccineCode: {
          text: v.name,
        },
        patient: {
          reference: `urn:uuid:${patientUUID}`,
        },
        encounter: {
          reference: `urn:uuid:${encounterUUID}`,
        },
        occurrenceDateTime: v.date ? toSafeISOString(v.date) : bundleDate,
        primarySource: true,
        lotNumber: v.lotNumber || "N/A",
        doseQuantity: {
          value: 0.5,
          unit: "ml",
        },
        performer: [
          {
            actor: {
              reference: `urn:uuid:${practitionerUUID}`,
            },
          },
        ],
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
      immEntryRefs.push({
        reference: `urn:uuid:${immId}`,
      });
      immRows.push(
        `<tr><td>${escapeHtml(v.name)}</td><td>${v.date ? toSafeLocaleDateString(v.date) : "-"}</td><td>${v.doseNumber}/${v.seriesDoses}</td><td>${v.manufacturer ? escapeHtml(v.manufacturer) : "-"}</td><td>${v.lotNumber || "-"}</td></tr>`,
      );
    });
    const immunizationHtml =
      immRows.length > 0
        ? `<table xmlns="http://www.w3.org/1999/xhtml" border="1" cellpadding="4"><thead><tr><th>Vaccine</th><th>Date</th><th>Dose</th><th>Manufacturer</th><th>Lot Number</th></tr></thead><tbody>${immRows.join("")}</tbody></table>`
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
  } // end Immunization Record guard

  if (includeSectionByHiType("Health Document / Wellness", allowedHiTypes)) {
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
    const wellnessAdditionalDetails =
      optionalData?.assessment?.additionalDetails;
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
  } // end Health Document / Wellness guard

  // if (includeSectionByHiType("Consultation Fee", allowedHiTypes)) {
  //   // Invoice section — payment/fee data from visit (defaults to ₹0 for manual patients)
  //   const invoiceParts: string[] = [];
  //   invoiceParts.push(
  //     `<p><strong>Visit:</strong> ${escapeHtml(dept)} - ${visitDateStr}</p>`,
  //   );
  //   const fee = visit.consultationFee ?? 0;
  //   invoiceParts.push(`<p><strong>Consultation Fee:</strong> ₹${fee}</p>`);
  //   const payment = visit.payment;
  //   if (payment) {
  //     if (payment.mode)
  //       invoiceParts.push(
  //         `<p><strong>Payment Mode:</strong> ${escapeHtml(payment.mode)}</p>`,
  //       );
  //     if (payment.amount)
  //       invoiceParts.push(
  //         `<p><strong>Amount Paid:</strong> ₹${payment.amount}</p>`,
  //       );
  //   }
  //   const insurance = visit.insurance;
  //   if (insurance && insurance.provider) {
  //     invoiceParts.push(
  //       `<p><strong>Insurance:</strong> ${escapeHtml(insurance.provider)} (Policy: ${escapeHtml(insurance.policyNumber || "N/A")})</p>`,
  //     );
  //   }
  //   sections.push({
  //     title: "Consultation Fee",
  //     code: {
  //       coding: [
  //         {
  //           system: "http://loinc.org",
  //           code: "48768-6",
  //           display: "Payment sources",
  //         },
  //       ],
  //     },
  //     text: {
  //       status: "generated",
  //       div: `<div xmlns="http://www.w3.org/1999/xhtml">${invoiceParts.join("")}</div>`,
  //     },
  //     entry: [], // Will be populated
  //   });
  //   //-----------------------------------------------
  //   // Create a DocumentReference for the Invoice (Fail-safe visibility)
  //   const invoiceHtmlContent = `
  //   <html>
  //   <head><style>body{font-family:sans-serif;padding:15px;}</style></head>
  //   <body>
  //     <h2>Invoice</h2>
  //     <p><strong>Hospital:</strong> ${escapeHtml(facilityName)}</p>
  //     <p><strong>Date:</strong> ${visitDateStr}</p>
  //     <hr/>
  //     <div style="margin:20px 0;">
  //       ${invoiceParts.join("")}
  //     </div>
  //     <hr/>
  //     <p style="text-align:right;"><strong>Total Amount: ₹${fee}</strong></p>
  //   </body>
  //   </html>
  // `;

  //   const invoiceBase64 = Buffer.from(invoiceHtmlContent).toString("base64");
  //   const patientRef = `urn:uuid:${patientUUID}`;
  //   const practRef = `urn:uuid:${practitionerUUID}`;

  //   // Build a single ChargeItem for the consultation fee
  //   const consultChargeItemId = generateUUID();
  //   bundleEntries.push(
  //     buildChargeItemResource(
  //       consultChargeItemId,
  //       patientRef,
  //       practRef,
  //       toSafeISOString(visitDateStr),
  //       { particulars: "Consultation Fee", amount: fee, rate: fee, unit: 1 },
  //     ),
  //   );

  //   const invoiceUUID = generateUUID();
  //   const invoiceReport = buildInvoiceResource(
  //     invoiceUUID,
  //     toSafeISOString(visitDateStr),
  //     fee,
  //     [{ particulars: "Consultation Fee", amount: fee, rate: fee, unit: 1 }],
  //     patientRef,
  //     practRef,
  //     [consultChargeItemId],
  //   );
  //   bundleEntries.push(invoiceReport);

  //   const invoiceSection = sections.find((s) => s.title === "Consultation Fee");
  //   if (invoiceSection) {
  //     if (!invoiceSection.entry) invoiceSection.entry = [];
  //     invoiceSection.entry.push({ reference: `urn:uuid:${invoiceUUID}` });
  //   }
  //   console.log(
  //     `[FHIR] Generated Invoice section with ${invoiceParts.length} parts. Fee: ${fee}`,
  //   );
  // }
  // end Consultation Fee guard
  // -------------------------------------------------
  // -------------------------------------------------
  // CLEANUP: Remove dangling references (e.g. failed PDF generation)
  // If a referenced resource wasn't added to bundleEntries (e.g. PDF gen failed), remove the reference from the section.
  const availableIds = new Set(bundleEntries.map((e) => e.fullUrl));
  console.log(
    `[FHIR-CLEANUP] availableIds (${availableIds.size}): ${JSON.stringify([...availableIds])}`,
  );
  sections.forEach((section) => {
    if (section.entry) {
      const before = section.entry.length;
      const removed = section.entry
        .filter((e: any) => !availableIds.has(e.reference))
        .map((e: any) => e.reference);
      section.entry = section.entry.filter((e: any) =>
        availableIds.has(e.reference),
      );
      if (removed.length > 0) {
        console.log(
          `[FHIR-CLEANUP] Section "${section.title}": removed ${removed.length} dangling refs: ${JSON.stringify(removed)}`,
        );
      }
      // Remove empty entry array — ABDM rejects sections with entry: []
      if (section.entry.length === 0) {
        console.log(
          `[FHIR-CLEANUP] Section "${section.title}": entry array now empty, deleting entry key`,
        );
        delete section.entry;
      }
    }
  });

  // Filter sections by consented hiTypes when provided (ABDM: share only what consent allows)
  const filteredSections =
    allowedHiTypes && allowedHiTypes.length > 0
      ? sections.filter((s) => includeSectionByHiType(s.title, allowedHiTypes))
      : sections;

  // Per-type ABDM FHIR Composition profile and SNOMED type code.
  // Each HI type must use its own NRCES profile so PHR apps can interpret the document correctly.
  // Reference: https://nrces.in/ndhm/fhir/r4/
  const HITYPE_COMPOSITION_META: Record<
    string,
    {
      profile: string;
      typeCode: string;
      typeDisplay: string;
      titlePrefix: string;
    }
  > = {
    Prescription: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord",
      typeCode: "440545006",
      typeDisplay: "Prescription record",
      titlePrefix: "Prescription Record",
    },
    DiagnosticReport: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord",
      typeCode: "721981007",
      typeDisplay: "Diagnostic studies report",
      titlePrefix: "Diagnostic Report",
    },
    DischargeSummary: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord",
      typeCode: "373942005",
      typeDisplay: "Discharge summary",
      titlePrefix: "Discharge Summary",
    },
    ImmunizationRecord: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/ImmunizationRecord",
      typeCode: "41000179103",
      typeDisplay: "Immunization record",
      titlePrefix: "Immunization Record",
    },
    WellnessRecord: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/WellnessRecord",
      typeCode: "419891008",
      typeDisplay: "Record artifact",
      titlePrefix: "Wellness Record",
    },
    HealthDocumentRecord: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/HealthDocumentRecord",
      typeCode: "419891008",
      typeDisplay: "Record artifact",
      titlePrefix: "Health Document",
    },
    Invoice: {
      profile:
        "https://nrces.in/ndhm/fhir/r4/StructureDefinition/InvoiceRecord",
      typeCode: "",
      typeDisplay: "",
      titlePrefix: "Invoice Record",
    },
  };

  // OPConsultation and Invoice fall back to OPConsultRecord (ABDM default for consultation + billing)
  const DEFAULT_COMPOSITION_META = {
    profile:
      "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord",
    typeCode: "371530004",
    typeDisplay: "Clinical consultation report",
    titlePrefix: "Health Record",
  };

  // Determine the single HI type driving this bundle (set when per-type CareContext is used).
  // For legacy multi-type bundles, primaryHiType is undefined → fall back to OPConsultRecord.
  const primaryHiType =
    allowedHiTypes?.length === 1 ? allowedHiTypes[0] : undefined;
  // Compatibility: PHR apps currently render Prescription DocumentReference more reliably
  // when Composition uses OPConsultRecord metadata (same as the known working commit behavior).
  const compositionMeta =
    primaryHiType === "Prescription"
      ? DEFAULT_COMPOSITION_META
      : (primaryHiType && HITYPE_COMPOSITION_META[primaryHiType]) ||
        DEFAULT_COMPOSITION_META;

  // Keep analyst-as-author logic specifically for DiagnosticReport bundles (per ABDM reference spec)
  const isDiagnosticOnlyBundle = primaryHiType === "DiagnosticReport";

  const compositionResource = {
    fullUrl: `urn:uuid:${compositionUUID}`,
    resource: {
      resourceType: "Composition",
      id: compositionUUID,
      meta: {
        profile: [compositionMeta.profile],
      },
      status: "final",
      type: compositionMeta.typeCode
        ? {
            coding: [
              {
                system: "http://snomed.info/sct",
                code: compositionMeta.typeCode,
                display: compositionMeta.typeDisplay,
              },
            ],
          }
        : {
            text: "Invoice Record",
          },
      subject: { reference: `urn:uuid:${patientUUID}` },
      encounter: { reference: `urn:uuid:${encounterUUID}` },
      date: new Date().toISOString(),
      author: [
        {
          // Use analyst as author for DiagnosticReport-only bundles (per ABDM reference)
          reference: `urn:uuid:${
            isDiagnosticOnlyBundle && analystPractitionerUUID
              ? analystPractitionerUUID
              : practitionerUUID
          }`,
          display:
            isDiagnosticOnlyBundle && analystNameResolved
              ? analystNameResolved
              : doctor,
        },
      ],
      title: `${compositionMeta.titlePrefix} - ${patientName} - ${visitDateStr}`,
      custodian: { reference: `urn:uuid:${orgUUID}` },
      section: filteredSections,
    },
  };

  bundleEntries.unshift(compositionResource);

  // Diagnostic: log sections and resource types in the bundle
  const sectionTitles = filteredSections.map((s: any) => s.title);
  const resourceTypes = bundleEntries.map(
    (e: any) => e.resource?.resourceType || "unknown",
  );
  const sectionEntryDetails = filteredSections.map((s: any) => ({
    title: s.title,
    entryCount: s.entry?.length ?? 0,
    entryRefs: (s.entry || []).map((e: any) => e.reference),
  }));
  console.log(`[FHIR] Bundle sections: ${JSON.stringify(sectionTitles)}`);
  console.log(
    `[FHIR] Bundle resourceTypes (${resourceTypes.length}): ${JSON.stringify(resourceTypes)}`,
  );
  console.log(`[FHIR] Section entries: ${JSON.stringify(sectionEntryDetails)}`);
  const docRefInBundle = bundleEntries.some(
    (e: any) => e.resource?.resourceType === "DocumentReference",
  );
  console.log(`[FHIR] DocumentReference in bundle: ${docRefInBundle}`);

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
