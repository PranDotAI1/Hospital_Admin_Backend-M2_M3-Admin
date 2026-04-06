/**
 * Seed script for lab test templates.
 *
 * Usage:
 *   npx ts-node src/scripts/seed-lab-templates.ts
 *
 * Idempotent — uses upsert so re-running updates existing templates.
 */
import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../config/db";
import {
  LabTestTemplateModel,
  ILabTestParameter,
} from "../models/LabTestTemplate";

interface TemplateDefinition {
  testType: string;
  displayName: string;
  uiType: "table" | "grouped_form" | "simple_form";
  parameters: ILabTestParameter[];
}

const templates: TemplateDefinition[] = [
  // ─── Blood Test ───────────────────────────────────────────────────────────────
  {
    testType: "blood",
    displayName: "Blood Test",
    uiType: "table",
    parameters: [
      {
        name: "Hemoglobin (Hb)",
        unit: "g/dL",
        referenceRange: "13-17",
        inputType: "number",
      },
      {
        name: "RBC",
        unit: "million/uL",
        referenceRange: "4.5-5.5",
        inputType: "number",
      },
      {
        name: "WBC",
        unit: "/uL",
        referenceRange: "4000-11000",
        inputType: "number",
      },
      {
        name: "Platelets",
        unit: "/uL",
        referenceRange: "150000-400000",
        inputType: "number",
      },
      {
        name: "Hematocrit (HCT)",
        unit: "%",
        referenceRange: "38-50",
        inputType: "number",
      },
      {
        name: "MCV",
        unit: "fL",
        referenceRange: "80-100",
        inputType: "number",
      },
      {
        name: "MCH",
        unit: "pg",
        referenceRange: "27-33",
        inputType: "number",
      },
      {
        name: "MCHC",
        unit: "g/dL",
        referenceRange: "32-36",
        inputType: "number",
      },
      {
        name: "ESR",
        unit: "mm/hr",
        referenceRange: "0-20",
        inputType: "number",
      },
      {
        name: "Neutrophils",
        unit: "%",
        referenceRange: "40-70",
        inputType: "number",
      },
      {
        name: "Lymphocytes",
        unit: "%",
        referenceRange: "20-40",
        inputType: "number",
      },
      {
        name: "Monocytes",
        unit: "%",
        referenceRange: "2-8",
        inputType: "number",
      },
      {
        name: "Eosinophils",
        unit: "%",
        referenceRange: "1-4",
        inputType: "number",
      },
      {
        name: "Basophils",
        unit: "%",
        referenceRange: "0-1",
        inputType: "number",
      },
    ],
  },

  // ─── Urine Test ───────────────────────────────────────────────────────────────
  {
    testType: "urine",
    displayName: "Urine Test",
    uiType: "grouped_form",
    parameters: [
      // Physical Examination
      {
        name: "Color",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: [
          "Pale Yellow",
          "Yellow",
          "Dark Yellow",
          "Amber",
          "Red",
          "Brown",
          "Clear",
        ],
        section: "Physical Examination",
      },
      {
        name: "Appearance",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Clear", "Slightly Turbid", "Turbid", "Cloudy"],
        section: "Physical Examination",
      },
      {
        name: "Specific Gravity",
        unit: "",
        referenceRange: "1.005-1.030",
        inputType: "number",
        section: "Physical Examination",
      },
      {
        name: "pH",
        unit: "",
        referenceRange: "4.5-8.0",
        inputType: "number",
        section: "Physical Examination",
      },

      // Chemical Examination
      {
        name: "Protein",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Trace", "1+", "2+", "3+", "4+"],
        section: "Chemical Examination",
      },
      {
        name: "Glucose",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Trace", "1+", "2+", "3+", "4+"],
        section: "Chemical Examination",
      },
      {
        name: "Ketones",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Trace", "1+", "2+", "3+"],
        section: "Chemical Examination",
      },
      {
        name: "Blood",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Trace", "1+", "2+", "3+"],
        section: "Chemical Examination",
      },
      {
        name: "Bilirubin",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Negative", "1+", "2+", "3+"],
        section: "Chemical Examination",
      },
      {
        name: "Urobilinogen",
        unit: "mg/dL",
        referenceRange: "0.2-1.0",
        inputType: "number",
        section: "Chemical Examination",
      },
      {
        name: "Nitrite",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Negative", "Positive"],
        section: "Chemical Examination",
      },
      {
        name: "Leukocyte Esterase",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Negative", "Trace", "1+", "2+", "3+"],
        section: "Chemical Examination",
      },

      // Microscopic Examination
      {
        name: "RBC",
        unit: "/hpf",
        referenceRange: "0-2",
        inputType: "number",
        section: "Microscopic Examination",
      },
      {
        name: "WBC",
        unit: "/hpf",
        referenceRange: "0-5",
        inputType: "number",
        section: "Microscopic Examination",
      },
      {
        name: "Epithelial Cells",
        unit: "/hpf",
        referenceRange: "0-5",
        inputType: "text",
        section: "Microscopic Examination",
      },
      {
        name: "Casts",
        unit: "/lpf",
        referenceRange: "",
        inputType: "text",
        section: "Microscopic Examination",
      },
      {
        name: "Crystals",
        unit: "",
        referenceRange: "",
        inputType: "text",
        section: "Microscopic Examination",
      },
      {
        name: "Bacteria",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Few", "Moderate", "Many"],
        section: "Microscopic Examination",
      },
      {
        name: "Yeast Cells",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["Nil", "Few", "Moderate", "Many"],
        section: "Microscopic Examination",
      },
    ],
  },

  // ─── Glucose Test ─────────────────────────────────────────────────────────────
  {
    testType: "glucose",
    displayName: "Glucose Test",
    uiType: "simple_form",
    parameters: [
      {
        name: "Fasting Blood Sugar",
        unit: "mg/dL",
        referenceRange: "70-100",
        inputType: "number",
      },
      {
        name: "Postprandial Blood Sugar (PP)",
        unit: "mg/dL",
        referenceRange: "70-140",
        inputType: "number",
      },
      {
        name: "Random Blood Sugar",
        unit: "mg/dL",
        referenceRange: "70-140",
        inputType: "number",
      },
      {
        name: "HbA1c",
        unit: "%",
        referenceRange: "4.0-5.6",
        inputType: "number",
      },
      {
        name: "Test Method",
        unit: "",
        referenceRange: "",
        inputType: "select",
        options: ["GOD-POD", "Hexokinase", "Glucose Oxidase", "Other"],
      },
      {
        name: "Test Time",
        unit: "",
        referenceRange: "",
        inputType: "text",
      },
    ],
  },

  // ─── Lipid Profile ────────────────────────────────────────────────────────────
  {
    testType: "lipid",
    displayName: "Lipid Profile",
    uiType: "table",
    parameters: [
      {
        name: "Total Cholesterol",
        unit: "mg/dL",
        referenceRange: "0-200",
        inputType: "number",
      },
      {
        name: "Triglycerides",
        unit: "mg/dL",
        referenceRange: "0-150",
        inputType: "number",
      },
      {
        name: "HDL Cholesterol",
        unit: "mg/dL",
        referenceRange: "40-60",
        inputType: "number",
      },
      {
        name: "LDL Cholesterol",
        unit: "mg/dL",
        referenceRange: "0-100",
        inputType: "number",
      },
      {
        name: "VLDL",
        unit: "mg/dL",
        referenceRange: "5-40",
        inputType: "number",
      },
      {
        name: "Non-HDL Cholesterol",
        unit: "mg/dL",
        referenceRange: "0-130",
        inputType: "number",
      },
      {
        name: "Cholesterol / HDL Ratio",
        unit: "",
        referenceRange: "0-5",
        inputType: "number",
      },
    ],
  },
];

const seed = async () => {
  try {
    await connectDB();
    console.log("Connected to database. Seeding lab test templates...\n");

    for (const tpl of templates) {
      await LabTestTemplateModel.findOneAndUpdate(
        { testType: tpl.testType },
        {
          $set: {
            displayName: tpl.displayName,
            uiType: tpl.uiType,
            parameters: tpl.parameters,
          },
        },
        { upsert: true, new: true },
      );
      console.log(
        `  ✓ ${tpl.displayName} (${tpl.testType}) — ${tpl.parameters.length} parameters`,
      );
    }

    console.log("\nSeeding complete. All 4 templates inserted/updated.");
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
};

seed();
