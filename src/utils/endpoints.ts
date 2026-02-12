export const ENDPOINTS = {
  // ============================================
  // Gateway / Session
  // ============================================
  // ============================================
  // Gateway / Session
  // ============================================
  GET_ABHA_SESSION: "/hiecm/gateway/v3/sessions",
  GET_ABHA_BRIDGE_URL: "/hiecm/gateway/v3/bridge-services",
  SET_BRIDGE_URL: "/hiecm/gateway/v3/bridge/url",
  MULTIPLE_HRP: "/MutipleHRPAddUpdateServices",

  // ============================================
  // HIP-Initiated Linking (M2 Phase 1-3)
  // ============================================
  GENERATE_LINK_TOKEN: "/hiecm/v3/token/generate-token",
  LINK_CARECONTEXT: "/hiecm/hip/v3/link/carecontext",
  CONTEXT_NOTIFY: "/hiecm/hip/v3/link/context/notify",

  // ============================================
  // Discovery & User-Initiated Linking (M2)
  // ============================================
  ON_DISCOVER:
    "/hiecm/user-initiated-linking/v3/patient/care-context/on-discover",
  ON_LINK_INIT: "/hiecm/user-initiated-linking/v3/link/care-context/on-init",
  ON_LINK_CONFIRM:
    "/hiecm/user-initiated-linking/v3/link/care-context/on-confirm",

  // ============================================
  // SMS Notification (M2)
  // ============================================
  SMS_NOTIFY: "/hiecm/v0.5/patients/sms/notify",

  // ============================================
  // Consent (M2/M3)
  // ============================================
  REQ_INIT: "/hiecm/consent/v3/request/init",
  ON_INIT: "/api/v3/hiu/consent/request/on-init",
  GET_REQ_STATUS: "/hiecm/consent/v3/request/status",
  ON_NOTIFY: "/hiecm/consent/v3/request/hiu/on-notify",
  CONSENT_FETCH: "/hiecm/consent/v3/fetch",
  CONSENT_HIP_ON_NOTIFY: "/hiecm/consent/v3/request/hip/on-notify",

  // ============================================
  // Data Flow (M2)
  // ============================================
  CALLING_DATA_PUSH_URL_V3: "/hiecm/data-flow/v3/health-information/request",
  HEALTH_INFO_HIP_ON_REQUEST:
    "/hiecm/data-flow/v3/health-information/hip/on-request",
  HEALTH_INFO_NOTIFY: "/hiecm/data-flow/v3/health-information/notify",

  // ============================================
  // Patient Share
  // ============================================
  HIP_PATIENT_SHARE_ON_SHARE: "/hiecm/patient-share/v3/on-share",
  HIP_RUNNING_TOKEN_ON_STATUS:
    "/hiecm/patient-share/v3/running-token/on-status",

  // ============================================
  // M4 Endpoints (HPR)
  // ============================================
  M4_SESSION_API_URL: "/gateway/v0.5/sessions",
  M4_GENERATE_OTP_VIA_AADHAR: "/v1/registration/aadhaar/generateOtp",
  M4_VEFIRY_OTP: "/v1/registration/aadhaar/verifyOTP",
  M4_CHECK_HPID_EXISTANCE: "/v2/registration/aadhaar/checkHpIdAccountExist",
  M4_VERFIY_MOBILE_NUMBER: "/v1/registration/aadhaar/demographicAuthViaMobile",
  M4_GET_SUGGESTION_USERNAME_FROM_HPRID:
    "/v1/registration/aadhaar/hpid/suggestion",
  M4_CREATE_PRE_VERFIED_HPRID:
    "/v1/registration/aadhaar/createHprIdWithPreVerified",
};
