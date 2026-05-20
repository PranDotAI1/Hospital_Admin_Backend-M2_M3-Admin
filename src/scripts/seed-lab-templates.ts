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
  /** ABDM FHIR DiagnosticReport.code — LOINC panel code */
  loincCode: string;
  loincDisplay: string;
  /** ABDM FHIR DiagnosticReport.category — HL7 v2-0074 code */
  categoryCode: string;
  categoryDisplay: string;
}

/**
 * Per-parameter LOINC codes for ABDM FHIR Observation.code
 * Keyed by testType → parameterName (exact match, case-sensitive).
 * "RBC" / "WBC" are intentionally duplicated with different codes
 * because they represent different analytes in blood vs. urine.
 */
const PARAM_LOINC: Record<
  string,
  Record<string, { loincCode: string; loincDisplay: string }>
> = {
  blood: {
    "Hemoglobin (Hb)": {
      loincCode: "718-7",
      loincDisplay: "Hemoglobin [Mass/volume] in Blood",
    },
    RBC: {
      loincCode: "789-8",
      loincDisplay: "Erythrocytes [#/volume] in Blood by Automated count",
    },
    WBC: {
      loincCode: "6690-2",
      loincDisplay: "Leukocytes [#/volume] in Blood by Automated count",
    },
    Platelets: {
      loincCode: "777-3",
      loincDisplay: "Platelets [#/volume] in Blood by Automated count",
    },
    "Hematocrit (HCT)": {
      loincCode: "4544-3",
      loincDisplay: "Hematocrit [Volume Fraction] of Blood by Automated count",
    },
    MCV: {
      loincCode: "787-2",
      loincDisplay: "MCV [Entitic volume] by Automated count",
    },
    MCH: {
      loincCode: "785-6",
      loincDisplay: "MCH [Entitic mass] by Automated count",
    },
    MCHC: {
      loincCode: "786-4",
      loincDisplay: "MCHC [Mass/volume] by Automated count",
    },
    ESR: {
      loincCode: "30341-2",
      loincDisplay: "Erythrocyte sedimentation rate",
    },
    Neutrophils: {
      loincCode: "770-8",
      loincDisplay: "Neutrophils/100 leukocytes in Blood by Automated count",
    },
    Lymphocytes: {
      loincCode: "736-9",
      loincDisplay: "Lymphocytes/100 leukocytes in Blood by Automated count",
    },
    Monocytes: {
      loincCode: "5905-5",
      loincDisplay: "Monocytes/100 leukocytes in Blood by Automated count",
    },
    Eosinophils: {
      loincCode: "713-8",
      loincDisplay: "Eosinophils/100 leukocytes in Blood by Automated count",
    },
    Basophils: {
      loincCode: "706-2",
      loincDisplay: "Basophils/100 leukocytes in Blood by Automated count",
    },
  },
  urine: {
    Color: { loincCode: "5778-6", loincDisplay: "Color of Urine" },
    Appearance: { loincCode: "5767-9", loincDisplay: "Appearance of Urine" },
    "Specific Gravity": {
      loincCode: "5811-5",
      loincDisplay: "Specific gravity of Urine",
    },
    pH: { loincCode: "5764-6", loincDisplay: "pH of Urine" },
    Protein: {
      loincCode: "5804-0",
      loincDisplay: "Protein [Presence] in Urine by Test strip",
    },
    Glucose: {
      loincCode: "25428-4",
      loincDisplay: "Glucose [Presence] in Urine by Test strip",
    },
    Ketones: {
      loincCode: "2514-8",
      loincDisplay: "Ketones [Mass/volume] in Urine by Test strip",
    },
    Blood: {
      loincCode: "5794-3",
      loincDisplay: "Hemoglobin [Presence] in Urine by Test strip",
    },
    Bilirubin: {
      loincCode: "5770-3",
      loincDisplay: "Bilirubin.total [Mass/volume] in Urine by Test strip",
    },
    Urobilinogen: {
      loincCode: "5818-0",
      loincDisplay: "Urobilinogen [Units/volume] in Urine by Test strip",
    },
    Nitrite: {
      loincCode: "5802-4",
      loincDisplay: "Nitrite [Presence] in Urine by Test strip",
    },
    "Leukocyte Esterase": {
      loincCode: "5799-2",
      loincDisplay: "Leukocyte esterase [Presence] in Urine by Test strip",
    },
    RBC: {
      loincCode: "13945-1",
      loincDisplay:
        "Erythrocytes [#/area] in Urine sediment by Microscopy high power field",
    },
    WBC: {
      loincCode: "5821-4",
      loincDisplay:
        "Leukocytes [#/area] in Urine sediment by Microscopy high power field",
    },
    "Epithelial Cells": {
      loincCode: "11277-1",
      loincDisplay:
        "Epithelial cells.squamous [#/area] in Urine sediment by Microscopy high power field",
    },
    Casts: {
      loincCode: "24124-9",
      loincDisplay: "Casts [Presence] in Urine sediment by Light microscopy",
    },
    Crystals: {
      loincCode: "49756-4",
      loincDisplay:
        "Crystals [#/area] in Urine sediment by Microscopy high power field",
    },
    Bacteria: {
      loincCode: "25145-4",
      loincDisplay: "Bacteria [Presence] in Urine sediment by Light microscopy",
    },
    "Yeast Cells": {
      loincCode: "50558-9",
      loincDisplay: "Yeast [Presence] in Urine by Gram stain",
    },
  },
  glucose: {
    "Fasting Blood Sugar": {
      loincCode: "1558-6",
      loincDisplay:
        "Fasting glucose [Mass/volume] in Capillary blood by Glucometer",
    },
    "Postprandial Blood Sugar (PP)": {
      loincCode: "1518-0",
      loincDisplay:
        "Glucose [Mass/volume] in Serum or Plasma --2 hours post meal",
    },
    "Random Blood Sugar": {
      loincCode: "2339-6",
      loincDisplay: "Glucose [Mass/volume] in Blood",
    },
    HbA1c: {
      loincCode: "4548-4",
      loincDisplay: "Hemoglobin A1c/Hemoglobin.total in Blood",
    },
  },
  lipid: {
    "Total Cholesterol": {
      loincCode: "2093-3",
      loincDisplay: "Cholesterol [Mass/volume] in Serum or Plasma",
    },
    Triglycerides: {
      loincCode: "2571-8",
      loincDisplay: "Triglycerides [Mass/volume] in Serum or Plasma",
    },
    "HDL Cholesterol": {
      loincCode: "2085-9",
      loincDisplay: "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
    },
    "LDL Cholesterol": {
      loincCode: "18262-6",
      loincDisplay:
        "Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay",
    },
    VLDL: {
      loincCode: "13458-5",
      loincDisplay: "Cholesterol in VLDL [Mass/volume] in Serum or Plasma",
    },
    "Non-HDL Cholesterol": {
      loincCode: "43396-1",
      loincDisplay: "Cholesterol non HDL [Mass/volume] in Serum or Plasma",
    },
    "Cholesterol / HDL Ratio": {
      loincCode: "9830-1",
      loincDisplay:
        "Cholesterol.total/Cholesterol in HDL [Mass Ratio] in Serum or Plasma",
    },
  },
};

const templates: TemplateDefinition[] = [
  // ─── Blood Test ───────────────────────────────────────────────────────────────
  // LOINC 58410-2  = CBC panel - Blood by Automated count
  // Category HM    = Hematology (HL7 v2-0074)
  {
    testType: "blood",
    displayName: "Blood Test",
    uiType: "table",
    loincCode: "58410-2",
    loincDisplay: "CBC panel - Blood by Automated count",
    categoryCode: "HM",
    categoryDisplay: "Hematology",
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
  // LOINC 24357-6  = Urinalysis macro (dipstick) panel - Urine
  // Category UA    = Urinalysis (HL7 v2-0074)
  {
    testType: "urine",
    displayName: "Urine Test",
    uiType: "grouped_form",
    loincCode: "24357-6",
    loincDisplay: "Urinalysis macro (dipstick) panel - Urine",
    categoryCode: "UA",
    categoryDisplay: "Urinalysis",
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
  // LOINC 2339-6   = Glucose [Mass/volume] in Blood
  // Category CH    = Chemistry (HL7 v2-0074)
  {
    testType: "glucose",
    displayName: "Glucose Test",
    uiType: "simple_form",
    loincCode: "2339-6",
    loincDisplay: "Glucose [Mass/volume] in Blood",
    categoryCode: "CH",
    categoryDisplay: "Chemistry",
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
  // LOINC 57698-3  = Lipid panel with direct LDL - Serum or Plasma
  // Category CH    = Chemistry (HL7 v2-0074)
  {
    testType: "lipid",
    displayName: "Lipid Profile",
    uiType: "table",
    loincCode: "57698-3",
    loincDisplay: "Lipid panel with direct LDL - Serum or Plasma",
    categoryCode: "CH",
    categoryDisplay: "Chemistry",
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
      // Augment each parameter with its individual LOINC code from the lookup map
      const augmentedParameters = tpl.parameters.map((p) => {
        const loinc = PARAM_LOINC[tpl.testType]?.[p.name];
        return loinc ? { ...p, ...loinc } : p;
      });

      await LabTestTemplateModel.findOneAndUpdate(
        { testType: tpl.testType },
        {
          $set: {
            displayName: tpl.displayName,
            uiType: tpl.uiType,
            parameters: augmentedParameters,
            loincCode: tpl.loincCode,
            loincDisplay: tpl.loincDisplay,
            categoryCode: tpl.categoryCode,
            categoryDisplay: tpl.categoryDisplay,
          },
        },
        { upsert: true, new: true },
      );
      console.log(
        `  ✓ ${tpl.displayName} (${tpl.testType}) — ${augmentedParameters.length} parameters`,
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
