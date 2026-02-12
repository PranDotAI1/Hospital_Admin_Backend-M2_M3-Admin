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
  ACCEPTED: 202,
  CREATED: 201,
  ERROR: 500,
  SERVER_STOP: 503,
  UNAUTHORIZED: 401,
  VALIDATION_ERROR: 1100,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
};

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
};

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
] as const;

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

export { ENDPOINTS } from "./endpoints";
