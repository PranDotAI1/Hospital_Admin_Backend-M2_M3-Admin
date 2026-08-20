import mongoose from "mongoose";
import dotenv from "dotenv";
import { PatientModel } from "../models/Patient";
import { VisitAssessmentModel } from "../models/VisitAssessment";
import { VisitDischargeSummaryModel } from "../models/VisitDischargeSummary";
import { VisitDayCareBilling } from "../models/VisitDayCareBilling";
import { IncidentReportModel } from "../models/IncidentReport";
import { ResourceUtilizationModel } from "../models/ResourceUtilization";
import { PatientFeedbackModel } from "../models/PatientFeedback";

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || "mongodb://localhost:27017/pran_admin";

const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomChoice = <T>(arr: T[]): T => arr[randomInt(0, arr.length - 1)];

async function seedData() {
  console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
  await mongoose.connect(MONGODB_URI);
  console.log("Connected.");

  const now = new Date();
  
  // 1. Fetch Existing Patients
  const patients = await PatientModel.find({});
  if (patients.length === 0) {
    console.error("No patients found in DB! Cannot seed dependent data without existing patients.");
    process.exit(1);
  }
  
  console.log(`Found ${patients.length} existing patients. Simulating visit data...`);

  let totalVisitsSeeded = 0;
  const allVisits: { visitId: string, patientId: string }[] = [];

  for (const patient of patients) {
    let visits = patient.visits || [];
    let updated = false;

    // Ensure the patient has at least a few visits over the last 6 months
    if (visits.length === 0) {
      const numVisits = randomInt(1, 4);
      for (let i = 0; i < numVisits; i++) {
        const visitDate = new Date(now.getTime() - randomInt(0, 180) * 86400000);
        visits.push({
          visitId: new mongoose.Types.ObjectId(),
          visitDate,
          visitStatus: randomChoice(["REGISTERED", "COMPLETED", "COMPLETED"]),
          consultationFee: randomChoice([500, 800, 1200, 1500]),
          visitType: randomChoice(["OPD", "OPD", "IPD"]),
          department: randomChoice(["Cardiology", "Neurology", "General Medicine", "Orthopedics"]),
        } as any);
      }
      updated = true;
    }

    // Append operational metrics to ALL visits
    for (const v of visits) {
      if (Math.random() < 0.05) {
        v.visitDate = new Date();
        v.visitStatus = randomChoice(["REGISTERED", "PENDING"]);
      }

      const vType = Math.random() > 0.5 ? "INPATIENT" : "OUTPATIENT";
      v.visitType = vType;
      v.consultationStartedAt = new Date(new Date(v.visitDate).getTime() + randomInt(10, 60) * 60000);
      
      // End time depends on visit type
      if (v.visitType === "INPATIENT") {
        v.consultationEndedAt = new Date(new Date(v.consultationStartedAt).getTime() + randomInt(1, 14) * 86400000);
      } else {
        v.consultationEndedAt = new Date(new Date(v.consultationStartedAt).getTime() + randomInt(15, 120) * 60000);
      }
      
      v.treatmentOutcome = randomChoice(["SUCCESS", "SUCCESS", "SUCCESS", "ONGOING", "FAILED"]);
      v.consultationFee = randomChoice([500, 800, 1200, 1500]);
      updated = true;
      
      if (v.visitId) allVisits.push({ visitId: v.visitId.toString(), patientId: patient._id.toString() });
    }

    if (!patient.insurance || patient.insurance.length === 0) {
      if (Math.random() < 0.6) {
        patient.insurance = [{
          provider: randomChoice(["Star Health", "HDFC ERGO", "ICICI Lombard", "Niva Bupa"]),
          policyNumber: "POL-" + randomInt(10000, 99999),
          addedOn: new Date(now.getTime() - randomInt(100, 300) * 86400000),
        }];
        updated = true;
      }
    }

    if (updated) {
      patient.visits = visits;
      await patient.save();
      totalVisitsSeeded += visits.length;
    }
  }

  console.log(`Ensured operational metrics on ${totalVisitsSeeded} total visits across ${patients.length} patients.`);

  // 2. Generate Visit Assessments (Complications)
  console.log("Generating VisitAssessments...");
  const assessments = [];
  // Give 20% of visits an assessment, and 40% of those have complications
  const assessedVisits = Array.from(new Set(allVisits.map(v => v.visitId)))
    .map(vid => allVisits.find(v => v.visitId === vid)!)
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(allVisits.length * 0.2));
  for (const vInfo of assessedVisits) {
    const vid = new mongoose.Types.ObjectId(vInfo.visitId);
    const hasComplication = Math.random() < 0.4;
    assessments.push({
      patientId: new mongoose.Types.ObjectId(vInfo.patientId),
      visitId: vid,
      isReadmission: Math.random() < 0.1, // 10% readmission rate
      complications: hasComplication ? [randomChoice(["Infection", "Hemorrhage", "Fever", "Nausea", "Arrhythmia"])] : [],
      primaryDiagnosis: { name: "Simulated Diagnosis", code: "SIM-01" },
      createdAt: new Date(now.getTime() - randomInt(0, 180) * 86400000), // Random time
    });
  }
  if (assessments.length > 0) {
    const ops = assessments.map(doc => ({
      updateOne: { filter: { visitId: doc.visitId }, update: { $setOnInsert: doc as any }, upsert: true }
    }));
    await VisitAssessmentModel.bulkWrite(ops);
  }

  // 3. Generate Discharge Summaries (Survival Rates)
  console.log("Generating DischargeSummaries...");
  const discharges = [];
  const dischargedVisits = Array.from(new Set(allVisits.map(v => v.visitId)))
    .map(vid => allVisits.find(v => v.visitId === vid)!)
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(allVisits.length * 0.15));
  for (const vInfo of dischargedVisits) {
    const vid = new mongoose.Types.ObjectId(vInfo.visitId);
    const isDeceased = Math.random() < 0.05; // 5% mortality
    discharges.push({
      patientId: new mongoose.Types.ObjectId(vInfo.patientId),
      visitId: vid,
      diagnosis: randomChoice(["Cardiovascular", "Respiratory", "Neurological", "Infectious"]),
      conditionAtDischarge: isDeceased ? "Critical" : randomChoice(["Stable", "Improved", "Recovered"]),
      dischargeDate: new Date(now.getTime() - randomInt(0, 180) * 86400000),
      createdAt: new Date(now.getTime() - randomInt(0, 180) * 86400000),
    });
  }
  if (discharges.length > 0) {
    const ops = discharges.map(doc => ({
      updateOne: { filter: { visitId: doc.visitId }, update: { $setOnInsert: doc as any }, upsert: true }
    }));
    await VisitDischargeSummaryModel.bulkWrite(ops);
  }

  // 4. Generate Incident Reports (Infections & Patient Safety)
  console.log("Generating IncidentReports...");
  const incidents = [];
  const incidentTypes = [
    "CUTS_AND_PUNCTURES", "MULTIPLE_TRAUMA", "FRACTURES", "BRUISES", "SORENESS_PAIN", "SPRAINS_AND_STRAINS",
    "SURGICAL_SITE_INFECTION", "VAP", "BLOODSTREAM_INFECTION", "COMPLAINT", "MEDICATION_ERROR"
  ];
  for (let i = 0; i < 40; i++) {
    incidents.push({
      type: randomChoice(incidentTypes),
      severity: randomChoice(["CRITICAL", "MAJOR", "MINOR"]),
      reportedAt: new Date(now.getTime() - randomInt(0, 180) * 86400000),
      description: "Simulated incident",
      reportedBy: new mongoose.Types.ObjectId(), // dummy
      hospitalId: patients[0]?.hospitalId || new mongoose.Types.ObjectId(),
      status: "OPEN",
    });
  }
  const incidentOps = incidents.map(doc => ({
    updateOne: { filter: { type: doc.type, reportedAt: doc.reportedAt } as any, update: { $setOnInsert: doc as any }, upsert: true }
  }));
  await IncidentReportModel.bulkWrite(incidentOps);

  // 5. Generate Daycare Billing (Revenue)
  console.log("Generating DayCareBillings...");
  const billings = [];
  const billedVisits = Array.from(new Set(allVisits.map(v => v.visitId)))
    .map(vid => allVisits.find(v => v.visitId === vid)!)
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(allVisits.length * 0.3));
  for (const vInfo of billedVisits) {
    const vid = new mongoose.Types.ObjectId(vInfo.visitId);
    billings.push({
      visitId: vid,
      uhid: "DUMMY-" + randomInt(1000, 9999),
      patient: new mongoose.Types.ObjectId(vInfo.patientId),
      date: new Date(now.getTime() - randomInt(0, 60) * 86400000),
      totalGross: randomChoice([5000, 12000, 25000, 40000]),
      status: "Finalized",
    });
  }
  if (billings.length > 0) {
    const ops = billings.map(doc => ({
      updateOne: { filter: { visitId: doc.visitId }, update: { $setOnInsert: doc as any }, upsert: true }
    }));
    await VisitDayCareBilling.bulkWrite(ops);
  }

  // 6. Generate Resource Utilization
  console.log("Generating ResourceUtilization snapshots...");
  const resources = [];
  for (let day = 0; day <= 14; day++) {
    const snapshotDate = new Date(now.getTime() - day * 86400000);
    // Matches Figma exactly
    const types = [
      { t: "DEPARTMENT", items: ["Pediatrics", "Surgery", "Emergency Department (ED)", "Intensive Care Unit (ICU)", "Pharmacy", "Maternity (Obstetrics and Gynecology)", "Radiology/Imaging", "Pathology", "Cardiology", "Rehabilitation"] },
      { t: "EQUIPMENT", items: ["Diagnostic", "Medical"] },
      { t: "FACILITY", items: ["Clinic Capacity"] },
    ];
    for (const group of types) {
      for (const itemName of group.items) {
        resources.push({
          resourceType: group.t,
          resourceId: itemName,
          resourceName: itemName,
          capacity: 10,
          activeCount: randomInt(2, 9),
          utilizationRate: randomInt(20, 90),
          status: "ACTIVE",
          recordedDate: snapshotDate,
          hospitalId: patients[0]?.hospitalId || new mongoose.Types.ObjectId(),
          dataSource: "AUTO",
        });
      }
    }
  }
  if (resources.length > 0) {
    const ops = resources.map(doc => ({
      updateOne: { 
        filter: { resourceType: doc.resourceType, resourceId: doc.resourceId, recordedDate: doc.recordedDate, hospitalId: doc.hospitalId } as any, 
        update: { $setOnInsert: doc as any }, 
        upsert: true 
      }
    }));
    await ResourceUtilizationModel.bulkWrite(ops);
  }

  // 7. Generate Patient Feedback
  console.log("Generating PatientFeedback...");
  const feedbacks = [];
  const feedbackVisits = Array.from(new Set(allVisits.map(v => v.visitId)))
    .map(vid => allVisits.find(v => v.visitId === vid)!)
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(allVisits.length * 0.4)); // 40% response rate
  for (const vInfo of feedbackVisits) {
    const vid = new mongoose.Types.ObjectId(vInfo.visitId);
    feedbacks.push({
      visitId: vid,
      patientId: new mongoose.Types.ObjectId(vInfo.patientId),
      hospitalId: patients[0]?.hospitalId || new mongoose.Types.ObjectId(),
      score: randomInt(3, 5), // Mostly positive
      npsScore: randomInt(7, 10),
      submittedBy: "PATIENT",
      submittedAt: new Date(now.getTime() - randomInt(0, 180) * 86400000),
      createdAt: new Date(now.getTime() - randomInt(0, 180) * 86400000),
    });
  }
  if (feedbacks.length > 0) {
    const ops = feedbacks.map(doc => ({
      updateOne: { filter: { visitId: doc.visitId }, update: { $setOnInsert: doc as any }, upsert: true }
    }));
    await PatientFeedbackModel.bulkWrite(ops);
  }

  console.log("Data seeding complete!");
  process.exit(0);
}

seedData().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
