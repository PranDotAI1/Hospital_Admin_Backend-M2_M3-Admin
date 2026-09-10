/**
 * ─── PERMISSIONS & ROLE-PERMISSION MAPPING ───
 *
 * Single source of truth for all granular permissions and the default
 * permission set for each role.  Uses a `module:action` naming convention
 * so permissions are easy to grep, audit, and extend.
 *
 * Phase 1 roles: SUPER_ADMIN(1), HOSPITAL_ADMIN(2), DOCTOR(3), STAFF(4),
 *                NURSE(5), LAB_TECHNICIAN(6), BILLING(8), RECEPTIONIST(9),
 *                DEPARTMENT_HEAD(10)
 *
 * Phase 2 (deferred): PHARMACIST(7), AUDITOR(11)
 */

// ─── PERMISSION KEYS ─────────────────────────────────────────────────────────

export const PERMISSIONS = {
  // ── User Management ──
  USERS_CREATE: "users:create",
  USERS_READ: "users:read",
  USERS_UPDATE: "users:update",
  USERS_DELETE: "users:delete",
  USERS_ASSIGN_ROLE: "users:assign_role",

  // ── Hospital & Department ──
  HOSPITAL_MANAGE: "hospital:manage",
  DEPARTMENT_MANAGE: "department:manage",
  DEPARTMENT_READ: "department:read",
  DEPARTMENT_MANAGE_STAFF: "department:manage_staff",

  // ── Patient Management ──
  PATIENTS_REGISTER: "patients:register",
  PATIENTS_READ: "patients:read",
  PATIENTS_UPDATE: "patients:update",
  PATIENTS_SEARCH: "patients:search",
  PATIENTS_LINK_ABHA: "patients:link_abha",
  PATIENTS_VIEW_HISTORY: "patients:view_history",

  // ── OPD / Queue Management ──
  OPD_ADD_VISIT: "opd:add_visit",
  OPD_VIEW_QUEUE: "opd:view_queue",
  OPD_NEXT_PATIENT: "opd:next_patient",
  OPD_CANCEL_VISIT: "opd:cancel_visit",
  OPD_STATS: "opd:stats",
  OPD_UPDATE_SERVING: "opd:update_serving",

  // ── Clinical Records ──
  CLINICAL_PRESCRIPTION_WRITE: "clinical:prescription:write",
  CLINICAL_PRESCRIPTION_READ: "clinical:prescription:read",
  CLINICAL_SOAP_WRITE: "clinical:soap:write",
  CLINICAL_SOAP_READ: "clinical:soap:read",
  CLINICAL_DISCHARGE_WRITE: "clinical:discharge:write",
  CLINICAL_DISCHARGE_READ: "clinical:discharge:read",
  CLINICAL_ASSESSMENT_WRITE: "clinical:assessment:write",
  CLINICAL_ASSESSMENT_READ: "clinical:assessment:read",
  CLINICAL_IMMUNIZATION_WRITE: "clinical:immunization:write",

  // ── Lab Reports ──
  LAB_ORDER: "lab:order",
  LAB_ENTER_RESULTS: "lab:enter_results",
  LAB_FINALIZE: "lab:finalize",
  LAB_READ: "lab:read",
  LAB_VIEW_TEMPLATES: "lab:view_templates",

  // ── Billing ──
  BILLING_CREATE: "billing:create",
  BILLING_READ: "billing:read",
  BILLING_PROCESS_PAYMENT: "billing:process_payment",
  BILLING_REPORTS: "billing:reports",

  // ── Pharmacy ──
  PHARMACY_VIEW_ORDERS: "pharmacy:view_orders",
  PHARMACY_DISPENSE: "pharmacy:dispense",

  // ── ABDM / Consent / CareContext ──
  ABDM_LINK_CARECONTEXT: "abdm:link_carecontext",
  ABDM_CONSENT_INITIATE: "abdm:consent:initiate",
  ABDM_CONSENT_READ: "abdm:consent:read",
  ABDM_HIU_FETCH: "abdm:hiu:fetch",

  // ── System / Platform ──
  SYSTEM_CONFIG: "system:config",
  SYSTEM_AUDIT_LOGS: "system:audit_logs",
  SYSTEM_SESSIONS: "system:sessions",
  SMS_SEND: "sms:send",

  // ── Terminology (SNOMED / LOINC lookups) ──
  TERMINOLOGY_SEARCH: "terminology:search",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Flat list of all permission strings — useful for validation */
export const ALL_PERMISSIONS: string[] = Object.values(PERMISSIONS);

// ─── DATA SCOPE ──────────────────────────────────────────────────────────────

export const DATA_SCOPE = {
  DEPARTMENT_ONLY: "department" as const,
  ALL_HOSPITAL: "hospital" as const,
};

export type DataScopeType = (typeof DATA_SCOPE)[keyof typeof DATA_SCOPE];

// ─── ROLE IDENTIFIERS (mirrored from constant.ts for co-location) ────────────

const R = {
  SUPER_ADMIN: 1,
  HOSPITAL_ADMIN: 2,
  DOCTOR: 3,
  STAFF: 4,
  NURSE: 5,
  LAB_TECHNICIAN: 6,
  PHARMACIST: 7, // Phase 2
  BILLING: 8,
  RECEPTIONIST: 9,
  DEPARTMENT_HEAD: 10,
  AUDITOR: 11, // Phase 2
} as const;

// ─── ADMIN ROLES (bypass data scoping) ───────────────────────────────────────

export const ADMIN_ROLES: number[] = [R.SUPER_ADMIN, R.HOSPITAL_ADMIN];

// ─── ROLE → DEFAULT PERMISSIONS MAP ──────────────────────────────────────────

const P = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<number, string[]> = {
  // ────────────────────────────────────────────────────────────────────────────
  // SUPER_ADMIN — platform administration, security, audit & read-only clinical
  // Strictly barred from clinical write, prescription authoring, and lab result entry
  // ────────────────────────────────────────────────────────────────────────────
  [R.SUPER_ADMIN]: [
    // User management (platform level)
    P.USERS_CREATE, P.USERS_READ, P.USERS_UPDATE, P.USERS_DELETE, P.USERS_ASSIGN_ROLE,
    // Hospital & department
    P.HOSPITAL_MANAGE, P.DEPARTMENT_MANAGE, P.DEPARTMENT_READ, P.DEPARTMENT_MANAGE_STAFF,
    // Patient (read / search / history for audit and technical support)
    P.PATIENTS_READ, P.PATIENTS_SEARCH, P.PATIENTS_VIEW_HISTORY,
    // OPD (oversight)
    P.OPD_VIEW_QUEUE, P.OPD_STATS,
    // Clinical (READ ONLY — Super Admin has NO clinical authoring rights)
    P.CLINICAL_PRESCRIPTION_READ, P.CLINICAL_SOAP_READ, P.CLINICAL_DISCHARGE_READ,
    P.CLINICAL_ASSESSMENT_READ,
    // Lab (READ ONLY)
    P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Billing (audit & reports)
    P.BILLING_READ, P.BILLING_REPORTS,
    // Pharmacy
    P.PHARMACY_VIEW_ORDERS, P.PHARMACY_DISPENSE,
    // ABDM
    P.ABDM_CONSENT_READ, P.ABDM_HIU_FETCH,
    // Security & system administration
    P.SYSTEM_AUDIT_LOGS, P.SYSTEM_SESSIONS, P.SMS_SEND, 
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // HOSPITAL_ADMIN — full hospital management
  // ────────────────────────────────────────────────────────────────────────────
  [R.HOSPITAL_ADMIN]: [
    // User management
    P.USERS_CREATE, P.USERS_READ, P.USERS_UPDATE, P.USERS_DELETE, P.USERS_ASSIGN_ROLE,
    // Hospital & department
    P.HOSPITAL_MANAGE, P.DEPARTMENT_MANAGE, P.DEPARTMENT_READ, P.DEPARTMENT_MANAGE_STAFF,
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA, P.PATIENTS_VIEW_HISTORY,
    // OPD
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE, P.OPD_CANCEL_VISIT, P.OPD_STATS, P.OPD_UPDATE_SERVING,
    // Clinical (read only)
    P.CLINICAL_PRESCRIPTION_READ, P.CLINICAL_SOAP_READ, P.CLINICAL_DISCHARGE_READ,
    P.CLINICAL_ASSESSMENT_READ,
    // Lab
    P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Billing
    P.BILLING_CREATE, P.BILLING_READ, P.BILLING_PROCESS_PAYMENT, P.BILLING_REPORTS,
    // Pharmacy
    P.PHARMACY_VIEW_ORDERS, P.PHARMACY_DISPENSE,
    // ABDM
    P.ABDM_LINK_CARECONTEXT, P.ABDM_CONSENT_INITIATE, P.ABDM_CONSENT_READ, P.ABDM_HIU_FETCH,
    // System
    P.SYSTEM_AUDIT_LOGS, P.SYSTEM_SESSIONS, P.SMS_SEND,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // DOCTOR — clinical care, prescriptions, referrals
  // ────────────────────────────────────────────────────────────────────────────
  [R.DOCTOR]: [
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA, P.PATIENTS_VIEW_HISTORY,
    // OPD
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE, P.OPD_NEXT_PATIENT, P.OPD_CANCEL_VISIT,
    P.OPD_STATS, P.OPD_UPDATE_SERVING,
    // Clinical (full read/write)
    P.CLINICAL_PRESCRIPTION_WRITE, P.CLINICAL_PRESCRIPTION_READ,
    P.CLINICAL_SOAP_WRITE, P.CLINICAL_SOAP_READ,
    P.CLINICAL_DISCHARGE_WRITE, P.CLINICAL_DISCHARGE_READ,
    P.CLINICAL_ASSESSMENT_WRITE, P.CLINICAL_ASSESSMENT_READ,
    P.CLINICAL_IMMUNIZATION_WRITE,
    // Lab
    P.LAB_ORDER, P.LAB_FINALIZE, P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Department
    P.DEPARTMENT_READ,
    // ABDM
    P.ABDM_LINK_CARECONTEXT, P.ABDM_CONSENT_INITIATE, P.ABDM_CONSENT_READ, P.ABDM_HIU_FETCH,
    // SMS
    P.SMS_SEND,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // STAFF — general admin, data entry, registration support
  // ────────────────────────────────────────────────────────────────────────────
  [R.STAFF]: [
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA,
    // OPD
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE,
    // Department
    P.DEPARTMENT_READ,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // NURSE — clinical support, vitals, assessments, triage
  // ────────────────────────────────────────────────────────────────────────────
  [R.NURSE]: [
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA, P.PATIENTS_VIEW_HISTORY,
    // OPD
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE, P.OPD_NEXT_PATIENT, P.OPD_UPDATE_SERVING,
    // Clinical
    P.CLINICAL_PRESCRIPTION_READ,
    P.CLINICAL_ASSESSMENT_WRITE, P.CLINICAL_ASSESSMENT_READ,
    P.CLINICAL_IMMUNIZATION_WRITE,
    P.CLINICAL_SOAP_READ, P.CLINICAL_DISCHARGE_READ,
    // Lab
    P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Department
    P.DEPARTMENT_READ,
    // ABDM
    P.ABDM_CONSENT_READ,
    // SMS
    P.SMS_SEND,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // LAB_TECHNICIAN — lab sample collection, result entry, finalization
  // ────────────────────────────────────────────────────────────────────────────
  [R.LAB_TECHNICIAN]: [
    // Patient (read-only for context)
    P.PATIENTS_READ, P.PATIENTS_SEARCH, P.PATIENTS_VIEW_HISTORY,
    // Lab (core responsibility)
    P.LAB_ENTER_RESULTS, P.LAB_FINALIZE, P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Department
    P.DEPARTMENT_READ,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // PHARMACIST — prescription verification, drug dispensing & inventory
  // ────────────────────────────────────────────────────────────────────────────
  [R.PHARMACIST]: [
    P.PHARMACY_VIEW_ORDERS,
    P.PHARMACY_DISPENSE,
    P.CLINICAL_PRESCRIPTION_READ,
    P.PATIENTS_READ,
    P.PATIENTS_SEARCH,
    P.DEPARTMENT_READ,
    P.ABDM_CONSENT_READ,
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // BILLING — invoicing, payments, financial reports
  // ────────────────────────────────────────────────────────────────────────────
  [R.BILLING]: [
    // Patient (read-only for billing context)
    P.PATIENTS_READ, P.PATIENTS_SEARCH,
    // Billing (core responsibility)
    P.BILLING_CREATE, P.BILLING_READ, P.BILLING_PROCESS_PAYMENT, P.BILLING_REPORTS,
    // OPD (view for billing reference)
    P.OPD_VIEW_QUEUE,
    // Department
    P.DEPARTMENT_READ,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // RECEPTIONIST — front desk, registration, queue management
  // ────────────────────────────────────────────────────────────────────────────
  [R.RECEPTIONIST]: [
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA,
    // OPD (core responsibility)
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE, P.OPD_CANCEL_VISIT, P.OPD_STATS,
    P.OPD_UPDATE_SERVING,
    // Billing (view only)
    P.BILLING_READ,
    // Department
    P.DEPARTMENT_READ,
    // SMS
    P.SMS_SEND,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // DEPARTMENT_HEAD — Doctor + department oversight
  // ────────────────────────────────────────────────────────────────────────────
  [R.DEPARTMENT_HEAD]: [
    // User management (within department)
    P.USERS_READ, P.DEPARTMENT_MANAGE_STAFF,
    // Patient
    P.PATIENTS_REGISTER, P.PATIENTS_READ, P.PATIENTS_UPDATE, P.PATIENTS_SEARCH,
    P.PATIENTS_LINK_ABHA, P.PATIENTS_VIEW_HISTORY,
    // OPD
    P.OPD_ADD_VISIT, P.OPD_VIEW_QUEUE, P.OPD_NEXT_PATIENT, P.OPD_CANCEL_VISIT,
    P.OPD_STATS, P.OPD_UPDATE_SERVING,
    // Clinical (full read/write — same as Doctor)
    P.CLINICAL_PRESCRIPTION_WRITE, P.CLINICAL_PRESCRIPTION_READ,
    P.CLINICAL_SOAP_WRITE, P.CLINICAL_SOAP_READ,
    P.CLINICAL_DISCHARGE_WRITE, P.CLINICAL_DISCHARGE_READ,
    P.CLINICAL_ASSESSMENT_WRITE, P.CLINICAL_ASSESSMENT_READ,
    P.CLINICAL_IMMUNIZATION_WRITE,
    // Lab
    P.LAB_ORDER, P.LAB_FINALIZE, P.LAB_READ, P.LAB_VIEW_TEMPLATES,
    // Department
    P.DEPARTMENT_READ, P.DEPARTMENT_MANAGE_STAFF,
    // ABDM
    P.ABDM_LINK_CARECONTEXT, P.ABDM_CONSENT_INITIATE, P.ABDM_CONSENT_READ, P.ABDM_HIU_FETCH,
    // SMS
    P.SMS_SEND,
    // Terminology
    P.TERMINOLOGY_SEARCH,
  ],

  // ────────────────────────────────────────────────────────────────────────────
  // AUDITOR — Phase 2 placeholder (read-only across all modules)
  // ────────────────────────────────────────────────────────────────────────────
  [R.AUDITOR]: [
    P.USERS_READ,
    P.DEPARTMENT_READ,
    P.PATIENTS_READ, P.PATIENTS_SEARCH, P.PATIENTS_VIEW_HISTORY,
    P.OPD_VIEW_QUEUE, P.OPD_STATS,
    P.CLINICAL_PRESCRIPTION_READ, P.CLINICAL_SOAP_READ,
    P.CLINICAL_DISCHARGE_READ, P.CLINICAL_ASSESSMENT_READ,
    P.LAB_READ,
    P.BILLING_READ, P.BILLING_REPORTS,
    P.ABDM_CONSENT_READ,
    P.SYSTEM_AUDIT_LOGS,
  ],
};

/**
 * Resolve a user's effective permissions strictly from their role.
 * Super Admin bypass is handled in the middleware layer, not here.
 */
export function resolvePermissions(roleId: number): string[] {
  const perms = ROLE_PERMISSIONS[roleId];
  return perms ? [...perms] : [];
}

/** Role metadata for seed script and API responses */
export const ROLE_METADATA: Record<number, { name: string; description: string }> = {
  [R.SUPER_ADMIN]: {
    name: "Super Admin",
    description: "Platform-level administrator managing multi-hospital infrastructure, global users, and security audits.",
  },
  [R.HOSPITAL_ADMIN]: {
    name: "Hospital Admin",
    description: "Hospital administrator managing staff, departments, queues, billing, and operational oversight.",
  },
  [R.DOCTOR]: {
    name: "Doctor",
    description: "Treats patients, writes prescriptions, SOAP notes, and discharge summaries.",
  },
  [R.STAFF]: {
    name: "Staff",
    description: "General admin staff — registration desk, data entry, and support tasks.",
  },
  [R.NURSE]: {
    name: "Nurse",
    description: "Clinical support — vitals, assessments, triage, and immunization records.",
  },
  [R.LAB_TECHNICIAN]: {
    name: "Lab Technician",
    description: "Lab sample collection, result entry, and report finalization.",
  },
  [R.PHARMACIST]: {
    name: "Pharmacist",
    description: "Dispenses medications, verifies prescriptions, and manages pharmacy dispensing orders.",
  },
  [R.BILLING]: {
    name: "Billing / Accounts",
    description: "Billing, invoicing, insurance, and payment tracking.",
  },
  [R.RECEPTIONIST]: {
    name: "Receptionist / Front Desk",
    description: "Patient registration, OPD queue management, and appointment handling.",
  },
  [R.DEPARTMENT_HEAD]: {
    name: "Department Head (HOD)",
    description: "Everything a Doctor can do, plus department staff management and oversight.",
  },
  [R.AUDITOR]: {
    name: "Auditor (Read-Only)",
    description: "Read-only access for compliance audits and reporting. (Phase 2)",
  },
};
