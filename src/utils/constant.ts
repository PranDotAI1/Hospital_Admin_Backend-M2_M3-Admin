export const USER_ENUM = {
  ACTIVE: 1,
  NOT_ACTIVE: 2,
  DELETED: 3,
  ARCHIVED: 4,
  LEAVE: 5,
};
export const ADDRESS_TYPE = {
  USER: 1,
  PATIENT: 2,
};

export const STATUS_CODE = {
  SUCCESS: 200,
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,

  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NOT_ALLOWED: 405,
  CONFLICT: 409,

  ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVER_STOP: 503,

  VALIDATION_ERROR: 1100,
} as const

export const HEALTH_RISK = {
  NORMAL: 1,
  CRITICAL: 2,
  VERY_CRITICAL: 3,
};

export const ROLE = {
  SUPER_ADMIN: 1,
  HOSPITAL_ADMIN: 2,
  DOCTOR: 3,
  STAFF: 4,
  NURSE: 5,
  RECEPTIONIST: 6,
  ACCOUNTANT: 7,
  IT_SUPPORT: 8,
  SECURITY: 9,
};

export const DOCTOR_STATUS = {
  ACTIVE: "ACTIVE",
  ON_LEAVE: "ON_LEAVE",
  RETIRED: "RETIRED",
  INACTIVE: "INACTIVE",
} as const;

export const DOCTOR_CURRENT_STATUS = {
  AVAILABLE: "AVAILABLE",
  CONSULTING: "CONSULTING",
  ON_BREAK: "ON_BREAK",
  LEAVE: "LEAVE",
  OFF_DUTY: "OFF_DUTY",
  NOT_AVAILABLE: "NOT_AVAILABLE",
} as const;

export const ATTENDANCE_STATUS = {
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  HALF_DAY: "HALF_DAY",
  LEAVE: "LEAVE",
  OFF: "OFF",
} as const;

export const LEAVE_TYPE = {
  ANNUAL: "ANNUAL",
  SICK: "SICK",
  OTHER: "OTHER",
} as const;

export const LEAVE_REQUEST_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;

export const DOCTOR_INVITE_EXPIRY_MINUTES = 7 * 24 * 60;

export const SET_PASSWORD_RATE_LIMIT = {
  MAX_ATTEMPTS: 5,
  WINDOW_MINUTES: 15,
} as const;

// Default available slots for doctors (Mon-Fri, 9 AM - 5 PM)
export const DEFAULT_AVAILABLE_SLOTS = [
  { day: "Monday", startTime: "09:00", endTime: "17:00" },
  { day: "Tuesday", startTime: "09:00", endTime: "17:00" },
  { day: "Wednesday", startTime: "09:00", endTime: "17:00" },
  { day: "Thursday", startTime: "09:00", endTime: "17:00" },
  { day: "Friday", startTime: "09:00", endTime: "17:00" },
] as const;

export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const generateUID = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0; // Generate a random number between 0 and 15
    const v = c === "x" ? r : (r & 0x3) | 0x8; // Use '4' for version and randomize 'y'
    return v.toString(16); // Convert to hexadecimal
  });
};

// ABDM Credentials - loaded from environment variables
export const CLIENT_ID = process.env.ABDM_CLIENT_ID || "";
export const CLIENT_SECRET = process.env.ABDM_CLIENT_SECRET || "";
export const GRANT_TYPE = process.env.ABDM_GRANT_TYPE || "client_credentials";

// Callback URL - the public URL of this server
export const GET_URL = process.env.ABDM_CALLBACK_URL || "";

// HIP Configuration
export const HIP_NAME = process.env.ABDM_HIP_NAME || "ABC hospital";
export const facilityId = process.env.ABDM_FACILITY_ID || "";
export const facilityName = process.env.ABDM_FACILITY_NAME || "ABC hospital";
export const bridgeId = process.env.ABDM_BRIDGE_ID || "";
export const X_HIP_ID = process.env.ABDM_X_HIP_ID || "";
export const X_HIU_ID =
  process.env.ABDM_X_HIU_ID || process.env.ABDM_X_HIP_ID || ""; // HIU may have separate ID
export const X_CM_ID = process.env.ABDM_X_CM_ID || "sbx";

export const clientParams = {
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  grantType: GRANT_TYPE,
};

/** Must match CareContext HI_TYPES (ABDM 7 clinical artifact types). Used for consent/APIs. */
export const HIP_TYPES = [
  "Prescription",
  "DiagnosticReport",
  "OPConsultation",
  "DischargeSummary",
  "ImmunizationRecord",
  "HealthDocumentRecord",
  "WellnessRecord",
];

export const REDIS_LOGS = {
  DISCONNECTED: "Redis disconnected successfully",
};

export const REDIS_EVENTS = {
  ERROR: "error",
  CONNECT: "connect",
  READY: "ready",
  RECONNECTING: "reconnecting",
  END: "end",
};

export const PROCESS_EVENTS = {
  SIGINT: "SIGINT",
  SIGTERM: "SIGTERM",
};

export const ABDM_PHR_WEB_BASE_URL =
  process.env.ABDM_PHR_WEB_BASE_URL || "https://phrsbx.abdm.gov.in";

export const baseHeaders = (hip: boolean = false) => ({
  "Content-Type": "application/json",
  "REQUEST-ID": generateUID(),
  TIMESTAMP: new Date().toISOString(),
  "X-CM-ID": X_CM_ID,
  ...(hip && { "X-HIP-ID": X_HIP_ID }),
});

/** Maximum number of link attempts before marking as permanently FAILED */
export const MAX_LINK_ATTEMPTS = 3;

/** Link token validity in months (ABDM says 6, we use 5 for safety) */
export const LINK_TOKEN_VALIDITY_MONTHS = 5;

/** Cooldown between link token requests per patient (ABDM can block for 24h if hit too often) */
export const LINK_TOKEN_REQUEST_COOLDOWN_HOURS = 24;

/** Whether to update patient name from ABDM discovery flow data (set true to enable) */
export const DISCOVERY_UPDATE_PATIENT_NAME = true;

export const SEPARATE_CARECONTEXT_PER_HITYPE: boolean =
  process.env.SEPARATE_CARECONTEXT_PER_HITYPE !== "false";

export { ENDPOINTS } from "./endpoints";
