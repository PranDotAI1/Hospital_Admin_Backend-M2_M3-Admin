import { IPatient } from "../models/Patient";
import { IScanShareVisit } from "../models/ScanShareVisit";
import { facilityName } from "./constant";

const VITAL_DISPLAY_NAMES: Record<string, string> = {
  pulse: "Pulse",
  spo2: "SpO2",
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
  temp: "°C",
  respiration: "bpm",
  painScore: "",
  height: "CM",
  weight: "KG",
  bsa: "m²",
  bmi: "kg/m²",
  category: "",
  bs: "mg/dL",
  creatinine: "mg/dL",
  egfr: "mL/min/1.73m²",
  egfr2: "mL/min/1.73m²",
};

const css = `
<style>
  body { font-family: sans-serif; padding: 20px; color: #333; }
  .header { text-align: center; border-bottom: 2px solid #ddd; padding-bottom: 10px; margin-bottom: 20px; }
  .header h1 { margin: 0; color: #0056b3; }
  .patient-info { background: #f9f9f9; padding: 15px; border-radius: 5px; margin-bottom: 20px; display: flex; flex-wrap: wrap; gap: 20px; }
  .patient-info div { flex: 1; min-width: 200px; }
  .section { margin-bottom: 25px; }
  .section-title { font-size: 1.2em; font-weight: bold; color: #0056b3; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background-color: #f2f2f2; font-weight: bold; }
  .footer { margin-top: 40px; text-align: right; font-style: italic; border-top: 1px solid #ddd; padding-top: 10px; }
  .small-text { font-size: 0.85em; color: #666; }
</style>
`;

const getPatientHeader = (patient: IPatient, visit: IScanShareVisit) => {
  const name =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();
  const gender = patient.gender || "";
  const age = patient.age || "";
  const address = patient.address || "";
  const mobile = patient.mobile || "";
  const date = visit.visitDate
    ? new Date(visit.visitDate).toLocaleDateString("en-IN")
    : new Date().toLocaleDateString("en-IN");

  const abhaAddress = visit.abhaAddress || patient.abhaaddress || "";
  const abhaNumber = visit.abhaNumber || patient.ABHANumber || "";
  const uhid = patient?.uhid || "";
  const consultingDoctor = visit.doctorName || "James";

  // Build info rows conditionally — only show fields that have data
  const rows: string[] = [];
  if (name) rows.push(`<div><strong>Patient Name:</strong> ${name}</div>`);
  if (age || gender)
    rows.push(
      `<div><strong>Age/Gender:</strong> ${age}${age && gender ? " / " : ""}${gender}</div>`,
    );
  if (mobile) rows.push(`<div><strong>Mobile:</strong> ${mobile}</div>`);
  if (address) rows.push(`<div><strong>Address:</strong> ${address}</div>`);
  rows.push(`<div><strong>Visit Date:</strong> ${date}</div>`);
  if (uhid) rows.push(`<div><strong>Patient ID (UHID):</strong> ${uhid}</div>`);
  if (abhaNumber)
    rows.push(`<div><strong>ABHA Number:</strong> ${abhaNumber}</div>`);
  if (abhaAddress)
    rows.push(`<div><strong>ABHA Address:</strong> ${abhaAddress}</div>`);
  if (consultingDoctor)
    rows.push(
      `<div style="flex-basis: 100%;"><strong>Practitioner Name:</strong> Dr. ${consultingDoctor}</div>`,
    );

  return `
    <div class="header">
      <h1>${facilityName || "Hospital Name"}</h1>
      <p>Clinical Report</p>
    </div>
    <div class="patient-info">
      ${rows.join("\n      ")}
    </div>
  `;
};

export const getPrescriptionTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  medications: any[],
  advice?: string,
) => {
  const medRows = medications
    .map((m) => {
      let timingStr = "-";
      if (m.timing) {
        timingStr = `${m.timing.frequency} times / ${m.timing.period} ${m.timing.periodUnit}`;
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

      return `
    <tr>
      <td>${m.medicine || ""} ${m.dosage || ""}</td>
      <td>${timingStr}</td>
      <td>${durStr}</td>
      <td>${m.form || "-"}</td>
      <td>${instStr}</td>
    </tr>
  `;
    })
    .join("");

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}
      
      <div class="section">
        <div class="section-title">Prescription</div>
        <table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Timing</th>
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
        <div class="section-title">Advice / Instructions</div>
        <p>${advice}</p>
      </div>`
          : ""
      }

      <div class="footer">
        <p><strong>Dr. ${visit.doctorName || "Practitioner"}</strong></p>
        <p class="small-text">Practitioner / Authorized Signatory</p>
      </div>
    </body>
    </html>
  `;
};

export const getDiagnosticReportTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  labs: any[],
) => {
  // Extract analyst name from first lab report that has one
  const analystName = labs.find((l) => l.analystName)?.analystName || "";

  const labRows = labs
    .map(
      (l) => `
    <tr>
      <td>${l.testType || "-"}</td>
      <td>${l.resultValue || "-"}</td>
      <td>${l.measurementUnit || "-"}</td>
      <td>${l.reportDate ? new Date(l.reportDate).toLocaleDateString("en-IN") : "-"}</td>
      ${l.sampleId !== undefined ? `<td>${l.sampleId || "-"}</td>` : ""}
     
    </tr>
  `,
    )
    .join("");

  // Check if any lab has sampleId to show the column
  const hasSampleId = labs.some((l) => l.sampleId !== undefined);

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}
      
      <div class="section">
        <div class="section-title">Diagnostic Test Results</div>
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

      <div class="footer">
        <p><strong>Practitioner: Dr. ${visit.doctorName || "-"}</strong></p>
        <p><strong>${analystName ? analystName : "Lab In-charge"}</strong></p>
        <p class="small-text">Analyst / Lab In-charge</p>
        <p class="small-text">Generated on ${new Date().toLocaleString("en-IN")}</p>
      </div>
    </body>
    </html>
  `;
};

export const getDischargeSummaryTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  ds: any,
  assessment?: any,
  labReports?: any[],
) => {
  const medRows =
    ds.dischargeMedications
      ?.map((m: any) => {
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

        return `
    <tr>
      <td>${m.medicine || "-"}</td>
      <td>${m.dosage || "-"}</td>
      <td>${timingStr}</td>
      <td>${durStr}</td>
      <td>${m.form || "-"}</td>
      <td>${instStr}</td>
    </tr>
  `;
      })
      .join("") || "";

  const admissionDetails = [
    ds.admissionDate
      ? `<strong>Admission Date:</strong> ${new Date(ds.admissionDate).toLocaleDateString("en-IN")}`
      : null,
    ds.dischargeDate
      ? `<strong>Discharge Date:</strong> ${new Date(ds.dischargeDate).toLocaleDateString("en-IN")}`
      : null,
    ds.ward ? `<strong>Ward:</strong> ${ds.ward}` : null,
    ds.bed ? `<strong>Bed:</strong> ${ds.bed}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}
      
      <div class="section">
        <div class="section-title">Discharge Summary</div>
        
        ${admissionDetails ? `<p>${admissionDetails}</p>` : ""}
        ${ds.admissionNotes ? `<p><strong>Admission Notes:</strong> ${ds.admissionNotes}</p>` : ""}
        ${ds.diagnosis ? `<p><strong>Diagnosis:</strong> ${ds.diagnosis}</p>` : ""}
        ${ds.conditionAtDischarge ? `<p><strong>Condition at Discharge:</strong> ${ds.conditionAtDischarge}</p>` : ""}
        ${ds.clinicalSummary ? `<p><strong>Clinical Summary:</strong> ${ds.clinicalSummary}</p>` : ""}
        ${ds.investigationsResults ? `<p><strong>Investigation Results:</strong> ${ds.investigationsResults}</p>` : ""}
        ${ds.treatmentGiven ? `<p><strong>Treatment Given:</strong> ${ds.treatmentGiven}</p>` : ""}
        ${ds.surgicalProcedures ? `<p><strong>Surgical Procedures:</strong> ${ds.surgicalProcedures}</p>` : ""}
        ${ds.surgicalNote ? `<p><strong>Surgical Note:</strong> ${ds.surgicalNote}</p>` : ""}
        ${ds.followUpInstructions ? `<p><strong>Follow-up Instructions:</strong> ${ds.followUpInstructions}</p>` : ""}
        ${ds.advice ? `<p><strong>Advice:</strong> ${ds.advice}</p>` : ""}
      </div>

      ${
        assessment?.medicalHistory && assessment.medicalHistory.length > 0
          ? `
      <div class="section">
        <div class="section-title">Past Medical History</div>
        <table>
          <thead>
            <tr>
              <th>Disease</th>
              <th>Duration</th>
              <th>Medications</th>
            </tr>
          </thead>
          <tbody>${assessment.medicalHistory
            .map(
              (h: any) =>
                `<tr><td>${h.disease || "-"}</td><td>${h.duration || "-"}</td><td>${h.medications || "-"}</td></tr>`,
            )
            .join("")}</tbody>
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
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Unit</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>${labReports
            .map(
              (lab: any) =>
                `<tr><td>${lab.testType || "-"}</td><td>${lab.resultValue || "-"}</td><td>${lab.measurementUnit || "-"}</td><td>${lab.reportDate ? new Date(lab.reportDate).toLocaleDateString("en-IN") : "-"}</td></tr>`,
            )
            .join("")}</tbody>
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
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Dosage</th>
              <th>Timing</th>
              <th>Duration</th>
              <th>Form</th>
              <th>Instructions</th>
            </tr>
          </thead>
          <tbody>${medRows}</tbody>
        </table>
      </div>`
          : ""
      }

      <div class="footer">
        <p><strong>Practitioner: ${ds.doctorSignature ? ds.doctorSignature : `Dr. ${visit.doctorName || "Practitioner"}`}</strong></p>
      </div>
    </body>
    </html>
  `;
};

export const getOPConsultationTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  soap: any,
  vitals: any,
) => {
  let vitalsHtml = "";
  if (vitals && Object.keys(vitals).length > 0) {
    vitalsHtml = `
      <div class="section">
        <div class="section-title">Vital Signs</div>
        <div style="display: flex; flex-wrap: wrap; gap: 15px;">
          ${Object.entries(vitals)
            .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
            .join("")}
        </div>
      </div>
    `;
  }

  let soapHtml = "";
  if (soap) {
    soapHtml = `
      <div class="section">
        <div class="section-title">Clinical Notes</div>
        ${soap.subjective ? `<p><strong>Subjective:</strong> ${soap.subjective}</p>` : ""}
        ${soap.objective ? `<p><strong>Objective:</strong> ${soap.objective}</p>` : ""}
        ${soap.assessment ? `<p><strong>Assessment:</strong> ${soap.assessment}</p>` : ""}
        ${soap.plan ? `<p><strong>Plan:</strong> ${soap.plan}</p>` : ""}
      </div>
    `;
  }

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}
      
      <div class="section">
        <div class="section-title">Consultation Details</div>
        <p><strong>Chief Complaint:</strong> ${visit.complaint || "Routine Checkup"}</p>
        <p><strong>Department:</strong> ${visit.department || "OPD"}</p>
      </div>

      ${vitalsHtml}
      ${soapHtml}

      <div class="footer">
        <p><strong>Practitioner: Dr. ${visit.doctorName || "Practitioner"}</strong></p>
      </div>
    </body>
    </html>
  `;
};

export const getInvoiceTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  billing: any,
) => {
  const billingRows =
    billing.billings
      ?.map(
        (b: any) => `
    <tr>
      <td>${b.particulars || "-"}</td>
      <td>${b.rate || "-"}</td>
      <td>${b.unit || "-"}</td>
      <td>${b.amount || "-"}</td>
    </tr>
  `,
      )
      .join("") || "";

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}
      
      <div class="section">
        <div class="section-title">Invoice</div>
        <p><strong>Invoice No:</strong> ${billing._id}</p>
        <p><strong>Date:</strong> ${new Date(billing.date).toLocaleDateString("en-IN")}</p>
        <p><strong>Status:</strong> ${billing.status}</p>
        
        <table>
          <thead>
            <tr>
              <th>Particulars</th>
              <th>Rate</th>
              <th>Unit</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>${billingRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="text-align: right;"><strong>Total Amount:</strong></td>
              <td><strong>${billing.totalAmount}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="footer">
        <p><strong>Accountant/Cashier</strong></p>
        <p class="small-text">Generated on ${new Date().toLocaleString("en-IN")}</p>
      </div>
    </body>
    </html>
  `;
};

export const getVitalsTemplate = (
  patient: IPatient,
  visit: IScanShareVisit,
  vitals: Record<string, string | number | undefined>,
) => {
  const vitalRows = Object.entries(vitals)
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([key, rawValue]) => {
      const display = VITAL_DISPLAY_NAMES[key] || key;
      const unit = DEFAULT_VITAL_UNITS[key] || "";
      return `
    <tr>
      <td>${display}</td>
      <td>${rawValue}</td>
      <td>${unit}</td>
    </tr>`;
    })
    .join("");

  return `
    <html>
    <head>${css}</head>
    <body>
      ${getPatientHeader(patient, visit)}

      <div class="section">
        <div class="section-title">Vital Signs</div>
        <table>
          <thead>
            <tr>
              <th>Vital</th>
              <th>Value</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>${vitalRows}</tbody>
        </table>
      </div>

      <div class="footer">
        <p><strong>Practitioner: Dr. ${visit.doctorName || "Practitioner"}</strong></p>
        <p class="small-text">Generated on ${new Date().toLocaleString("en-IN")}</p>
      </div>
    </body>
    </html>
  `;
};
