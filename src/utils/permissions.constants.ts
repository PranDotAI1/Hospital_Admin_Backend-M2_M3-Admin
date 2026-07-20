import { ROLE } from "./constant";

export const MODULES = {
  USER_MANAGEMENT: "User Management",
  HOSPITAL_SETTINGS: "Hospital Settings",
  ACCESS_LOGS: "Access Logs",
  ANALYTICS_DASHBOARD: "Analytics Dashboard",
  ANALYTICS_PATIENT: "Analytics Patient",
  PATIENT_RECORDS: "Patient Records",
  APPOINTMENTS: "Appointments",
  E_PRESCRIPTIONS: "E-Prescriptions",
  MEDICAL_NOTES: "Medical Notes",
  LAB_ORDERS: "Lab Orders",
  PATIENT_VITALS: "Patient Vitals",
  MEDICATION_LOGS: "Medication Logs",
  ASSIGNED_PATIENT_VIEWING: "Assigned patient viewing",
  APPOINTMENTS_SCHEDULING: "Appointments scheduling",
  PATIENT_CHECK_IN: "Patient Check-In",
  DOCTOR_AVAILABILITY: "Doctor availability",
  BILLING_DASHBOARD: "Billing dashboard",
  INVOICE_CREATION: "Invoice creation",
  INSURANCE_CLAIMS_SUBMISSION: "Insurance claims submission",
  DEVICE_MANAGEMENT: "Device management",
  MODULE_ACCESS_CONTROL: "Module access control",
  API_SYSTEM_MONITORING: "API/system monitoring",
  ID_BADGE_MANAGEMENT: "ID badge management",
  INCIDENT_REPORTING: "Incident reporting",
  RESOURCE_MANAGEMENT: "Resource Management",
  FEEDBACK_MANAGEMENT: "Feedback Management",
  WELLNESS_MANAGEMENT: "Wellness Management",
  BASIC_DASHBOARD_VIEW: "Basic Dashboard View",
} as const;

export const ROLE_MODULES: Record<number, string[]> = {
  [ROLE.SUPER_ADMIN]: ["User Management", "Hospital Settings", "Access Logs", "Analytics Dashboard", "Analytics Patient", "Resource Management", "Feedback Management", "Wellness Management"],
  [ROLE.HOSPITAL_ADMIN]: ["User Management", "Hospital Settings", "Access Logs", "Analytics Dashboard", "Analytics Patient", "Resource Management", "Feedback Management", "Wellness Management"],
  [ROLE.DOCTOR]: ["Patient Records", "Appointments", "E-Prescriptions", "Medical Notes", "Lab Orders"],
  [ROLE.NURSE]: ["Patient Vitals", "Medication Logs", "Assigned patient viewing", "Incident reporting", "Wellness Management"],
  [ROLE.RECEPTIONIST]: ["Appointments scheduling", "Patient Check-In", "Doctor availability", "Feedback Management"],
  [ROLE.ACCOUNTANT]: ["Billing dashboard", "Invoice creation", "Insurance claims submission"],
  [ROLE.IT_SUPPORT]: ["Device management", "Module access control", "API/system monitoring"],
  [ROLE.SECURITY]: ["Access logs", "ID badge management", "Incident reporting"],
  [ROLE.STAFF]: ["Basic Dashboard View"], // Default fallback
};

export const ACTIONS = {
  VIEW: "view",
  CREATE: "create",
  EDIT: "edit",
  DELETE: "delete",
} as const;

export type ModulePermissions = {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
};

export type DynamicPermissionsMap = Record<string, ModulePermissions>;

/**
 * Generates default permissions with all actions set to false for a specific role.
 */
export const getDefaultPermissions = (roleId: number): DynamicPermissionsMap => {
  const perms: DynamicPermissionsMap = {};
  const modules = ROLE_MODULES[roleId] || ROLE_MODULES[ROLE.STAFF];
  
  for (const mod of modules) {
    perms[mod] = { view: false, create: false, edit: false, delete: false };
  }
  return perms;
};
