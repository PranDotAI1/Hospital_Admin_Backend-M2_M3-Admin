import { Document, Schema, model, Types } from "mongoose";

export enum SessionStatus {
  ACTIVE = "ACTIVE",
  REVOKED = "REVOKED",
  EXPIRED = "EXPIRED",
}

export enum DeviceType {
  DESKTOP = "DESKTOP",
  MOBILE = "MOBILE",
  TABLET = "TABLET",
  UNKNOWN = "UNKNOWN",
}

export enum SignInMethod {
  PASSWORD = "PASSWORD",
  OTP = "OTP",
  GOOGLE = "GOOGLE",
  REFRESH_TOKEN = "REFRESH_TOKEN",
}

export interface ISession extends Document {
  userId: Types.ObjectId;
  tokenHash: string;
  refreshToken?: string;

  status: SessionStatus;
  revokedAt?: Date;
  revokedReason?: string;

  deviceType: DeviceType;
  deviceName?: string;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  userAgent?: string;

  ipAddress?: string;
  city?: string;
  region?: string;
  country?: string;
  countryName?: string;
  timezone?: string;
  isp?: string;

  isTrusted: boolean;
  isSuspicious: boolean;
  suspiciousFlags: string[];

  lastActivityAt: Date;
  lastActivityIp?: string;
  activityCount: number;
  signInMethod: SignInMethod;

  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    refreshToken: {
      type: String,
      unique: true,
      sparse: true,
    },

    status: {
      type: String,
      enum: Object.values(SessionStatus),
      default: SessionStatus.ACTIVE,
      index: true,
    },
    revokedAt: { type: Date },
    revokedReason: { type: String },

    deviceType: {
      type: String,
      enum: Object.values(DeviceType),
      default: DeviceType.UNKNOWN,
    },
    deviceName: { type: String },
    browser: { type: String },
    browserVersion: { type: String },
    os: { type: String },
    osVersion: { type: String },
    userAgent: { type: String },

    ipAddress: { type: String },
    city: { type: String },
    region: { type: String },
    country: { type: String },
    countryName: { type: String },
    timezone: { type: String },
    isp: { type: String },

    isTrusted: { type: Boolean, default: false },
    isSuspicious: { type: Boolean, default: false },
    suspiciousFlags: { type: [String], default: [] },

    lastActivityAt: { type: Date, default: Date.now, index: true },
    lastActivityIp: { type: String },
    activityCount: { type: Number, default: 1 },
    signInMethod: {
      type: String,
      enum: Object.values(SignInMethod),
      default: SignInMethod.PASSWORD,
    },

    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: "sessions",
  },
);

SessionSchema.index({ userId: 1, status: 1 });
SessionSchema.index({ createdAt: 1 });

SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel = model<ISession>("Session", SessionSchema);
