import { Schema, model, Document, Types } from "mongoose";

export interface ISession extends Document {
  sessionId: string;
  userId: Types.ObjectId;
  email: string;
  role_id: number;
  hospital_id?: Types.ObjectId;
  refreshTokenHash: string;
  previousRefreshTokenHash?: string;
  rotatedAt?: Date;
  userAgent?: string;
  ipAddress?: string;
  isValid: boolean;
  expiresAt: Date;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    role_id: {
      type: Number,
      required: true,
    },
    hospital_id: {
      type: Schema.Types.ObjectId,
      ref: "Hospital",
      required: false,
    },
    refreshTokenHash: {
      type: String,
      required: true,
    },
    previousRefreshTokenHash: {
      type: String,
      required: false,
    },
    rotatedAt: {
      type: Date,
      required: false,
    },
    userAgent: {
      type: String,
      required: false,
      trim: true,
    },
    ipAddress: {
      type: String,
      required: false,
      trim: true,
    },
    isValid: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastActiveAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "sessions",
  },
);

// TTL index to automatically purge expired sessions from MongoDB
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for active user sessions queries & limit enforcement
SessionSchema.index({ userId: 1, isValid: 1, lastActiveAt: -1 });

export const SessionModel = model<ISession>("Session", SessionSchema);
