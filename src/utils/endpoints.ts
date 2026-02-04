export const ENDPOINTS = {
    GET_ABHA_SESSION: '/hiecm/gateway/v3/sessions',
    GET_ABHA_BRIDGE_URL: '/hiecm/gateway/v3/bridge-services',
    SET_BRIDGE_URL: '/hiecm/gateway/v3/bridge/url',
    MULTIPLE_HRP: '/MutipleHRPAddUpdateServices',
    REQ_INIT: "/hiecm/consent/v3/request/init",
    ON_INIT: "/api/v3/hiu/consent/request/on-init",
    GET_REQ_STATUS: "/hiecm/consent/v3/request/status",
    ON_NOTIFY: "/hiecm/consent/v3/request/hiu/on-notify",
    CONSENT_FETCH: "/hiecm/consent/v3/fetch",
    CALLING_DATA_PUSH_URL_V3: "/hiecm/data-flow/v3/health-information/request",
    HIP_PATIENT_SHARE_ON_SHARE: "/hiecm/patient-share/v3/on-share",
    HIP_RUNNING_TOKEN_ON_STATUS: "/hiecm/patient-share/v3/running-token/on-status",


    /// m4 endpoints
    M4_SESSION_API_URL: '/gateway/v0.5/sessions',
    M4_GENERATE_OTP_VIA_AADHAR: '/v1/registration/aadhaar/generateOtp',
    M4_VEFIRY_OTP: "/v1/registration/aadhaar/verifyOTP",
    M4_CHECK_HPID_EXISTANCE: "/v2/registration/aadhaar/checkHpIdAccountExist",
    M4_VERFIY_MOBILE_NUMBER: "/v1/registration/aadhaar/demographicAuthViaMobile",
    M4_GET_SUGGESTION_USERNAME_FROM_HPRID: "/v1/registration/aadhaar/hpid/suggestion",
    M4_CREATE_PRE_VERFIED_HPRID: "/v1/registration/aadhaar/createHprIdWithPreVerified"
}