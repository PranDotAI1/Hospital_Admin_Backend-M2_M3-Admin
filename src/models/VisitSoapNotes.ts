import { Schema, model, Document, Types } from "mongoose";

export interface IVisitSoapNotes extends Document {
  visitId: Types.ObjectId;
  patientId: Types.ObjectId;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const VisitSoapNotesSchema = new Schema<IVisitSoapNotes>(
  {
    visitId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    patientId: { type: Schema.Types.ObjectId, required: true, index: true },
    subjective: { type: String, trim: true },
    objective: { type: String, trim: true },
    assessment: { type: String, trim: true },
    plan: { type: String, trim: true },
  },
  { timestamps: true },
);

export const VisitSoapNotesModel = model<IVisitSoapNotes>(
  "VisitSoapNotes",
  VisitSoapNotesSchema,
  "visit_soap_notes",
);
