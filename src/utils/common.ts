import bcrypt from "bcrypt";
import { Response } from 'express';
import jwt from "jsonwebtoken";
const SALT_ROUNDS = 10;

if (!process.env.JWT_SECRET) {
  throw new Error(
    "[SECURITY] JWT_SECRET environment variable is not set. Refusing to start with an insecure default.",
  );
}
const SECRET_KEY: string = process.env.JWT_SECRET;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const apiResponse = (
  res: any,
  data: any,
  code: number,
  msg?: string | "Success",
) => {
  return res.status(code).json({ data: data, msg: msg, code: code });
};

export const generateToken = (payload: object): string => {
  return jwt.sign(payload, SECRET_KEY, { expiresIn: "24h" });
};

const stripBearer = (token: string): string => {
  if (token && token.startsWith("Bearer ")) {
    return token.slice(7);
  }
  return token;
};

// A simple in-memory store for blacklisted tokens (use a database/Redis in production)
const tokenBlacklist = new Set<string>();

export const expiredToken = (token: string) => {
  try {
    const cleanToken = stripBearer(token);
    jwt.verify(cleanToken, SECRET_KEY);
    tokenBlacklist.add(cleanToken);
    return true;
  } catch (error) {
    return false;
  }
};

export const isTokenBlacklisted = (token: string): boolean => {
  return tokenBlacklist.has(stripBearer(token));
};

export const verifyToken = (token: string) => {
  try {
    const cleanToken = stripBearer(token);
    if (!cleanToken) return null;
    if (tokenBlacklist.has(cleanToken)) return null;
    const decoded = jwt.verify(cleanToken, SECRET_KEY);
    return decoded;
  } catch (error) {
    return null;
  }
};
export const FHIR_BUNDLES = [
  {
    type: "OP_CONSULT",
    bundle: {
      resourceType: "Bundle",
      type: "document",
      timestamp: "2025-08-09T10:00:00Z",
      entry: [
        {
          fullUrl: "urn:uuid:patient-1",
          resource: {
            resourceType: "Patient",
            id: "patient-1",
            name: [{ text: "Amit Verma" }],
            gender: "male",
            birthDate: "1990-04-15",
          },
        },
        {
          fullUrl: "urn:uuid:practitioner-1",
          resource: {
            resourceType: "Practitioner",
            id: "practitioner-1",
            name: [{ text: "Dr. Suresh Gupta" }],
            qualification: [{ code: { text: "MBBS, MD" } }],
          },
        },
        {
          fullUrl: "urn:uuid:encounter-1",
          resource: {
            resourceType: "Encounter",
            id: "encounter-1",
            status: "finished",
            subject: { reference: "urn:uuid:patient-1" },
            period: {
              start: "2025-08-08T09:00:00Z",
              end: "2025-08-08T09:30:00Z",
            },
          },
        },
        {
          fullUrl: "urn:uuid:observation-1",
          resource: {
            resourceType: "Observation",
            id: "observation-1",
            status: "final",
            code: { text: "Blood Pressure" },
            valueQuantity: { value: 120, unit: "mmHg" },
            subject: { reference: "urn:uuid:patient-1" },
          },
        },
      ],
    },
  },
  {
    type: "DISCHARGE_SUMMARY",
    bundle: {
      resourceType: "Bundle",
      type: "document",
      timestamp: "2025-08-09T10:00:00Z",
      entry: [
        {
          fullUrl: "urn:uuid:patient-2",
          resource: {
            resourceType: "Patient",
            id: "patient-2",
            name: [{ text: "Sunita Sharma" }],
            gender: "female",
            birthDate: "1975-12-05",
          },
        },
        {
          fullUrl: "urn:uuid:organization-1",
          resource: {
            resourceType: "Organization",
            id: "organization-1",
            name: "City Hospital",
          },
        },
        {
          fullUrl: "urn:uuid:encounter-2",
          resource: {
            resourceType: "Encounter",
            id: "encounter-2",
            status: "finished",
            subject: { reference: "urn:uuid:patient-2" },
            period: {
              start: "2025-08-01T08:00:00Z",
              end: "2025-08-07T14:00:00Z",
            },
          },
        },
        {
          fullUrl: "urn:uuid:composition-1",
          resource: {
            resourceType: "Composition",
            id: "composition-1",
            status: "final",
            type: { text: "Discharge Summary" },
            subject: { reference: "urn:uuid:patient-2" },
            date: "2025-08-07T14:00:00Z",
            author: [{ reference: "urn:uuid:organization-1" }],
            title: "Hospital Discharge Summary",
            section: [
              {
                title: "Diagnosis",
                text: { status: "generated", div: "<div>Pneumonia</div>" },
              },
              {
                title: "Treatment",
                text: {
                  status: "generated",
                  div: "<div>Antibiotics, Oxygen Support</div>",
                },
              },
            ],
          },
        },
      ],
    },
  },
  {
    type: "LAB_REPORT",
    bundle: {
      resourceType: "Bundle",
      type: "document",
      timestamp: "2025-08-09T10:00:00Z",
      entry: [
        {
          fullUrl: "urn:uuid:patient-3",
          resource: {
            resourceType: "Patient",
            id: "patient-3",
            name: [{ text: "Ravi Kumar" }],
            gender: "male",
            birthDate: "1985-05-20",
          },
        },
        {
          fullUrl: "urn:uuid:organization-2",
          resource: {
            resourceType: "Organization",
            id: "organization-2",
            name: "City Diagnostic Centre",
          },
        },
        {
          fullUrl: "urn:uuid:diagnosticreport-1",
          resource: {
            resourceType: "DiagnosticReport",
            id: "diagnosticreport-1",
            status: "final",
            category: [
              {
                coding: [
                  {
                    system: "http://terminology.hl7.org/CodeSystem/v2-0074",
                    code: "LAB",
                  },
                ],
              },
            ],
            code: { text: "Complete Blood Count" },
            subject: { reference: "urn:uuid:patient-3" },
            effectiveDateTime: "2025-08-08T09:00:00Z",
            issued: "2025-08-08T12:00:00Z",
            performer: [{ reference: "urn:uuid:organization-2" }],
            result: [{ reference: "urn:uuid:observation-1" }],
          },
        },
        {
          fullUrl: "urn:uuid:observation-1",
          resource: {
            resourceType: "Observation",
            id: "observation-1",
            status: "final",
            code: { text: "Hemoglobin" },
            valueQuantity: { value: 14.5, unit: "g/dL" },
            subject: { reference: "urn:uuid:patient-3" },
          },
        },
      ],
    },
  },
  {
    type: "IMMUNIZATION",
    bundle: {
      resourceType: "Bundle",
      type: "document",
      timestamp: "2025-08-09T10:00:00Z",
      entry: [
        {
          fullUrl: "urn:uuid:patient-4",
          resource: {
            resourceType: "Patient",
            id: "patient-4",
            name: [{ text: "Priya Singh" }],
            gender: "female",
            birthDate: "1992-03-12",
          },
        },
        {
          fullUrl: "urn:uuid:immunization-1",
          resource: {
            resourceType: "Immunization",
            id: "immunization-1",
            status: "completed",
            vaccineCode: { text: "COVID-19 Vaccine" },
            patient: { reference: "urn:uuid:patient-4" },
            occurrenceDateTime: "2025-07-01T10:00:00Z",
            primarySource: true,
          },
        },
      ],
    },
  },
];
export const generateUniqueAlphaNumericId = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";

  let alpha = "";
  let numeric = "";

  const timeSeed = Date.now().toString();

  for (let i = 0; i < 5; i++) {
    alpha += letters[Math.floor(Math.random() * letters.length)];
    numeric += numbers[(timeSeed + Math.random()).charCodeAt(i) % 10];
  }

  return alpha + numeric;
};

export const normalizeAbha = (value: string | undefined): string => {
  if (!value || typeof value !== "string") return "";
  return value.replace(/-/g, "").trim();
};

export const formatAbhaForStorage = (
  value: string | undefined,
): string | undefined => {
  if (!value || typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "").trim();
  if (digits.length !== 14) return value.trim();
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
};
