export enum AbdmErrorCode {
  ABDM_1000 = "ABDM-1000", // No matching records found
  ABDM_1001 = "ABDM-1001", // Invalid request
  ABDM_1002 = "ABDM-1002", // Invalid transaction ID
  ABDM_1003 = "ABDM-1003", // Invalid/expired OTP
  ABDM_1004 = "ABDM-1004", // Consent not found
  ABDM_1005 = "ABDM-1005", // Consent expired
  ABDM_1006 = "ABDM-1006", // Consent revoked
  ABDM_1007 = "ABDM-1007", // Consent denied
  ABDM_1008 = "ABDM-1008", // Gateway timeout
  ABDM_1009 = "ABDM-1009", // Internal server error
  ABDM_1010 = "ABDM-1010", // Invalid signature
  ABDM_1011 = "ABDM-1011", // Invalid public key
  ABDM_1012 = "ABDM-1012", // Invalid nonce
  ABDM_1013 = "ABDM-1013", // Invalid date range
  ABDM_1014 = "ABDM-1014", // Invalid care context
  ABDM_1015 = "ABDM-1015", // Duplicate request
  ABDM_1016 = "ABDM-1016", // Consent already granted
  ABDM_1017 = "ABDM-1017", // Invalid transaction ID (gateway not ready)
  ABDM_1018 = "ABDM-1018", // Rate limit exceeded
  ABDM_1019 = "ABDM-1019", // Unauthorized
  ABDM_1020 = "ABDM-1020", // Forbidden

  // Internal Error Codes
  INTERNAL_ERROR = "INTERNAL_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  REDIS_ERROR = "REDIS_ERROR",
  ENCRYPTION_ERROR = "ENCRYPTION_ERROR",
  DECRYPTION_ERROR = "DECRYPTION_ERROR",
  TOKEN_ERROR = "TOKEN_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  GHOST_ARTEFACT = "GHOST_ARTEFACT",
  UNLINKED_ARTEFACT = "UNLINKED_ARTEFACT",
  CONSENT_NOT_GRANTED = "CONSENT_NOT_GRANTED",
  CONSENT_EXPIRED = "CONSENT_EXPIRED",
  CONSENT_REVOKED = "CONSENT_REVOKED",
  CONSENT_DENIED = "CONSENT_DENIED",
  INVALID_DATA_PUSH_URL = "INVALID_DATA_PUSH_URL",
  PUPPETEER_ERROR = "PUPPETEER_ERROR",
  FHIR_GENERATION_ERROR = "FHIR_GENERATION_ERROR",
  CARE_CONTEXT_NOT_ALLOWED = "CARE_CONTEXT_NOT_ALLOWED",
}

export enum ErrorCategory {
  TRANSIENT = "transient", // Retryable - temporary failure
  PERMANENT = "permanent", // Non-retryable - won't fix on retry
  AUTH = "auth", // Authentication/authorization issue
  VALIDATION = "validation", // Input validation issue
  CONFIG = "config", // Configuration issue
}

export interface AbdmErrorInfo {
  code: AbdmErrorCode;
  category: ErrorCategory;
  message: string;
  notifyAbdm: boolean; // Whether to send failure notification to ABDM
  httpStatus?: number;
}

const ERROR_REGISTRY: Record<AbdmErrorCode, AbdmErrorInfo> = {
  [AbdmErrorCode.ABDM_1000]: { code: AbdmErrorCode.ABDM_1000, category: ErrorCategory.PERMANENT, message: "No matching records found", notifyAbdm: false, httpStatus: 404 },
  [AbdmErrorCode.ABDM_1001]: { code: AbdmErrorCode.ABDM_1001, category: ErrorCategory.VALIDATION, message: "Invalid request", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1002]: { code: AbdmErrorCode.ABDM_1002, category: ErrorCategory.TRANSIENT, message: "Invalid transaction ID", notifyAbdm: true, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1003]: { code: AbdmErrorCode.ABDM_1003, category: ErrorCategory.AUTH, message: "Invalid or expired OTP", notifyAbdm: false, httpStatus: 401 },
  [AbdmErrorCode.ABDM_1004]: { code: AbdmErrorCode.ABDM_1004, category: ErrorCategory.PERMANENT, message: "Consent not found", notifyAbdm: true, httpStatus: 404 },
  [AbdmErrorCode.ABDM_1005]: { code: AbdmErrorCode.ABDM_1005, category: ErrorCategory.PERMANENT, message: "Consent expired", notifyAbdm: true, httpStatus: 410 },
  [AbdmErrorCode.ABDM_1006]: { code: AbdmErrorCode.ABDM_1006, category: ErrorCategory.PERMANENT, message: "Consent revoked", notifyAbdm: true, httpStatus: 410 },
  [AbdmErrorCode.ABDM_1007]: { code: AbdmErrorCode.ABDM_1007, category: ErrorCategory.PERMANENT, message: "Consent denied", notifyAbdm: true, httpStatus: 403 },
  [AbdmErrorCode.ABDM_1008]: { code: AbdmErrorCode.ABDM_1008, category: ErrorCategory.TRANSIENT, message: "Gateway timeout", notifyAbdm: false, httpStatus: 504 },
  [AbdmErrorCode.ABDM_1009]: { code: AbdmErrorCode.ABDM_1009, category: ErrorCategory.TRANSIENT, message: "Internal server error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.ABDM_1010]: { code: AbdmErrorCode.ABDM_1010, category: ErrorCategory.PERMANENT, message: "Invalid signature", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1011]: { code: AbdmErrorCode.ABDM_1011, category: ErrorCategory.PERMANENT, message: "Invalid public key", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1012]: { code: AbdmErrorCode.ABDM_1012, category: ErrorCategory.PERMANENT, message: "Invalid nonce", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1013]: { code: AbdmErrorCode.ABDM_1013, category: ErrorCategory.VALIDATION, message: "Invalid date range", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1014]: { code: AbdmErrorCode.ABDM_1014, category: ErrorCategory.PERMANENT, message: "Invalid care context", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1015]: { code: AbdmErrorCode.ABDM_1015, category: ErrorCategory.PERMANENT, message: "Duplicate request", notifyAbdm: false, httpStatus: 409 },
  [AbdmErrorCode.ABDM_1016]: { code: AbdmErrorCode.ABDM_1016, category: ErrorCategory.PERMANENT, message: "Consent already granted", notifyAbdm: false, httpStatus: 409 },
  [AbdmErrorCode.ABDM_1017]: { code: AbdmErrorCode.ABDM_1017, category: ErrorCategory.TRANSIENT, message: "Invalid transaction ID (gateway not ready)", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.ABDM_1018]: { code: AbdmErrorCode.ABDM_1018, category: ErrorCategory.TRANSIENT, message: "Rate limit exceeded", notifyAbdm: false, httpStatus: 429 },
  [AbdmErrorCode.ABDM_1019]: { code: AbdmErrorCode.ABDM_1019, category: ErrorCategory.AUTH, message: "Unauthorized", notifyAbdm: false, httpStatus: 401 },
  [AbdmErrorCode.ABDM_1020]: { code: AbdmErrorCode.ABDM_1020, category: ErrorCategory.AUTH, message: "Forbidden", notifyAbdm: false, httpStatus: 403 },

  [AbdmErrorCode.INTERNAL_ERROR]: { code: AbdmErrorCode.INTERNAL_ERROR, category: ErrorCategory.TRANSIENT, message: "Internal server error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.VALIDATION_ERROR]: { code: AbdmErrorCode.VALIDATION_ERROR, category: ErrorCategory.VALIDATION, message: "Validation error", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.DATABASE_ERROR]: { code: AbdmErrorCode.DATABASE_ERROR, category: ErrorCategory.TRANSIENT, message: "Database error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.REDIS_ERROR]: { code: AbdmErrorCode.REDIS_ERROR, category: ErrorCategory.TRANSIENT, message: "Redis error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.ENCRYPTION_ERROR]: { code: AbdmErrorCode.ENCRYPTION_ERROR, category: ErrorCategory.PERMANENT, message: "Encryption error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.DECRYPTION_ERROR]: { code: AbdmErrorCode.DECRYPTION_ERROR, category: ErrorCategory.PERMANENT, message: "Decryption error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.TOKEN_ERROR]: { code: AbdmErrorCode.TOKEN_ERROR, category: ErrorCategory.AUTH, message: "Token error", notifyAbdm: false, httpStatus: 401 },
  [AbdmErrorCode.NETWORK_ERROR]: { code: AbdmErrorCode.NETWORK_ERROR, category: ErrorCategory.TRANSIENT, message: "Network error", notifyAbdm: false, httpStatus: 502 },
  [AbdmErrorCode.TIMEOUT_ERROR]: { code: AbdmErrorCode.TIMEOUT_ERROR, category: ErrorCategory.TRANSIENT, message: "Timeout error", notifyAbdm: false, httpStatus: 504 },
  [AbdmErrorCode.NOT_FOUND]: { code: AbdmErrorCode.NOT_FOUND, category: ErrorCategory.PERMANENT, message: "Resource not found", notifyAbdm: false, httpStatus: 404 },
  [AbdmErrorCode.ALREADY_EXISTS]: { code: AbdmErrorCode.ALREADY_EXISTS, category: ErrorCategory.PERMANENT, message: "Resource already exists", notifyAbdm: false, httpStatus: 409 },
  [AbdmErrorCode.GHOST_ARTEFACT]: { code: AbdmErrorCode.GHOST_ARTEFACT, category: ErrorCategory.PERMANENT, message: "Ghost artefact (self-referencing)", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.UNLINKED_ARTEFACT]: { code: AbdmErrorCode.UNLINKED_ARTEFACT, category: ErrorCategory.PERMANENT, message: "Unlinked artefact (no consentRequestId)", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.CONSENT_NOT_GRANTED]: { code: AbdmErrorCode.CONSENT_NOT_GRANTED, category: ErrorCategory.PERMANENT, message: "Consent not granted", notifyAbdm: true, httpStatus: 403 },
  [AbdmErrorCode.CONSENT_EXPIRED]: { code: AbdmErrorCode.CONSENT_EXPIRED, category: ErrorCategory.PERMANENT, message: "Consent expired", notifyAbdm: true, httpStatus: 410 },
  [AbdmErrorCode.CONSENT_REVOKED]: { code: AbdmErrorCode.CONSENT_REVOKED, category: ErrorCategory.PERMANENT, message: "Consent revoked", notifyAbdm: true, httpStatus: 410 },
  [AbdmErrorCode.CONSENT_DENIED]: { code: AbdmErrorCode.CONSENT_DENIED, category: ErrorCategory.PERMANENT, message: "Consent denied", notifyAbdm: true, httpStatus: 403 },
  [AbdmErrorCode.INVALID_DATA_PUSH_URL]: { code: AbdmErrorCode.INVALID_DATA_PUSH_URL, category: ErrorCategory.VALIDATION, message: "Invalid data push URL (SSRF protection)", notifyAbdm: false, httpStatus: 400 },
  [AbdmErrorCode.PUPPETEER_ERROR]: { code: AbdmErrorCode.PUPPETEER_ERROR, category: ErrorCategory.TRANSIENT, message: "Puppeteer error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.FHIR_GENERATION_ERROR]: { code: AbdmErrorCode.FHIR_GENERATION_ERROR, category: ErrorCategory.PERMANENT, message: "FHIR bundle generation error", notifyAbdm: false, httpStatus: 500 },
  [AbdmErrorCode.CARE_CONTEXT_NOT_ALLOWED]: { code: AbdmErrorCode.CARE_CONTEXT_NOT_ALLOWED, category: ErrorCategory.PERMANENT, message: "Care context not allowed for this consent", notifyAbdm: false, httpStatus: 403 },
};

export class AbdmError extends Error {
  public readonly code: AbdmErrorCode;
  public readonly category: ErrorCategory;
  public readonly notifyAbdm: boolean;
  public readonly httpStatus: number;
  public readonly originalError?: Error;

  constructor(code: AbdmErrorCode, message?: string, originalError?: Error) {
    const info = ERROR_REGISTRY[code] || ERROR_REGISTRY[AbdmErrorCode.INTERNAL_ERROR];
    super(message || info.message);
    this.name = "AbdmError";
    this.code = code;
    this.category = info.category;
    this.notifyAbdm = info.notifyAbdm;
    this.httpStatus = info.httpStatus ?? 500;
    this.originalError = originalError;
  }

  static fromAbdmCode(abdmCode: string, message?: string): AbdmError {
    const code = AbdmErrorCode[abdmCode as keyof typeof AbdmErrorCode] || AbdmErrorCode.INTERNAL_ERROR;
    return new AbdmError(code, message);
  }

  static fromError(err: Error): AbdmError {
    if (err instanceof AbdmError) return err;
    return new AbdmError(AbdmErrorCode.INTERNAL_ERROR, err.message, err);
  }

  isTransient(): boolean {
    return this.category === ErrorCategory.TRANSIENT;
  }

  isPermanent(): boolean {
    return this.category === ErrorCategory.PERMANENT;
  }

  shouldNotifyAbdm(): boolean {
    return this.notifyAbdm;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      notifyAbdm: this.notifyAbdm,
      httpStatus: this.httpStatus,
      originalError: this.originalError?.message,
    };
  }
}

export const getErrorInfo = (code: AbdmErrorCode): AbdmErrorInfo => {
  return ERROR_REGISTRY[code] || ERROR_REGISTRY[AbdmErrorCode.INTERNAL_ERROR];
};

export const isTransientError = (code: AbdmErrorCode): boolean => {
  return getErrorInfo(code).category === ErrorCategory.TRANSIENT;
};

export const shouldNotifyAbdm = (code: AbdmErrorCode): boolean => {
  return getErrorInfo(code).notifyAbdm;
};