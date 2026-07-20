import { Schema, model, Document, Types } from "mongoose";

export type ResourceType = "DEPARTMENT" | "EQUIPMENT" | "FACILITY";

export interface IResourceUtilization extends Document {
  resourceType:    ResourceType;
  resourceId:      string;
  resourceName:    string;
  utilizationRate: number;
  capacity?:       number;
  activeCount?:    number;
  recordedDate:    Date;
  hospitalId:      Types.ObjectId;
  dataSource:      "AUTO" | "MANUAL";
  createdAt?:      Date;
  updatedAt?:      Date;
}

const ResourceUtilizationSchema = new Schema<IResourceUtilization>(
  {
    resourceType: {
      type: String,
      enum: ["DEPARTMENT", "EQUIPMENT", "FACILITY"],
      required: true,
    },
    resourceId: {
      type: String,
      required: true,
      trim: true,
    },
    resourceName: {
      type: String,
      required: true,
      trim: true,
    },
    utilizationRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    capacity: {
      type: Number,
      min: 0,
    },
    activeCount: {
      type: Number,
      min: 0,
    },
    recordedDate: {
      type: Date,
      required: true,
    },
    hospitalId: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    dataSource: {
      type: String,
      enum: ["AUTO", "MANUAL"],
      default: "MANUAL",
    },
  },
  {
    timestamps: true,
    collection: "resource_utilizations",
  }
);

ResourceUtilizationSchema.index(
  { resourceType: 1, resourceId: 1, recordedDate: 1 },
  { unique: true }
);

ResourceUtilizationSchema.index({ hospitalId: 1, resourceType: 1, recordedDate: -1 });

ResourceUtilizationSchema.index({ recordedDate: -1 });

export const ResourceUtilizationModel = model<IResourceUtilization>(
  "ResourceUtilization",
  ResourceUtilizationSchema
);
