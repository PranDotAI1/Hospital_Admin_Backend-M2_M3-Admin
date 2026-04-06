import { Schema, model, Document } from "mongoose";

export interface ILabTestParameter {
  name: string;
  unit: string;
  referenceRange: string;
  inputType: "number" | "text" | "select";
  options?: string[];
  section?: string;
}

export interface ILabTestTemplate extends Document {
  testType: string;
  displayName: string;
  uiType: "table" | "grouped_form" | "simple_form";
  parameters: ILabTestParameter[];
  createdAt?: Date;
  updatedAt?: Date;
}

const LabTestParameterSchema = new Schema<ILabTestParameter>(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: "", trim: true },
    referenceRange: { type: String, default: "", trim: true },
    inputType: {
      type: String,
      enum: ["number", "text", "select"],
      default: "number",
    },
    options: { type: [String], default: undefined },
    section: { type: String, trim: true },
  },
  { _id: false },
);

const LabTestTemplateSchema = new Schema<ILabTestTemplate>(
  {
    testType: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: { type: String, required: true, trim: true },
    uiType: {
      type: String,
      enum: ["table", "grouped_form", "simple_form"],
      required: true,
    },
    parameters: { type: [LabTestParameterSchema], required: true },
  },
  { timestamps: true },
);

export const LabTestTemplateModel = model<ILabTestTemplate>(
  "LabTestTemplate",
  LabTestTemplateSchema,
  "lab_test_templates",
);
