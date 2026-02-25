import { Schema, model } from "mongoose";

export interface IUHIDCounter {
  _id: string;
  seq: number;
}

const UHIDCounterSchema = new Schema<IUHIDCounter>(
  {
    _id: { type: String, required: true }, 
    seq: { type: Number, default: 0 },
  },
  {
    collection: "uhid_counters",
    versionKey: false,
  },
);

export const UHIDCounterModel = model<IUHIDCounter>(
  "UHIDCounter",
  UHIDCounterSchema,
);
