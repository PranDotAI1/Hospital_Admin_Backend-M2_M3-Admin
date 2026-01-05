export const USER_ENUM = {
    ACTIVE: 1,
    NOT_ACTIVE: 2,
    DELETED: 3,
    ARCHIVED: 4,
    LEAVE: 5
}
export const ADDRESS_TYPE = {
    USER: 1,
    PATIENT: 2
}

export const STATUS_CODE = {
    SUCCESS: 200,
    CREATED: 202,
    ERROR: 500,
    SERVER_STOP: 503,
    UNAUTHORIZED: 401,
    VALIDATION_ERROR: 1100,
    NOT_FOUND: 404
}

export const HEALTH_RISK = {
    NORMAL: 1,
    CRITICAL: 2,
    VERY_CRITICAL: 3
}

export const ROLE = {
    SUPER_ADMIN: 1,
    HOSPITAL_ADMIN: 2,
    DOCTOR: 3,
    STAFF: 4,
    NURSE: 5
}


export const generateUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0; // Generate a random number between 0 and 15
        const v = c === 'x' ? r : (r & 0x3 | 0x8); // Use '4' for version and randomize 'y'
        return v.toString(16); // Convert to hexadecimal
    });
};

export const CLIENT_ID = "SBXID_009407";
export const CLIENT_SECRET = "a924a27d-6305-47c1-b610-07bf5c629350"
export const GRANT_TYPE = "client_credentials"
export const GET_URL = "https://admin.pran.ai";
//export const GET_URL = "https://webhook.site/b301f5f6-6229-4934-8568-4c7dfea7a960";
export const HIP_NAME = "ABC hospital"
export const facilityId = "IN0710001890"
export const facilityName = "ABC hospital"
export const bridgeId = "SBXID_009407"
export const X_HIP_ID = "IN0710001890"

export const HIP_TYPES = [
    "Prescription",
    "DiagnosticReport",
    "OPConsultation",
    "DischargeSummary",
    "ImmunizationRecord",
    "HealthDocumentRecord",
    "WellnessRecord"
];