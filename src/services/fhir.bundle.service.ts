import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { ICareContext, HIType } from "../models/CareContext";
import { facilityId, facilityName } from "../utils/constant";

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

const buildInvoiceResource = (
  invoiceId: string,
  date?: string,
  value?: number,
  unit?: string,
) => {
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
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><p class="res-header-id"><b>Generated Narrative: Invoice Consultation-example-01</b></p><a name="Consultation-example-01"> </a><a name="hcConsultation-example-01"> </a><a name="Consultation-example-01-hi-IN"> </a><div style="display: inline-block; background-color: #d9e0e7; padding: 6px; margin: 4px; border: 1px solid #8da1b4; border-radius: 5px; line-height: 60%"><p style="margin-bottom: 0px">version: 1; Last updated: 2023-08-23 17:02:00+0530</p><p style="margin-bottom: 0px">Profile: <a href="StructureDefinition-Invoice.html">Invoice</a></p></div><p><b>identifier</b>: CA/5842</p><p><b>status</b>: issued</p><p><b>type</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes 00}">Consultation</span></p><p><b>subject</b>: <a href="Patient-example-01.html">ABC Male, DoB: 1981-01-12 ( Medical record number: 22-7225-4829-5255)</a></p><p><b>date</b>: 2023-06-01 10:00:00+0530</p><h3>Participants</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Actor</b></td></tr><tr><td style="display: none">*</td><td><a href="Practitioner-example-01.html">Practitioner Dr. DEF</a></td></tr></table><blockquote><p><b>lineItem</b></p><p><b>sequence</b>: 1</p><p><b>chargeItem</b>: <a href="ChargeItem-Consultation-example-01.html">ChargeItem Consultation</a></p><blockquote><p><b>priceComponent</b></p><p><b>type</b>: base price</p><p><b>code</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components 01}">Rate</span></p><h3>Amounts</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>550</td><td>Indian rupee</td></tr></table></blockquote><blockquote><p><b>priceComponent</b></p><p><b>type</b>: informational</p><p><b>code</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components 00}">MRP</span></p><h3>Amounts</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>600</td><td>Indian rupee</td></tr></table></blockquote><blockquote><p><b>priceComponent</b></p><p><b>type</b>: discount</p><p><b>code</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components 02}">Discount</span></p><h3>Amounts</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>50</td><td>Indian rupee</td></tr></table></blockquote><blockquote><p><b>priceComponent</b></p><p><b>type</b>: tax</p><p><b>code</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components 03}">CGST</span></p><h3>Amounts</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>30</td><td>Indian rupee</td></tr></table></blockquote><blockquote><p><b>priceComponent</b></p><p><b>type</b>: tax</p><p><b>code</b>: <span title="Codes:{https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-price-components 04}">SGST</span></p><h3>Amounts</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>30</td><td>Indian rupee</td></tr></table></blockquote></blockquote><h3>TotalNets</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>610</td><td>Indian rupee</td></tr></table><h3>TotalGrosses</h3><table class="grid"><tr><td style="display: none">-</td><td><b>Value</b></td><td><b>Currency</b></td></tr><tr><td style="display: none">*</td><td>500</td><td>Indian rupee</td></tr></table></div>',
      },
      identifier: [
        {
          value: "CA/5842",
        },
      ],
      status: "issued",
      type: {
        coding: [
          {
            system:
              "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-billing-codes",
            code: "00",
            display: "Consultation",
          },
        ],
      },
      // subject: {
      //   reference: "Patient/example-01",
      // },
      date: date,
      // participant: [
      //   {
      //     actor: {
      //       reference: "Practitioner/example-01",
      //     },
      //   },
      // ],
      lineItem: [
        {
          sequence: 1,
          chargeItemReference: {
            reference: "ChargeItem/Consultation-example-01",
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
                value,
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
                value: 0,
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
                value: 0,
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
                value: 0,
                currency: "INR",
              },
            },
          ],
        },
      ],
      totalNet: {
        value,
        currency: "INR",
      },
      totalGross: {
        value,
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
    conditionAtDischarge?: string;
    followUpInstructions?: string;
    surgicalProcedures?: string;
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
        text: med.dosage,
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
  "Vital Signs": ["OPConsultation", "WellnessRecord"],
  "Medical History": "OPConsultation",
  Prescription: "Prescription",
  "Discharge Summary": "DischargeSummary",
  "Immunization Record": ["OPConsultation", "ImmunizationRecord"],
  "Health Document / Wellness": [
    "OPConsultation",
    "WellnessRecord",
    "HealthDocumentRecord",
  ],
  Invoice: ["OPConsultation", "InvoiceRecord"],
  "Consultation Fee": ["InvoiceRecord", "OPConsultation"],
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
  console.log("allowedHiTypes", allowedHiTypes);
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
    entry: [{ reference: `urn:uuid:${encounterUUID}` }],
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
    historyParts.push(`<strong>Medical History:</strong>`);
    assessHistory.forEach((h) => {
      const line = [h.disease, h.duration, h.medications]
        .filter(Boolean)
        .join(" – ");
      if (line) historyParts.push(line);
    });
  }
  const surgicalHistory = optionalData?.assessment?.surgicalHistory;
  if (surgicalHistory && surgicalHistory.length > 0) {
    historyParts.push(`<strong>Surgical History:</strong>`);
    surgicalHistory.forEach((h) => {
      const parts = [
        h.surgical,
        h.date ? toSafeLocaleDateString(h.date) : null,
        h.surgeonName ? `Dr. ${h.surgeonName}` : null,
        h.hospital,
      ]
        .filter(Boolean)
        .join(" - ");
      if (parts) historyParts.push(parts);
    });
  }
  const personalHistory = optionalData?.assessment?.personalHistory;
  if (personalHistory && personalHistory.length > 0) {
    historyParts.push(`<strong>Personal History:</strong>`);
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
      if (parts) historyParts.push(parts);
    });
  }
  const historyEntryRefs: any[] = [];
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
      entry: historyEntryRefs,
    });
  }

  // (Duplicate "Diagnostic Report / Lab" section removed — lab data is already in "Diagnostic Test Results" above)

  // Discharge Summary — with FHIR MedicationRequest resources for discharge meds
  const ds = optionalData?.dischargeSummary;
  const dischargeParts: string[] = [];
  const dischargeEntryRefs: any[] = [];
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
  const symptoms = optionalData?.assessment?.symptomsComplaints;
  if (symptoms)
    wellnessParts.push(
      `<p><strong>Symptoms / Complaints:</strong> ${escapeHtml(symptoms)}</p>`,
    );
  if (patient.allergies)
    wellnessParts.push(
      `<p><strong>Allergies:</strong> ${escapeHtml(typeof patient.allergies === "string" ? patient.allergies : String(patient.allergies))}</p>`,
    );
  if (patient.existingMedicalConditions)
    wellnessParts.push(
      `<p><strong>Existing Conditions:</strong> ${escapeHtml(patient.existingMedicalConditions)}</p>`,
    );
  const additionalDetails = optionalData?.assessment?.additionalDetails;
  if (additionalDetails && additionalDetails.length > 0) {
    wellnessParts.push(`<p><strong>Additional Details:</strong></p>`);
    const detailsRows = additionalDetails
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
      <p><strong>Hospital:</strong> ${escapeHtml(process.env.FACILITY_NAME || "Hospital")}</p>
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
