import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { facilityName } from "./constant";

const VITAL_DISPLAY_NAMES: Record<string, string> = {
  pulse: "Pulse",
  spo2: "SpO\u2082",
  sbp: "Systolic BP",
  dbp: "Diastolic BP",
  map: "Mean Arterial Pressure",
  temp: "Temperature",
  respiration: "Respiration Rate",
  painScore: "Pain Score",
  height: "Height",
  weight: "Weight",
  bsa: "Body Surface Area",
  bmi: "BMI",
  category: "Category",
  bs: "Blood Sugar",
  creatinine: "Creatinine",
  egfr: "eGFR",
  egfr2: "eGFR (CKD-EPI)",
};

const DEFAULT_VITAL_UNITS: Record<string, string> = {
  pulse: "BPM",
  spo2: "%",
  sbp: "mmHg",
  dbp: "mmHg",
  map: "mmHg",
  temp: "\u00b0C",
  respiration: "bpm",
  painScore: "",
  height: "cm",
  weight: "kg",
  bsa: "m\u00b2",
  bmi: "kg/m\u00b2",
  category: "",
  bs: "mg/dL",
  creatinine: "mg/dL",
  egfr: "mL/min/1.73m\u00b2",
  egfr2: "mL/min/1.73m\u00b2",
};

// ─────────────────────────────── Premium CSS ──────────────────────────────────
const css = `
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    color: #2D3748;
    background: #ffffff;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Document Header ── */
  .doc-header {
    background: linear-gradient(135deg, #1a3c5e 0%, #2471a3 100%);
    padding: 22px 32px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .h-name {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.3px;
  }
  .h-sub {
    font-size: 9.5px;
    color: rgba(255,255,255,0.62);
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-top: 3px;
  }
  .doc-type-badge {
    background: rgba(255,255,255,0.12);
    border: 1px solid rgba(255,255,255,0.22);
    border-radius: 6px;
    padding: 7px 18px;
    text-align: right;
  }
  .dt-label {
    font-size: 11px;
    font-weight: 700;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 1.2px;
  }
  .dt-date {
    font-size: 10px;
    color: rgba(255,255,255,0.68);
    margin-top: 3px;
  }
  .header-accent {
    height: 3px;
    background: linear-gradient(90deg, #F39C12, #F7DC6F 40%, #2471a3);
  }

  /* ── Patient Info Card ── */
  .patient-card {
    background: #F4F8FC;
    border-bottom: 1px solid #D6E4F0;
    padding: 14px 32px;
  }
  .patient-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 40px;
  }
  .pfield .plabel {
    font-size: 9px;
    color: #7F9BAF;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    display: block;
    margin-bottom: 2px;
  }
  .pfield .pvalue {
    font-size: 12px;
    font-weight: 600;
    color: #1a3c5e;
  }
  .pfield-full { flex-basis: 100%; }

  /* ── Content Area ── */
  .content { padding: 20px 32px 12px; }

  /* ── Section ── */
  .section { margin-bottom: 18px; page-break-inside: avoid; }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    color: #1a3c5e;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    padding: 5px 12px;
    background: linear-gradient(90deg, #DBEAFE, #EFF6FF);
    border-left: 3px solid #2471a3;
    border-radius: 0 4px 4px 0;
    margin-bottom: 10px;
  }

  /* ── Meta Strip ── */
  .meta-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
    padding: 8px 12px;
    background: #F8FBFE;
    border: 1px solid #D6E4F0;
    border-radius: 4px;
    margin-bottom: 10px;
    font-size: 11px;
  }
  .mlabel { color: #7F9BAF; }
  .mvalue { font-weight: 600; color: #1a3c5e; }

  /* ── Text Fields ── */
  .tf { font-size: 11.5px; margin-bottom: 7px; }
  .tf-lbl { font-weight: 600; color: #1a3c5e; }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  thead tr { background: #1a3c5e; }
  thead th {
    padding: 8px 10px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    color: #ffffff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  tbody tr:nth-child(even) { background: #F4F8FC; }
  tbody td {
    padding: 7px 10px;
    border-bottom: 1px solid #E5EEF6;
    color: #2D3748;
    vertical-align: middle;
  }
  tfoot td {
    padding: 9px 10px;
    font-weight: 700;
    background: #DBEAFE;
    border-top: 2px solid #2471a3;
    color: #1a3c5e;
  }

  /* ── Badges ── */
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 20px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge-normal      { background: #D1FAE5; color: #065F46; }
  .badge-high        { background: #FEE2E2; color: #991B1B; }
  .badge-low         { background: #FEF3C7; color: #92400E; }
  .badge-paid        { background: #D1FAE5; color: #065F46; }
  .badge-pending     { background: #FEF3C7; color: #92400E; }
  .badge-partial     { background: #DBEAFE; color: #1E40AF; }
  .badge-final       { background: #D1FAE5; color: #065F46; }
  .badge-preliminary { background: #FEF3C7; color: #92400E; }

  /* ── Abnormal Values ── */
  .val-high { color: #991B1B; font-weight: 700; }
  .val-low  { color: #92400E; font-weight: 700; }

  /* ── Vital Cards ── */
  .vitals-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .vital-card {
    background: #F4F8FC;
    border: 1px solid #D6E4F0;
    border-top: 3px solid #2471a3;
    border-radius: 0 0 6px 6px;
    padding: 10px 12px;
    min-width: 100px;
    flex: 1;
    text-align: center;
  }
  .vc-name { font-size: 9px; color: #7F9BAF; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .vc-val  { font-size: 17px; font-weight: 700; color: #1a3c5e; line-height: 1.1; }
  .vc-unit { font-size: 9px; color: #A0AEC0; margin-top: 2px; }

  /* ── Advice / Highlight Box ── */
  .adv-box {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-left: 3px solid #F59E0B;
    border-radius: 0 4px 4px 0;
    padding: 10px 14px;
    font-size: 11.5px;
    line-height: 1.6;
  }

  /* ── Admission Banner Cards ── */
  .adm-banner { display: flex; gap: 8px; margin-bottom: 12px; }
  .adm-card {
    flex: 1;
    background: #EFF6FF;
    border: 1px solid #BFDBFE;
    border-top: 3px solid #2471a3;
    border-radius: 0 0 6px 6px;
    padding: 8px 14px;
    text-align: center;
  }
  .ac-label { font-size: 9px; color: #7F9BAF; text-transform: uppercase; letter-spacing: 0.8px; }
  .ac-val   { font-size: 13px; font-weight: 700; color: #1a3c5e; margin-top: 4px; }

  /* ── Invoice Total Row ── */
  .total-row { background: #1a3c5e !important; }
  .total-row td {
    color: #ffffff !important;
    font-size: 13px !important;
    font-weight: 700 !important;
    padding: 10px 10px !important;
    border: none !important;
  }

  /* ── Footer ── */
  .doc-footer {
    margin-top: 24px;
    border-top: 1px solid #D6E4F0;
    padding: 14px 32px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .sig-block { min-width: 140px; text-align: center; }
  .sig-space { height: 32px; }
  .sig-line  { border-bottom: 1px solid #1a3c5e; margin-bottom: 4px; }
  .sig-name  { font-size: 11px; font-weight: 700; color: #1a3c5e; }
  .sig-role  { font-size: 9.5px; color: #7F9BAF; margin-top: 1px; }
  .doc-stamp { font-size: 9px; color: #A0AEC0; line-height: 1.8; text-align: right; }

  /* ── Sub-section heading ── */
  .sub-heading {
    font-size: 10px;
    font-weight: 700;
    color: #2471a3;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 6px;
  }

  /* ── Watermark ── */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%,-50%) rotate(-25deg);
    font-size: 88px;
    font-weight: 900;
    color: rgba(36,113,163,0.028);
    pointer-events: none;
    white-space: nowrap;
    letter-spacing: 5px;
  }

  .page-break { page-break-before: always; }
  .no-break   { page-break-inside: avoid; }
</style>
`;

// ──────────────────────────────── Helpers ─────────────────────────────────────
const fmtDate = (d: Date | string | undefined | null): string =>
  d ? new Date(d as string).toLocaleDateString("en-IN") : "-";

const fmtDateTime = (d: Date | string | undefined | null): string =>
  d ? new Date(d as string).toLocaleString("en-IN") : "-";

/** Gradient header bar shared by all documents */
const docHeader = (docType: string, date: string): string => `
  <div class="doc-header">
    <div>
      <div class="h-name">${facilityName || "Hospital"}</div>
      <div class="h-sub">Healthcare Excellence &middot; Clinical Documentation</div>
    </div>
    <div class="doc-type-badge">
      <div class="dt-label">${docType}</div>
      <div class="dt-date">${date}</div>
    </div>
  </div>
  <div class="header-accent"></div>
`;

/** Patient info bar rendered below the header */
const patientCard = (patient: IPatient, visit: IScanShareVisit): string => {
  const name =
    patient.name || `${patient.f_name || ""} ${patient.l_name || ""}`.trim();
  const age = patient.age ? `${patient.age} yrs` : "";
  const gender = patient.gender || "";
  const mobile = patient.mobile || "";
  const uhid = patient?.uhid || "";
  const abhaNumber = visit.abhaNumber || patient.ABHANumber || "";
  const abhaAddress = visit.abhaAddress || patient.abhaaddress || "";
  const doctor = visit.doctorName || "";
  const dept = visit.department || "";
  const visitDate = visit.visitDate
    ? fmtDate(new Date(visit.visitDate))
    : fmtDate(new Date());

  const fields: string[] = [];
  if (name)
    fields.push(
      `<div class="pfield"><span class="plabel">Patient Name</span><span class="pvalue">${name}</span></div>`,
    );
  if (age || gender)
    fields.push(
      `<div class="pfield"><span class="plabel">Age / Gender</span><span class="pvalue">${[age, gender].filter(Boolean).join(" / ")}</span></div>`,
    );
  if (uhid)
    fields.push(
      `<div class="pfield"><span class="plabel">UHID</span><span class="pvalue">${uhid}</span></div>`,
    );
  if (mobile)
    fields.push(
      `<div class="pfield"><span class="plabel">Mobile</span><span class="pvalue">${mobile}</span></div>`,
    );
  fields.push(
    `<div class="pfield"><span class="plabel">Visit Date</span><span class="pvalue">${visitDate}</span></div>`,
  );
  if (abhaNumber)
    fields.push(
      `<div class="pfield"><span class="plabel">ABHA Number</span><span class="pvalue">${abhaNumber}</span></div>`,
    );
  if (abhaAddress)
    fields.push(
      `<div class="pfield"><span class="plabel">ABHA Address</span><span class="pvalue">${abhaAddress}</span></div>`,
    );
  if (doctor)
    fields.push(
      `<div class="pfield pfield-full"><span class="plabel">Consulting Physician</span><span class="pvalue">Dr. ${doctor}${dept ? ` &middot; ${dept}` : ""}</span></div>`,
    );

  return `
  <div class="patient-card">
    <div class="patient-grid">${fields.join("")}</div>
  </div>`;
};

/** Colour-coded badge for lab flags */
const flagBadge = (flag: string): string => {
  if (!flag) return "";
  const cls =
    flag.toLowerCase() === "normal"
      ? "badge-normal"
      : flag.toLowerCase() === "high"
        ? "badge-high"
        : "badge-low";
  return `<span class="badge ${cls}">${flag}</span>`;
};

/** CSS class for abnormal values */
const valClass = (flag: string): string =>
  flag === "High" ? "val-high" : flag === "Low" ? "val-low" : "";

// ──────────────────────────────── Templates ──────────────────────────────────

export const getPrescriptionTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  medications: any[],
  advice?: string,
) => {
  const date = visit.visitDate
    ? fmtDate(new Date(visit.visitDate))
    : fmtDate(new Date());

  const medRows = medications
    .map((m, index) => {
      let timingStr = "-";
      if (m.timing) {
        timingStr = `${m.timing.frequency} \u00d7 / ${m.timing.period} ${m.timing.periodUnit}`;
      } else if (m.frequency) {
        timingStr = m.frequency;
      }
      const durStr = m.duration
        ? `${m.duration} ${m.durationUnit || "days"}`
        : "-";
      const instParts: string[] = [];
      if (m.instructions && m.instructions !== "Other")
        instParts.push(m.instructions);
      if (m.customInstructions) instParts.push(m.customInstructions);
      const instStr = instParts.join(", ") || "-";
      return `<tr>
        <td style="font-weight:600;color:#1a3c5e;">${index + 1}. ${m.medicine || ""}${m.dosage ? ` <span style="font-weight:400;color:#7F9BAF;">${m.dosage}</span>` : ""}</td>
        <td>${timingStr}</td>
        <td>${durStr}</td>
        <td>${m.form || "-"}</td>
        <td>${instStr}</td>
      </tr>`;
    })
    .join("");

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Prescription", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">&#8478; Medications</div>
        <table>
          <thead>
            <tr>
              <th>Medicine &amp; Dosage</th>
              <th>Frequency</th>
              <th>Duration</th>
              <th>Form</th>
              <th>Instructions</th>
            </tr>
          </thead>
          <tbody>${medRows}</tbody>
        </table>
      </div>
      ${
        advice
          ? `
      <div class="section">
        <div class="section-title">Advice &amp; Instructions</div>
        <div class="adv-box">${advice}</div>
      </div>`
          : ""
      }
    </div>
    <div class="doc-footer">
      <div>
        <div style="font-size:10px;color:#7F9BAF;">Valid for 30 days from date of issue.</div>
        <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
      </div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Prescribing Physician</div>
      </div>
    </div>
  </body>
  </html>`;
};

export const getDiagnosticReportTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  labs: any[],
) => {
  const date = fmtDate(new Date());
  const analystName = labs.find((l) => l.analystName)?.analystName || "";
  const hasSampleId = labs.some((l) => l.sampleId !== undefined);

  const labRows = labs
    .map(
      (l) => `<tr>
      <td>${l.testType || "-"}</td>
      <td>${l.resultValue || "-"}</td>
      <td>${l.measurementUnit || "-"}</td>
      <td>${fmtDate(l.reportDate)}</td>
      ${hasSampleId ? `<td>${l.sampleId || "-"}</td>` : ""}
    </tr>`,
    )
    .join("");

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Diagnostic Report", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">Test Results</div>
        <table>
          <thead>
            <tr>
              <th>Test Name</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Date</th>
              ${hasSampleId ? "<th>Sample ID</th>" : ""}
            </tr>
          </thead>
          <tbody>${labRows}</tbody>
        </table>
      </div>
    </div>
    <div class="doc-footer">
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">${analystName || "Lab In-charge"}</div>
        <div class="sig-role">Analyst / Lab In-charge</div>
      </div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
    </div>
  </body>
  </html>`;
};

export const getDischargeSummaryTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  ds: any,
  assessment?: any,
  labReports?: any[],
) => {
  const date = fmtDate(new Date());

  const medRows =
    ds.dischargeMedications
      ?.map((m: any) => {
        let timingStr = "-";
        if (m.timing) {
          timingStr = `${m.timing.frequency} \u00d7 / ${m.timing.period} ${m.timing.periodUnit}`;
        } else if (m.frequency) {
          timingStr = m.frequency;
        }
        const durStr = m.duration
          ? `${m.duration} ${m.durationUnit || "days"}`
          : "-";
        const instParts: string[] = [];
        if (m.instructions && m.instructions !== "Other")
          instParts.push(m.instructions);
        if (m.customInstructions) instParts.push(m.customInstructions);
        return `<tr>
          <td style="font-weight:600;">${m.medicine || "-"}</td>
          <td>${m.dosage || "-"}</td>
          <td>${timingStr}</td>
          <td>${durStr}</td>
          <td>${m.form || "-"}</td>
          <td>${instParts.join(", ") || "-"}</td>
        </tr>`;
      })
      .join("") || "";

  const admBanner =
    ds.admissionDate || ds.dischargeDate
      ? `<div class="adm-banner">
        ${ds.admissionDate ? `<div class="adm-card"><div class="ac-label">Admission Date</div><div class="ac-val">${fmtDate(ds.admissionDate)}</div></div>` : ""}
        ${ds.dischargeDate ? `<div class="adm-card"><div class="ac-label">Discharge Date</div><div class="ac-val">${fmtDate(ds.dischargeDate)}</div></div>` : ""}
        ${ds.ward ? `<div class="adm-card"><div class="ac-label">Ward</div><div class="ac-val">${ds.ward}</div></div>` : ""}
        ${ds.bed ? `<div class="adm-card"><div class="ac-label">Bed No.</div><div class="ac-val">${ds.bed}</div></div>` : ""}
      </div>`
      : "";

  const textFields: string[] = [];
  if (ds.admissionNotes)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Admission Notes: </span>${ds.admissionNotes}</div>`,
    );
  if (ds.diagnosis)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Diagnosis: </span>${ds.diagnosis}</div>`,
    );
  if (ds.conditionAtDischarge)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Condition at Discharge: </span>${ds.conditionAtDischarge}</div>`,
    );
  if (ds.clinicalSummary)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Clinical Summary: </span>${ds.clinicalSummary}</div>`,
    );
  if (ds.investigationsResults)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Investigation Results: </span>${ds.investigationsResults}</div>`,
    );
  if (ds.treatmentGiven)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Treatment Given: </span>${ds.treatmentGiven}</div>`,
    );
  if (ds.surgicalProcedures)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Surgical Procedures: </span>${ds.surgicalProcedures}</div>`,
    );
  if (ds.surgicalNote)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Surgical Note: </span>${ds.surgicalNote}</div>`,
    );
  if (ds.followUpInstructions)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Follow-up Instructions: </span>${ds.followUpInstructions}</div>`,
    );
  if (ds.advice)
    textFields.push(
      `<div class="tf"><span class="tf-lbl">Advice: </span>${ds.advice}</div>`,
    );

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Discharge Summary", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">Admission &amp; Discharge Details</div>
        ${admBanner}
        ${textFields.join("")}
      </div>
      ${
        assessment?.medicalHistory && assessment.medicalHistory.length > 0
          ? `
      <div class="section">
        <div class="section-title">Past Medical History</div>
        <table>
          <thead><tr><th>Disease</th><th>Duration</th><th>Medications</th></tr></thead>
          <tbody>${assessment.medicalHistory.map((h: any) => `<tr><td>${h.disease || "-"}</td><td>${h.duration || "-"}</td><td>${h.medications || "-"}</td></tr>`).join("")}</tbody>
        </table>
      </div>`
          : ""
      }
      ${
        labReports && labReports.length > 0
          ? `
      <div class="section">
        <div class="section-title">Investigations (Lab Reports)</div>
        <table>
          <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Date</th></tr></thead>
          <tbody>${labReports.map((lab: any) => `<tr><td>${lab.testType || "-"}</td><td>${lab.resultValue || "-"}</td><td>${lab.measurementUnit || "-"}</td><td>${fmtDate(lab.reportDate)}</td></tr>`).join("")}</tbody>
        </table>
      </div>`
          : ""
      }
      ${
        medRows
          ? `
      <div class="section">
        <div class="section-title">Discharge Medications</div>
        <table>
          <thead><tr><th>Medicine</th><th>Dosage</th><th>Timing</th><th>Duration</th><th>Form</th><th>Instructions</th></tr></thead>
          <tbody>${medRows}</tbody>
        </table>
      </div>`
          : ""
      }
    </div>
    <div class="doc-footer">
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">${ds.doctorSignature || `Dr. ${visit.doctorName || "Practitioner"}`}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
    </div>
  </body>
  </html>`;
};

export const getOPConsultationTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  soap: any,
  vitals: any,
) => {
  const date = visit.visitDate
    ? fmtDate(new Date(visit.visitDate))
    : fmtDate(new Date());

  const vitalsHtml =
    vitals && Object.keys(vitals).length > 0
      ? `<div class="section">
        <div class="section-title">Vital Signs</div>
        <div class="vitals-grid">
          ${Object.entries(vitals)
            .map(
              ([k, v]) => `<div class="vital-card">
            <div class="vc-name">${VITAL_DISPLAY_NAMES[k] || k}</div>
            <div class="vc-val">${v}</div>
            <div class="vc-unit">${DEFAULT_VITAL_UNITS[k] || ""}</div>
          </div>`,
            )
            .join("")}
        </div>
      </div>`
      : "";

  const soapHtml = soap
    ? `<div class="section">
        <div class="section-title">Clinical Notes (SOAP)</div>
        ${soap.subjective ? `<div class="tf"><span class="tf-lbl">Subjective: </span>${soap.subjective}</div>` : ""}
        ${soap.objective ? `<div class="tf"><span class="tf-lbl">Objective: </span>${soap.objective}</div>` : ""}
        ${soap.assessment ? `<div class="tf"><span class="tf-lbl">Assessment: </span>${soap.assessment}</div>` : ""}
        ${soap.plan ? `<div class="tf"><span class="tf-lbl">Plan: </span>${soap.plan}</div>` : ""}
      </div>`
    : "";

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("OPD Consultation", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">Consultation Details</div>
        <div class="meta-strip">
          <span><span class="mlabel">Chief Complaint: </span><span class="mvalue">${visit.complaint || "Routine Checkup"}</span></span>
          <span><span class="mlabel">Department: </span><span class="mvalue">${visit.department || "OPD"}</span></span>
        </div>
      </div>
      ${vitalsHtml}
      ${soapHtml}
    </div>
    <div class="doc-footer">
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
    </div>
  </body>
  </html>`;
};

export const getInvoiceTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  billing: any,
) => {
  const date = billing.date ? fmtDate(billing.date) : fmtDate(new Date());
  const statusMap: Record<string, string> = {
    paid: "badge-paid",
    pending: "badge-pending",
    partial: "badge-partial",
  };
  const statusBadge = (s: string) =>
    `<span class="badge ${statusMap[s?.toLowerCase()] || "badge-pending"}">${s || "Pending"}</span>`;

  const billingRows =
    billing.billings
      ?.map(
        (b: any) => `<tr>
      <td>${b.particulars || "-"}</td>
      <td style="text-align:right;">\u20b9${b.rate || "0"}</td>
      <td style="text-align:center;">${b.unit || "-"}</td>
      <td style="text-align:right;font-weight:600;">\u20b9${b.amount || "0"}</td>
    </tr>`,
      )
      .join("") || "";

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    ${docHeader("Invoice / Bill", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="meta-strip">
          <span><span class="mlabel">Invoice No: </span><span class="mvalue">${billing._id || "-"}</span></span>
          <span><span class="mlabel">Date: </span><span class="mvalue">${date}</span></span>
          <span><span class="mlabel">Status: </span>${statusBadge(billing.status)}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Particulars</th>
              <th style="text-align:right;">Rate (\u20b9)</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Amount (\u20b9)</th>
            </tr>
          </thead>
          <tbody>${billingRows}</tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="3" style="text-align:right;">Total Amount</td>
              <td style="text-align:right;">\u20b9${billing.totalAmount || "0"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <div class="doc-footer">
      <div style="font-size:9.5px;color:#A0AEC0;">Computer-generated invoice. No signature required.</div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Cashier / Accountant</div>
        <div class="sig-role">Authorised Signatory</div>
      </div>
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
    </div>
  </body>
  </html>`;
};

export const getVitalsTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  vitals: Record<string, string | number | undefined>,
) => {
  const date = visit.visitDate
    ? fmtDate(new Date(visit.visitDate))
    : fmtDate(new Date());

  const vitalCards = Object.entries(vitals)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(
      ([key, rawValue]) => `<div class="vital-card">
        <div class="vc-name">${VITAL_DISPLAY_NAMES[key] || key}</div>
        <div class="vc-val">${rawValue}</div>
        <div class="vc-unit">${DEFAULT_VITAL_UNITS[key] || ""}</div>
      </div>`,
    )
    .join("");

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Vital Signs Report", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">Recorded Vital Signs</div>
        <div class="vitals-grid">${vitalCards}</div>
      </div>
    </div>
    <div class="doc-footer">
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
    </div>
  </body>
  </html>`;
};

export const getImmunizationTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  immunization: any,
) => {
  const date = fmtDate(new Date());
  const records = [
    {
      name: "COVID-19 Dose 1",
      data: immunization?.covid19Dose1,
      date: immunization?.covid19Dose1Date,
    },
    {
      name: "COVID-19 Dose 2",
      data: immunization?.covid19Dose2,
      date: immunization?.covid19Dose2Date,
    },
    {
      name: "Tetanus Booster",
      data: immunization?.tetanusBooster,
      date: immunization?.tetanusBoosterDate,
    },
    {
      name: "Flu Vaccine",
      data: immunization?.fluVaccine,
      date: immunization?.fluVaccineDate,
    },
  ];

  const immunizationRows = records
    .filter((r) => r.data || r.date)
    .map((r) => {
      const d = r.data?.date || r.date;
      return `<tr>
      <td style="font-weight:600;">${r.name}</td>
      <td>${d ? fmtDate(d) : "-"}</td>
      <td>${r.data?.manufacturer || "-"}</td>
      <td>${r.data?.lotNumber || "-"}</td>
      <td style="text-align:center;">${r.data?.doseNumber || "-"}</td>
    </tr>`;
    })
    .join("");

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Immunization Record", date)}
    ${patientCard(patient, visit)}
    <div class="content">
      <div class="section">
        <div class="section-title">Vaccination History</div>
        ${
          immunizationRows
            ? `<table>
          <thead>
            <tr>
              <th>Vaccine</th>
              <th>Date</th>
              <th>Manufacturer</th>
              <th>Lot Number</th>
              <th style="text-align:center;">Dose</th>
            </tr>
          </thead>
          <tbody>${immunizationRows}</tbody>
        </table>`
            : `<p style="color:#7F9BAF;font-size:11px;">No immunization records found.</p>`
        }
      </div>
    </div>
    <div class="doc-footer">
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
    </div>
  </body>
  </html>`;
};

/**
 * Structured Lab Report — supports blood/lipid (full table), urine (grouped sections),
 * and other types (glucose, etc.) — premium layout with colour-coded flags.
 */
export const getStructuredLabReportTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  report: {
    testType: string;
    displayName: string;
    sampleId: string;
    reportDate: Date | string;
    analystName: string;
    observations?: string;
    status: string;
    parameters: Array<{
      parameterName: string;
      parameterValue: string;
      unit: string;
      referenceRange: string;
      flag: string;
      section?: string;
    }>;
  },
) => {
  const reportDate = fmtDate(report.reportDate);
  const statusMap: Record<string, string> = {
    final: "badge-final",
    preliminary: "badge-preliminary",
  };
  const statusBadge = `<span class="badge ${statusMap[report.status?.toLowerCase()] || "badge-final"}">${report.status || "Final"}</span>`;

  let bodyHtml = "";

  // ── Blood / Lipid: full parameter table ──────────────────────────────────────
  if (report.testType === "blood" || report.testType === "lipid") {
    const rows = report.parameters
      .filter((p) => p.parameterValue && p.parameterValue.trim() !== "")
      .map(
        (p) => `<tr>
        <td>${p.parameterName}</td>
        <td class="${valClass(p.flag)}">${p.parameterValue}</td>
        <td>${p.unit || "-"}</td>
        <td>${p.referenceRange || "-"}</td>
        <td>${flagBadge(p.flag)}</td>
      </tr>`,
      )
      .join("");

    bodyHtml = `
      <div class="section">
        <div class="section-title">${report.displayName}</div>
        <div class="meta-strip">
          <span><span class="mlabel">Sample ID: </span><span class="mvalue">${report.sampleId}</span></span>
          <span><span class="mlabel">Date: </span><span class="mvalue">${reportDate}</span></span>
          <span><span class="mlabel">Status: </span>${statusBadge}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Reference Range</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Grouped sections for urine ──────────────────────────────────────────────
  else if (report.testType === "urine") {
    const sections = new Map<string, typeof report.parameters>();
    for (const p of report.parameters) {
      const sec = p.section || "General";
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec)!.push(p);
    }

    let sectionHtml = "";
    for (const [sectionName, params] of sections) {
      const rows = params
        .filter((p) => p.parameterValue && p.parameterValue.trim() !== "")
        .map(
          (p) => `<tr>
          <td>${p.parameterName}</td>
          <td class="${valClass(p.flag)}">${p.parameterValue}${p.unit ? ` ${p.unit}` : ""}</td>
          <td>${p.referenceRange || "-"}</td>
          <td>${flagBadge(p.flag)}</td>
        </tr>`,
        )
        .join("");

      if (rows) {
        sectionHtml += `
        <div style="margin-bottom:14px;">
          <div class="sub-heading">${sectionName}</div>
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Result</th>
                <th>Reference Range</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      }
    }

    bodyHtml = `
      <div class="section">
        <div class="section-title">${report.displayName}</div>
        <div class="meta-strip">
          <span><span class="mlabel">Sample ID: </span><span class="mvalue">${report.sampleId}</span></span>
          <span><span class="mlabel">Date: </span><span class="mvalue">${reportDate}</span></span>
          <span><span class="mlabel">Status: </span>${statusBadge}</span>
        </div>
        ${sectionHtml}
      </div>`;
  }

  // ── Other (glucose, etc.) ────────────────────────────────────────────────────
  else {
    const rows = report.parameters
      .filter((p) => p.parameterValue && p.parameterValue.trim() !== "")
      .map(
        (p) => `<tr>
        <td style="font-weight:600;">${p.parameterName}</td>
        <td class="${valClass(p.flag)}">${p.parameterValue}${p.unit ? ` ${p.unit}` : ""}</td>
        <td>${p.referenceRange || "-"}</td>
        <td>${flagBadge(p.flag)}</td>
      </tr>`,
      )
      .join("");

    bodyHtml = `
      <div class="section">
        <div class="section-title">${report.displayName}</div>
        <div class="meta-strip">
          <span><span class="mlabel">Sample ID: </span><span class="mvalue">${report.sampleId}</span></span>
          <span><span class="mlabel">Date: </span><span class="mvalue">${reportDate}</span></span>
          <span><span class="mlabel">Status: </span>${statusBadge}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Reference Range</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Observations ─────────────────────────────────────────────────────────────
  const observationsHtml = report.observations
    ? `<div class="section">
        <div class="section-title">Additional Observations</div>
        <div class="adv-box">${report.observations}</div>
      </div>`
    : "";

  return `<html>
  <head><meta charset="utf-8">${css}</head>
  <body>
    <div class="watermark">CONFIDENTIAL</div>
    ${docHeader("Lab Report", reportDate)}
    ${patientCard(patient, visit)}
    <div class="content">
      ${bodyHtml}
      ${observationsHtml}
    </div>
    <div class="doc-footer">
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">${report.analystName || "Lab In-charge"}</div>
        <div class="sig-role">Analyst / Lab In-charge</div>
      </div>
      <div class="sig-block">
        <div class="sig-space"></div>
        <div class="sig-line"></div>
        <div class="sig-name">Dr. ${visit.doctorName || "Practitioner"}</div>
        <div class="sig-role">Consulting Physician</div>
      </div>
      <div class="doc-stamp">Generated: ${fmtDateTime(new Date())}</div>
    </div>
  </body>
  </html>`;
};
