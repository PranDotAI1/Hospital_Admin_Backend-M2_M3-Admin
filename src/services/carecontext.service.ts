import axios from "axios";
import { Types } from "mongoose";
import {
  CareContextModel,
  CareContextStatus,
  HIType,
  ICareContext,
} from "../models/CareContext";
import { PatientModel, IPatient } from "../models/Patient";
import { ScanShareVisitModel } from "../models/ScanShareVisit";
import { VisitPrescriptionModel } from "../models/VisitPrescription";
import { VisitLabReportModel } from "../models/VisitLabReport";
import { VisitSoapNotesModel } from "../models/VisitSoapNotes";
import { VisitDischargeSummaryModel } from "../models/VisitDischargeSummary";
import { VisitAssessmentModel } from "../models/VisitAssessment";
import { LabReportModel } from "../models/LabReport";
import { VisitDayCareBilling } from "../models/VisitDayCareBilling";
import {
  generateUID,
  facilityId,
  facilityName,
  X_HIP_ID,
  X_CM_ID,
  MAX_LINK_ATTEMPTS,
  LINK_TOKEN_VALIDITY_MONTHS,
  LINK_TOKEN_REQUEST_COOLDOWN_HOURS,
  SEPARATE_CARECONTEXT_PER_HITYPE,
} from "../utils/constant";
import { AbdmTokenService } from "./abdm.token.service";

const to14DigitAbha = (value: string | undefined): string => {
  if (!value || typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 14 ? digits.slice(0, 14) : digits;
};

/** Normalize ABHA address for API calls so token request and link use the same value (ABDM-9999 mismatch). */
const normalizeAbhaAddress = (value: string | undefined): string => {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

export const resolveCanonicalHiType = async (
  careContext: ICareContext | any,
  skipDetection: boolean = false,
): Promise<HIType> => {
  // Priority 1: hiType field (canonical, set at creation time)
  if (careContext.hiType) {
    console.log(
      `[HITYPE-DEBUG] resolveCanonicalHiType: cc=${careContext.careContextReference} P1(hiType field)=${careContext.hiType} rawHiTypes=${JSON.stringify(careContext.hiTypes)}`,
    );
    return careContext.hiType as HIType;
  }

  // Priority 2: If hiTypes has exactly one element, it's unambiguous
  if (Array.isArray(careContext.hiTypes) && careContext.hiTypes.length === 1) {
    console.log(
      `[HITYPE-DEBUG] resolveCanonicalHiType: cc=${careContext.careContextReference} P2(single hiTypes)=${careContext.hiTypes[0]}`,
    );
    return careContext.hiTypes[0] as HIType;
  }

  if (Array.isArray(careContext.hiTypes) && careContext.hiTypes.length > 1) {
    console.warn(
      `[HITYPE-DEBUG] resolveCanonicalHiType: cc=${careContext.careContextReference} CONTAMINATED rawHiTypes=${JSON.stringify(careContext.hiTypes)} hiType=${careContext.hiType}`,
    );
  }

  // Priority 3: Detect from visit data (expensive but accurate)
  if (!skipDetection && careContext.visitId) {
    try {
      const detectedTypes = await detectHiTypesForVisit(careContext.visitId);

      if (detectedTypes.length > 0) {
        // If hiTypes array exists, find the intersection with detected types.
        if (
          Array.isArray(careContext.hiTypes) &&
          careContext.hiTypes.length > 0
        ) {
          const validTypes = detectedTypes.filter((dt: HIType) =>
            careContext.hiTypes.includes(dt),
          );

          if (validTypes.length > 0) {
            // Prioritize specific types (e.g. WellnessRecord) over generic OPConsultation
            const specific = validTypes.find(
              (t: HIType) => t !== "OPConsultation",
            );
            return (specific || validTypes[0]) as HIType;
          }
        }

        // No intersection — use the most specific detected type
        // (prefer non-OPConsultation since OPConsultation is the generic fallback)
        const specific = detectedTypes.find(
          (t: HIType) => t !== "OPConsultation",
        );
        return (specific || detectedTypes[0]) as HIType;
      }
    } catch (err: any) {
      console.warn(
        "resolveCanonicalHiType: detection failed (non-blocking):",
        err.message,
      );
    }
  }

  // Priority 4: Last resort — safest ABDM default
  return "OPConsultation";
};

export const resolveCanonicalHiTypeSync = (
  careContext: ICareContext | any,
  fallback: HIType = "OPConsultation",
): HIType => {
  if (careContext.hiType) {
    return careContext.hiType as HIType;
  }
  if (Array.isArray(careContext.hiTypes) && careContext.hiTypes.length === 1) {
    return careContext.hiTypes[0] as HIType;
  }
  return fallback;
};

/** ABDM generate-token accepts only: M, F, O, D, T, U. Map common values to these. */
const normalizeGenderForAbdm = (
  value: string | undefined,
): "M" | "F" | "O" | "D" | "T" | "U" => {
  if (!value || typeof value !== "string") return "U";
  const u = value.trim().toUpperCase();
  if (u === "M" || u.startsWith("MALE")) return "M";
  if (u === "F" || u.startsWith("FEMALE")) return "F";
  if (u === "O" || u.startsWith("OTHER")) return "O";
  if (u === "D") return "D";
  if (u === "T" || u.startsWith("TRANS")) return "T";
  return "U";
};

/**
 * Generate a unique Care Context Reference
 * Format: CC-{UHID}-{YYYYMMDD}-{SEQ}
 */
export const generateCareContextReference = async (
  uhid: string,
  date: Date = new Date(),
): Promise<string> => {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `CC-${uhid}-${dateStr}`;

  // Find the highest existing sequence number for this prefix
  const latest = await CareContextModel.findOne(
    { careContextReference: { $regex: `^${prefix}-` } },
    { careContextReference: 1 },
    { sort: { careContextReference: -1 } },
  ).lean();

  let nextSeq = 1;
  if (latest?.careContextReference) {
    const parts = latest.careContextReference.split("-");
    const lastSeq = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastSeq)) {
      nextSeq = lastSeq + 1;
    }
  }

  const seq = nextSeq.toString().padStart(3, "0");
  return `${prefix}-${seq}`;
};

export const generateDisplayText = (
  visitType: string = "OPD Visit",
  department?: string,
  date: Date = new Date(),
): string => {
  const dateStr = date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  if (department) {
    return `${visitType} - ${department} - ${dateStr}`;
  }
  return `${visitType} - ${dateStr}`;
};

export const isLinkTokenValid = (patient: IPatient): boolean => {
  if (!patient.abdmLinkToken?.token) {
    return false;
  }

  if (patient.abdmLinkToken.status === "EXPIRED") {
    return false;
  }

  const now = new Date();
  const expiresAt = new Date(patient.abdmLinkToken.expiresAt);

  if (now >= expiresAt) {
    return false;
  }

  // Defensive: if we stored which ABHA this token was issued for, verify it still matches.
  // This catches stale tokens from before this field was added too (abhaAddress would be undefined).
  if (
    patient.abdmLinkToken.abhaAddress &&
    patient.abhaaddress &&
    patient.abdmLinkToken.abhaAddress.toLowerCase() !==
      patient.abhaaddress.toLowerCase()
  ) {
    return false;
  }

  return true;
};

export const calculateTokenExpiry = (): Date => {
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + LINK_TOKEN_VALIDITY_MONTHS);
  return expiry;
};

export const storeLinkToken = async (
  patientId: Types.ObjectId | string,
  linkToken: string,
): Promise<void> => {
  const now = new Date();
  // Fetch current abhaaddress so we can record it on the token
  const patient = await PatientModel.findById(patientId)
    .select("abhaaddress")
    .lean();
  await PatientModel.updateOne(
    { _id: patientId },
    {
      $set: {
        "abdmLinkToken.token": linkToken,
        "abdmLinkToken.issuedAt": now,
        "abdmLinkToken.expiresAt": calculateTokenExpiry(),
        "abdmLinkToken.status": "ACTIVE",
        ...(patient?.abhaaddress
          ? { "abdmLinkToken.abhaAddress": patient.abhaaddress }
          : {}),
      },
      $unset: { abdmLinkTokenRequestedAt: 1 },
    },
  );
};

export const storeLinkTokenByAbhaAddress = async (
  abhaAddress: string,
  linkToken: string,
): Promise<IPatient | null> => {
  const now = new Date();
  const normalized = normalizeAbhaAddress(abhaAddress);
  const patient = await PatientModel.findOneAndUpdate(
    {
      abhaaddress: new RegExp(
        `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    },
    {
      $set: {
        "abdmLinkToken.token": linkToken,
        "abdmLinkToken.issuedAt": now,
        "abdmLinkToken.expiresAt": calculateTokenExpiry(),
        "abdmLinkToken.status": "ACTIVE",
        "abdmLinkToken.abhaAddress": normalized, // record which ABHA this token was issued for
      },
      $unset: { abdmLinkTokenRequestedAt: 1 },
    },
    { new: true },
  );
  return patient;
};

export const requestLinkToken = async (patient: IPatient): Promise<boolean> => {
  try {
    const patientId = patient._id?.toString();
    if (!patientId) return false;

    const fresh = await PatientModel.findById(patientId).lean();
    if (!fresh) return false;

    const requestedAt = fresh?.abdmLinkTokenRequestedAt;
    if (requestedAt) {
      const hoursSince =
        (Date.now() - new Date(requestedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < LINK_TOKEN_REQUEST_COOLDOWN_HOURS) {
        return false;
      }
    }

    // Use refreshed patient data (abhaaddress/ABHANumber may have just been saved)
    const latestPatient = fresh as unknown as IPatient;
    if (!latestPatient.abhaaddress?.trim()) {
      return false;
    }

    const authToken = await AbdmTokenService.getToken();
    const requestId = generateUID();

    // Extract year of birth from dob or age
    let yearOfBirth: string | undefined;
    if (latestPatient.dob) {
      // dob could be in various formats; try to extract year
      const dobDate = new Date(latestPatient.dob);
      if (!isNaN(dobDate.getTime())) {
        yearOfBirth = dobDate.getFullYear().toString();
      } else {
        // Try extracting 4-digit year from string
        const yearMatch = latestPatient.dob.match(/\d{4}/);
        if (yearMatch) yearOfBirth = yearMatch[0];
      }
    }
    if (!yearOfBirth && latestPatient.age) {
      yearOfBirth = (
        new Date().getFullYear() - parseInt(latestPatient.age)
      ).toString();
    }

    const abhaNumber14 = to14DigitAbha(latestPatient.ABHANumber);
    const payload: Record<string, string> = {
      abhaAddress: normalizeAbhaAddress(latestPatient.abhaaddress) ?? "",
      name:
        latestPatient.name ||
        `${latestPatient.f_name} ${latestPatient.l_name || ""}`.trim(),
      gender: normalizeGenderForAbdm(latestPatient.gender),
      yearOfBirth: yearOfBirth || "",
    };
    if (abhaNumber14.length === 14) {
      payload.abhaNumber = abhaNumber14 ?? "";
    }
    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/v3/token/generate-token`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          "X-HIP-ID": X_HIP_ID,
          Authorization: authToken,
        },
      },
    );

    // Only set abdmLinkTokenRequestedAt AFTER successful API call
    // so that failures don't block retries via the cooldown
    const isSuccess = response.status === 200 || response.status === 202;
    if (isSuccess) {
      await PatientModel.updateOne(
        { _id: patientId },
        { $set: { abdmLinkTokenRequestedAt: new Date() } },
      );
    }
    return isSuccess;
  } catch (error: any) {
    const errCode = String(
      error.response?.data?.error?.code || error.response?.data?.code || "",
    );
    const isDuplicate =
      errCode.includes("1092") ||
      /duplicate link token/i.test(
        error.response?.data?.error?.message ||
          error.response?.data?.message ||
          "",
      );

    if (isDuplicate) {
      // ABDM-1092: ABDM already has a pending token generation for this ABHA address.
      // Treat as a soft success — set the cooldown so we don't keep hammering ABDM.
      // The token will arrive via the on-generate-token callback.
      try {
        const patientId = patient._id?.toString();
        if (patientId) {
          await PatientModel.updateOne(
            { _id: patientId },
            { $set: { abdmLinkTokenRequestedAt: new Date() } },
          );
        }
      } catch (_) {}
      return false;
    }

    console.error(
      "CareContext: Error requesting link token",
      error.response?.data || error.message,
    );
    // Only clear the cooldown for genuine failures (not duplicates) so retries are not blocked
    try {
      const patientId = patient._id?.toString();
      if (patientId) {
        await PatientModel.updateOne(
          { _id: patientId },
          { $unset: { abdmLinkTokenRequestedAt: 1 } },
        );
      }
    } catch (clearErr) {
      console.warn(
        "CareContext: Failed to clear abdmLinkTokenRequestedAt:",
        clearErr,
      );
    }
    return false;
  }
};

export const createCareContextForVisit = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  hiTypes: HIType[] = ["OPConsultation"],
): Promise<ICareContext | null> => {
  try {
    // Get patient details
    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      return null;
    }

    // Check if context already exists for this visit
    const existingContext = await CareContextModel.findOne({
      patientId,
      visitId,
    });
    if (existingContext) {
      return existingContext;
    }

    // Get visit details for display
    const visit = await ScanShareVisitModel.findById(visitId);
    const department = visit?.department;
    const visitDate = visit?.visitDate || new Date();

    // Use UHID as patient reference (HIP's internal identifier)
    const patientRef = patient.uhid || patient._id.toString();

    // Generate unique care context reference
    const careContextReference = await generateCareContextReference(
      patientRef,
      visitDate,
    );

    // Generate display text (no confidential data per ABDM spec)
    const display = generateDisplayText("OPD Visit", department, visitDate);

    // INVARIANT: One CareContext = exactly one HI type.
    // The caller specifies the hiType — honor it directly.
    // Do NOT call detectHiTypesForVisit here; it scans ALL clinical data
    // and can return multiple types, causing contamination.
    const normalizedHiType: HIType =
      (hiTypes && hiTypes.length > 0 ? hiTypes[0] : null) || "OPConsultation";

    // Create care context record
    const careContext = await CareContextModel.create({
      patientId,
      visitId,
      careContextReference,
      patientReference: patientRef,
      abhaAddress: patient.abhaaddress || "",
      display,
      hiType: normalizedHiType,
      hiTypes: [normalizedHiType],
      linkingStatus: CareContextStatus.PENDING,
      linkAttempts: 0,
      facilityId: facilityId,
      facilityName: facilityName,
    });
    if (patient.abhaaddress) {
      if (isLinkTokenValid(patient)) {
        setImmediate(async () => {
          try {
            const abdmToken = await AbdmTokenService.getToken();
            await linkCareContext(careContext._id, abdmToken);
          } catch (autoLinkError) {
            console.error(
              "CareContext: Auto-link failed (non-blocking):",
              autoLinkError,
            );
          }
        });
      } else {
        setImmediate(async () => {
          try {
            await requestLinkToken(patient);
          } catch (tokenErr) {
            console.error(
              "CareContext: Link token request failed (non-blocking):",
              tokenErr,
            );
          }
        });
      }
    } else {
    }

    return careContext;
  } catch (error) {
    console.error("CareContext: Error creating", error);
    return null;
  }
};

/** Friendly display names for HI types */
const HI_TYPE_DISPLAY_NAMES: Record<string, string> = {
  Prescription: "Prescription",
  DiagnosticReport: "Diagnostic Report",
  OPConsultation: "OP Consultation",
  DischargeSummary: "Discharge Summary",
  ImmunizationRecord: "Immunization Record",
  HealthDocumentRecord: "Health Document",
  WellnessRecord: "Wellness Record",
  Invoice: "Invoice",
};

/**
 * Create or update a CareContext for a visit.
 *
 * Behaviour depends on SEPARATE_CARECONTEXT_PER_HITYPE toggle:
 *
 * **true (default)** — One CareContext per (visit × hiType).
 *   Each hiType gets its own independent CareContext with a unique
 *   careContextReference, display and FHIR bundle.
 *   Lookup key: `{ patientId, visitId, hiType }`.
 *
 * **false (legacy)** — One CareContext per visit.
 *   All hiTypes are merged into a single CareContext's hiTypes array.
 *   Lookup key: `{ patientId, visitId }`.
 *
 * Idempotent in both modes.
 */
export const createOrUpdateCareContextForVisit = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  hiType: HIType,
): Promise<ICareContext | null> => {
  try {
    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      return null;
    }

    // ── Toggle-aware lookup ──
    const lookupQuery = SEPARATE_CARECONTEXT_PER_HITYPE
      ? { patientId, visitId, hiType }
      : { patientId, visitId };

    const existingContext = await CareContextModel.findOne(lookupQuery);

    if (existingContext) {
      // INVARIANT: One CareContext = one hiType. Never merge types.
      // In SEPARATE_CARECONTEXT_PER_HITYPE mode (default), the lookup
      // already matched by { patientId, visitId, hiType }, so this
      // context is exactly the right one. Just return it.
      console.log(
        `[HITYPE-DEBUG] createOrUpdateCareContextForVisit: REUSING cc=${existingContext.careContextReference} requestedHiType=${hiType} existing.hiType=${existingContext.hiType} existing.hiTypes=${JSON.stringify(existingContext.hiTypes)} toggle=${SEPARATE_CARECONTEXT_PER_HITYPE}`,
      );

      // Existing context may still need sync actions after clinical updates.
      triggerLinkingActions(existingContext, patient);
      return existingContext;
    }

    console.log(
      `[HITYPE-DEBUG] createOrUpdateCareContextForVisit: CREATING new cc for patientId=${patientId} visitId=${visitId} hiType=${hiType} toggle=${SEPARATE_CARECONTEXT_PER_HITYPE}`,
    );

    // ── Create new CareContext ──
    const visit = await ScanShareVisitModel.findById(visitId);
    const department = visit?.department;
    const visitDate = visit?.visitDate || new Date();
    const patientRef = patient.uhid || patient._id.toString();

    const careContextReference = await generateCareContextReference(
      patientRef,
      visitDate,
    );

    // In per-hiType mode, include the hiType in the display text
    const visitLabel = SEPARATE_CARECONTEXT_PER_HITYPE
      ? HI_TYPE_DISPLAY_NAMES[hiType] || hiType
      : "OPD Visit";
    const display = generateDisplayText(visitLabel, department, visitDate);

    let careContext: ICareContext;
    let retries = 3;
    while (true) {
      try {
        const ref =
          retries < 3
            ? await generateCareContextReference(patientRef, visitDate)
            : careContextReference;
        careContext = await CareContextModel.create({
          patientId,
          visitId,
          careContextReference: ref,
          patientReference: patientRef,
          abhaAddress: patient.abhaaddress || "",
          display,
          hiType,
          hiTypes: [hiType],
          linkingStatus: CareContextStatus.PENDING,
          linkAttempts: 0,
          facilityId: facilityId,
          facilityName: facilityName,
        });
        break;
      } catch (createErr: any) {
        // Duplicate key on compound index — race condition; find and return/update
        if (createErr?.code === 11000) {
          const dupKeyMsg = String(createErr?.message || "");
          const isCompoundDup =
            createErr?.keyPattern?.patientId ||
            createErr?.keyPattern?.visitId ||
            dupKeyMsg.includes("patientId_1_visitId_1") ||
            dupKeyMsg.includes("patientId_1_visitId_1_hiType_1");

          if (isCompoundDup) {
            // Race condition: another request created this CC concurrently.
            // Find and return the existing one (no type merging).
            const raceContext = await CareContextModel.findOne(
              SEPARATE_CARECONTEXT_PER_HITYPE
                ? { patientId, visitId, hiType }
                : { patientId, visitId },
            );
            if (raceContext) return raceContext;
            return null;
          }

          // Duplicate careContextReference collision — retry with new ref
          if (retries > 1) {
            retries--;
            console.warn(
              "CareContext: Duplicate reference collision, retrying...",
              retries,
              "attempts left",
            );
            continue;
          }
        }
        throw createErr;
      }
    }
    triggerLinkingActions(careContext, patient);
    return careContext;
  } catch (error) {
    console.error(
      "CareContext: Error in createOrUpdateCareContextForVisit",
      hiType,
      error,
    );
    return null;
  }
};

/** Trigger ABDM linking/notification in the background for a care context */
const triggerLinkingActions = (
  context: ICareContext,
  patient: IPatient,
): void => {
  if (!patient.abhaaddress) {
    return;
  }

  // Don't retry FAILED contexts on every clinical save — they need manual intervention
  // or a new link token to arrive via callback.
  if (context.linkingStatus === CareContextStatus.FAILED) {
    return;
  }

  if (context.linkingStatus === CareContextStatus.LINKING) {
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
    if (context.lastLinkAttemptAt && context.lastLinkAttemptAt > twoMinsAgo) {
      return;
    }
  }

  if (
    context.linkingStatus === CareContextStatus.LINKED ||
    context.linkingStatus === CareContextStatus.NOTIFIED
  ) {
    setImmediate(async () => {
      try {
        await notifyContext(context);
      } catch (err) {
        console.warn(
          "CareContext: notify retry failed for existing context:",
          (err as any)?.message || err,
        );
      }
    });
  } else if (isLinkTokenValid(patient)) {
    setImmediate(async () => {
      try {
        const abdmToken = await AbdmTokenService.getToken();
        await linkCareContext(context._id, abdmToken);
      } catch (err) {
        console.warn(
          "CareContext: link retry failed for existing context:",
          (err as any)?.message || err,
        );
      }
    });
  } else {
    setImmediate(async () => {
      try {
        await requestLinkToken(patient);
      } catch (err) {
        console.warn(
          "CareContext: token request retry failed for existing context:",
          (err as any)?.message || err,
        );
      }
    });
  }
};

/** @deprecated Use createOrUpdateCareContextForVisit instead */
export const createCareContextForHiType = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  hiType: HIType,
): Promise<ICareContext | null> => {
  return createOrUpdateCareContextForVisit(patientId, visitId, hiType);
};

/** @deprecated Use createOrUpdateCareContextForVisit instead */
export const addHiTypesForVisit = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  hiTypesToAdd: HIType[],
): Promise<{ updated: number; careContext: ICareContext | null }> => {
  if (!hiTypesToAdd || hiTypesToAdd.length === 0) {
    return { updated: 0, careContext: null };
  }
  const uniqueTypes = Array.from(new Set(hiTypesToAdd)) as HIType[];
  let updated = 0;
  let lastContext: ICareContext | null = null;

  for (const hiType of uniqueTypes) {
    const ctx = await createOrUpdateCareContextForVisit(
      patientId,
      visitId,
      hiType,
    );
    if (ctx) {
      updated++;
      lastContext = ctx;
    }
  }

  return { updated, careContext: lastContext };
};

export const linkCareContext = async (
  careContextId: Types.ObjectId | string,
  authToken?: string,
  force: boolean = false,
): Promise<boolean> => {
  try {
    const careContext = await CareContextModel.findById(careContextId);
    if (!careContext) {
      return false;
    }

    if (
      !force &&
      (careContext.linkingStatus === CareContextStatus.LINKED ||
        careContext.linkingStatus === CareContextStatus.NOTIFIED)
    ) {
      return true;
    }

    // Check max attempts
    if (careContext.linkAttempts >= MAX_LINK_ATTEMPTS) {
      careContext.linkingStatus = CareContextStatus.FAILED;
      careContext.linkError = { message: "Maximum link attempts reached" };
      await careContext.save();
      return false;
    }

    // Get patient and check link token
    const patient = await PatientModel.findById(careContext.patientId);
    if (!patient) {
      return false;
    }

    if (!isLinkTokenValid(patient)) {
      careContext.linkingStatus = CareContextStatus.PENDING;
      careContext.linkError = {
        message: "No valid link token available; token request triggered",
      };
      await careContext.save();

      await requestLinkToken(patient);
      return false;
    }

    const linkToken = patient.abdmLinkToken!.token;

    // Get ABDM session token (use provided or fetch fresh)
    let abdmAuthToken = authToken;
    if (!abdmAuthToken) {
      abdmAuthToken = await AbdmTokenService.getToken();
    }

    // Prepare ABDM payload per V3 API spec (ABDM-1091: abhaNumber must be only 14 digits)
    const requestId = generateUID();
    const abhaNumber14 = to14DigitAbha(patient.ABHANumber);
    if (!abhaNumber14 || abhaNumber14.length !== 14) {
      console.error(
        "CareContext: Invalid ABHA number for linking (need 14 digits), got:",
        patient.ABHANumber
          ? `"${patient.ABHANumber}" → "${abhaNumber14}"`
          : "missing",
      );
      careContext.linkingStatus = CareContextStatus.PENDING;
      careContext.linkError = {
        message: "ABHA number must be 14 digits for ABDM link",
      };
      await careContext.save();
      return false;
    }

    const normalizedAbhaAddr = normalizeAbhaAddress(patient.abhaaddress);

    const resolvedHiType = await resolveCanonicalHiType(careContext);

    if (!careContext.hiType && resolvedHiType) {
      await CareContextModel.updateOne(
        { _id: careContext._id },
        { $set: { hiType: resolvedHiType, hiTypes: [resolvedHiType] } },
      );
      careContext.hiType = resolvedHiType as import("../models/CareContext").HIType;
    }

    console.log(
      `[HITYPE-DEBUG] linkCareContext: cc=${careContext.careContextReference} db.hiType=${careContext.hiType} db.hiTypes=${JSON.stringify(careContext.hiTypes)} resolved=${resolvedHiType} — LINK PAYLOAD hiType=${resolvedHiType}`,
    );

    const payload = {
      abhaNumber: abhaNumber14,
      abhaAddress: normalizedAbhaAddr,
      patient: [
        {
          // Patient referenceNumber = HIP's internal patient ID (UHID)
          referenceNumber: patient.uhid || patient._id.toString(),
          display:
            patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim(),
          careContexts: [
            {
              referenceNumber: careContext.careContextReference,
              display: careContext.display,
            },
          ],
          hiType: resolvedHiType,
          count: 1,
        },
      ],
    };

    console.info(
      "[ABDM Payload] link/carecontext constructed",
      JSON.stringify({
        endpoint: "link/carecontext",
        careContextRef: careContext.careContextReference,
        patientRef: patient.uhid || patient._id.toString(),
        hiType: resolvedHiType,
        careContexts: [careContext.careContextReference],
      }),
    );

    // Update status to LINKING
    careContext.linkingStatus = CareContextStatus.LINKING;
    careContext.linkRequestId = requestId;
    careContext.linkAttempts += 1;
    careContext.lastLinkAttemptAt = new Date();
    await careContext.save();

    // Call ABDM API
    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/hip/v3/link/carecontext`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-HIP-ID": X_HIP_ID,
          "X-CM-ID": X_CM_ID,
          "X-LINK-TOKEN": linkToken,
          Authorization: abdmAuthToken,
        },
      },
    );
    // 200 or 202 = request accepted, wait for callback
    if (response.status === 200 || response.status === 202) {
      return true;
    }

    return false;
  } catch (error: any) {
    const errData = error.response?.data;
    const errObj = errData?.error || errData || {};
    const errCode = String(errObj?.code || errData?.code || "");
    const errMsg = String(
      errObj?.message || errData?.message || error.message || "",
    );

    console.error("CareContext: Link error", errData || error.message);

    // "Duplicate HIP link request" — ABDM already received this link request.
    // This does NOT guarantee it was successfully linked (ABDM-1006 on notify proves otherwise).
    // Treat as a soft no-op: don't increment attempts, don't clear token, don't mark LINKED.
    const isDuplicate = /duplicate.*link/i.test(errMsg);
    if (isDuplicate) {
      // Forcefully advance to LINKED so health data can be pushed
      await CareContextModel.updateOne(
        { _id: careContextId },
        {
          $set: {
            linkingStatus: CareContextStatus.LINKED,
            linkedAt: new Date(),
            linkError: null,
          },
        },
      );
      // Trigger a notify attempt in the background
      setTimeout(async () => {
        try {
          const ctx = await CareContextModel.findById(careContextId);
          if (ctx) await notifyContext(ctx);
        } catch (e) {}
      }, 2000);
      return true;
    }

    const isMismatch =
      errCode.includes("9999") && /mismatch.*link token/i.test(errMsg);

    const ctx = await CareContextModel.findById(careContextId);
    if (isMismatch && ctx?.patientId) {
      await PatientModel.updateOne(
        { _id: ctx.patientId },
        { $unset: { abdmLinkToken: 1 } },
      );
    }
    const newStatus =
      ctx && ctx.linkAttempts >= MAX_LINK_ATTEMPTS
        ? CareContextStatus.FAILED
        : CareContextStatus.PENDING;

    await CareContextModel.updateOne(
      { _id: careContextId },
      {
        $set: {
          linkingStatus: newStatus,
          linkError: errData || { message: error.message },
        },
      },
    );

    return false;
  }
};

/**
 * Link all pending Care Contexts for a patient.
 */
export const linkPendingCareContexts = async (
  patientId: Types.ObjectId | string,
  authToken?: string,
): Promise<number> => {
  // Get ABDM token once for all linking calls
  const abdmToken = authToken || (await AbdmTokenService.getToken());

  const pendingContexts = await CareContextModel.find({
    patientId,
    linkingStatus: { $in: [CareContextStatus.PENDING] },
    linkAttempts: { $lt: MAX_LINK_ATTEMPTS },
  }).sort({ createdAt: 1 });

  let linked = 0;
  for (const context of pendingContexts) {
    const success = await linkCareContext(context._id, abdmToken);
    if (success) linked++;
  }
  return linked;
};

/**
 * Link all pending Care Contexts for an ABHA address.
 */
export const linkPendingCareContextsByAbhaAddress = async (
  abhaAddress: string,
  authToken?: string,
): Promise<number> => {
  const patient = await PatientModel.findOne({ abhaaddress: abhaAddress });
  if (!patient) {
    return 0;
  }

  return linkPendingCareContexts(patient._id, authToken);
};

export const notifyContext = async (
  careContext: ICareContext,
  authToken?: string,
): Promise<boolean> => {
  try {
    const patient = await PatientModel.findById(careContext.patientId);
    if (!patient) {
      console.error("CareContext notifyContext: Patient not found");
      return false;
    }

    // ABDM requires patient.id (abhaAddress) for context/notify. Without it, PHR cannot show records.
    if (!patient.abhaaddress?.trim()) {
      console.error(
        "CareContext notifyContext: Patient has no abhaAddress (required for ABDM). " +
          "Discovery flow should persist ABHA from Gateway profile at link/init.",
      );
      return false;
    }

    // If no valid link token, request one (per requirement: create token instead of failing).
    const linkToken = isLinkTokenValid(patient)
      ? patient.abdmLinkToken?.token
      : undefined;
    if (!linkToken && (patient.abhaaddress || patient.ABHANumber)) {
      setImmediate(() => {
        requestLinkToken(patient).catch((err) =>
          console.warn(
            "CareContext notifyContext: link token request failed:",
            err?.message,
          ),
        );
      });
    }

    const abdmToken = authToken || (await AbdmTokenService.getToken());
    const requestId = generateUID();

    // Resolve the canonical hiType using centralized resolver.
    // NEVER use hiTypes[0] — it can be wrong for contaminated legacy CCs.
    const resolvedHiType = await resolveCanonicalHiType(careContext);

    // Persist the resolved type back to DB if it wasn't set
    // (fixes legacy CCs and prevents re-detection on future calls)
    if (!careContext.hiType && resolvedHiType) {
      await CareContextModel.updateOne(
        { _id: careContext._id },
        { $set: { hiType: resolvedHiType, hiTypes: [resolvedHiType] } },
      );
    }

    // ALWAYS send exactly [resolvedHiType] — never the raw hiTypes array.
    // Even in legacy mode, sending multiple types per CC is wrong per ABDM spec.
    const notifyHiTypes: string[] = [resolvedHiType];
    console.log(
      `[HITYPE-DEBUG] notifyContext: cc=${careContext.careContextReference} db.hiType=${careContext.hiType} db.hiTypes=${JSON.stringify(careContext.hiTypes)} resolved=${resolvedHiType} SENDING notify.hiTypes=${JSON.stringify(notifyHiTypes)}`,
    );

    console.info(
      "[ABDM Payload] context/notify constructed",
      JSON.stringify({
        endpoint: "context/notify",
        careContextRef: careContext.careContextReference,
        patientRef: patient.uhid || patient._id.toString(),
        hiType: resolvedHiType,
        careContexts: [careContext.careContextReference],
      }),
    );

    const payload = {
      notification: {
        patient: {
          id: patient.abhaaddress.trim(),
        },
        careContext: {
          patientReference: patient.uhid || patient._id.toString(),
          careContextReference: careContext.careContextReference,
        },
        hiTypes: notifyHiTypes,
        date: new Date().toISOString(),
        hip: {
          id: facilityId,
        },
      },
    };

    const headers: any = {
      "Content-Type": "application/json",
      "REQUEST-ID": requestId,
      TIMESTAMP: new Date().toISOString(),
      "X-HIP-ID": X_HIP_ID,
      "X-CM-ID": X_CM_ID,
      Authorization: abdmToken,
    };

    if (linkToken) {
      headers["X-LINK-TOKEN"] = linkToken;
    }

    // Persist requestId before sending notify to avoid callback race,
    // where ABDM callback can arrive before axios returns.
    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          notifyRequestId: requestId,
          notifyError: null,
        },
      },
    );

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/hip/v3/link/context/notify`,
      payload,
      { headers },
    );
    if (response.status === 200 || response.status === 202) {
      return true;
    }

    return false;
  } catch (error: any) {
    console.error(
      "CareContext: context/notify error",
      error.response?.data || error.message,
    );
    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          notifyError: error.response?.data || { message: error.message },
        },
      },
    );
    return false;
  }
};

export const handleContextNotifyCallback = async (
  requestId: string,
  success: boolean,
  error?: any,
): Promise<void> => {
  const careContext = await CareContextModel.findOne({
    notifyRequestId: requestId,
  });
  if (!careContext) {
    return;
  }

  if (success) {
    await CareContextModel.updateOne(
      { _id: careContext._id },
      {
        $set: {
          linkingStatus: CareContextStatus.NOTIFIED,
          notifiedAt: new Date(),
          notifyError: null,
        },
      },
    );
    return;
  }

  const errMsg = String(error?.message || "");
  const errCode = String(error?.code || "");
  const isNotLinkedError =
    errCode.includes("1006") || /no care context linked/i.test(errMsg);

  await CareContextModel.updateOne(
    { _id: careContext._id },
    {
      $set: {
        linkingStatus: CareContextStatus.LINKED,
        notifyError: error || { message: "Context notify callback failed" },
      },
    },
  );

  if (isNotLinkedError) {
    try {
      // Reset linkAttempts so the forced re-link isn't blocked by MAX_LINK_ATTEMPTS
      await CareContextModel.updateOne(
        { _id: careContext._id },
        { $set: { linkAttempts: 0, linkingStatus: CareContextStatus.PENDING } },
      );
      const abdmToken = await AbdmTokenService.getToken();
      await linkCareContext(careContext._id, abdmToken, true);
      console.warn(
        "CareContext: on-context-notify returned ABDM-1006; forced re-link triggered for",
        careContext.careContextReference,
      );
    } catch (relinkErr: any) {
      console.error(
        "CareContext: Failed to force re-link after ABDM-1006:",
        relinkErr?.message || relinkErr,
      );
    }
  }
};

// ============================================================
// Callback Handlers
// ============================================================

/**
 * Handle Care Context link callback from ABDM (on-carecontext).
 * Updates status and triggers context/notify on success.
 */
export const handleLinkCallback = async (
  abhaAddress: string,
  requestId: string,
  success: boolean,
  error?: any,
): Promise<void> => {
  // Find the care context by requestId (we send this in the link API REQUEST-ID header)
  let careContext = await CareContextModel.findOne({
    linkRequestId: requestId,
  });

  // Fallback: ABDM sometimes echoes a different requestId; try to find by abhaAddress + LINKING
  if (!careContext && abhaAddress) {
    careContext = await CareContextModel.findOne({
      abhaAddress,
      linkingStatus: CareContextStatus.LINKING,
    }).sort({ lastLinkAttemptAt: -1 });
    if (careContext) {
      console.warn(
        "CareContext: Matched by abhaAddress+LINKING (requestId from callback did not match). Consider verifying ABDM callback sends same REQUEST-ID.",
      );
    }
  }

  if (!careContext) {
    return;
  }

  if (success) {
    // Mark as LINKED
    careContext.linkingStatus = CareContextStatus.LINKED;
    careContext.linkedAt = new Date();
    careContext.linkError = null;
    await careContext.save();
    // CRITICAL: Trigger context/notify to inform PHR apps
    // Add a 5 second delay to allow ABDM Sandbox to replicate the newly linked context
    // internally before we try to notify it, otherwise it throws ABDM-1006.
    setTimeout(async () => {
      try {
        await notifyContext(careContext);
      } catch (notifyError) {
        console.error(
          "CareContext: context/notify failed after linking",
          notifyError,
        );
        // Don't revert LINKED status - notify can be retried
      }
    }, 5000);
  } else {
    // Check if retryable based on link attempts
    const newStatus =
      careContext.linkAttempts >= MAX_LINK_ATTEMPTS
        ? CareContextStatus.FAILED
        : CareContextStatus.PENDING;

    careContext.linkingStatus = newStatus;
    careContext.linkError = error;
    await careContext.save();
  }
};

// ============================================================
// Query Helpers
// ============================================================

/**
 * Get all Care Contexts for a patient.
 */
export const getCareContextsByPatient = async (
  patientId: Types.ObjectId | string,
) => {
  return CareContextModel.find({ patientId }).sort({ createdAt: -1 }).lean();
};

/**
 * Get pending / retryable Care Contexts for admin dashboard.
 */
export const getPendingCareContexts = async (limit: number = 50) => {
  return CareContextModel.find({
    linkingStatus: {
      $in: [CareContextStatus.PENDING, CareContextStatus.FAILED],
    },
    linkAttempts: { $lt: MAX_LINK_ATTEMPTS },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .populate("patientId", "uhid name abhaaddress ABHANumber")
    .lean();
};

/**
 * Get care contexts that are LINKED but not yet NOTIFIED (for retry).
 */
export const getLinkedButNotNotified = async (limit: number = 50) => {
  return CareContextModel.find({
    linkingStatus: CareContextStatus.LINKED,
  })
    .sort({ linkedAt: 1 })
    .limit(limit)
    .populate("patientId", "uhid name abhaaddress ABHANumber abdmLinkToken")
    .lean();
};

/**
 * Mark expired link tokens on Patient records.
 */
export const markExpiredLinkTokens = async (): Promise<number> => {
  const result = await PatientModel.updateMany(
    {
      "abdmLinkToken.expiresAt": { $lt: new Date() },
      "abdmLinkToken.status": "ACTIVE",
    },
    {
      $set: { "abdmLinkToken.status": "EXPIRED" },
    },
  );
  return result.modifiedCount;
};

/**
 * Get all care contexts for an ABHA address (used by discovery flow).
 */
export const getCareContextsByAbhaAddress = async (abhaAddress: string) => {
  return CareContextModel.find({ abhaAddress }).sort({ createdAt: -1 }).lean();
};

// ============================================================
// Retroactive CareContext Creation (when ABHA linked after visits)
// ============================================================

/**
 * Detect which hiTypes should be assigned based on existing clinical data for a visit.
 *
 * Scans visit_prescriptions, visit_soap_notes, visit_lab_reports, etc.
 * to determine what health information types exist for this visit.
 */
export const detectHiTypesForVisit = async (
  visitId: Types.ObjectId | string,
): Promise<HIType[]> => {
  const hiTypes: Set<HIType> = new Set();

  const hasImmunizationEvidence = (imm: any): boolean => {
    if (!imm || typeof imm !== "object") return false;

    // Legacy flat fields
    if (
      imm.covid19Dose1Date ||
      imm.covid19Dose2Date ||
      imm.tetanusBoosterDate ||
      imm.fluVaccineDate
    ) {
      return true;
    }

    // Nested fields
    if (
      imm.covid19Dose1?.date ||
      imm.covid19Dose2?.date ||
      imm.tetanusBooster?.date ||
      imm.fluVaccine?.date
    ) {
      return true;
    }

    return false;
  };

  const [prescription, soapNotes, labReport, dischargeSummary, assessment] =
    await Promise.all([
      VisitPrescriptionModel.findOne({ visitId }).lean(),
      VisitSoapNotesModel.findOne({ visitId }).lean(),
      VisitLabReportModel.findOne({ visitId }).lean(),
      VisitDischargeSummaryModel.findOne({ visitId }).lean(),
      VisitAssessmentModel.findOne({ visitId }).lean(),
    ]);

  if (prescription && (prescription.medications?.length ?? 0) > 0) {
    hiTypes.add("Prescription");
  }

  // OPConsultation should be present only when SOAP notes exist.
  // Assessment data (symptoms, medicalHistory, surgicalHistory) is supplementary —
  // it gets included in the OPConsultation FHIR bundle when SOAP notes exist, but
  // should NOT by itself trigger an OPConsultation CareContext. Otherwise, saving
  // vitals or documents pollutes the CC with an unwanted OPConsultation hiType.
  if (
    soapNotes &&
    (soapNotes.subjective ||
      soapNotes.objective ||
      soapNotes.assessment ||
      soapNotes.plan)
  ) {
    hiTypes.add("OPConsultation");
  }

  if (labReport && (labReport.reports?.length ?? 0) > 0) {
    hiTypes.add("DiagnosticReport");
  }

  // Also check new structured lab reports (lab_reports collection)
  const newLabCount = await LabReportModel.countDocuments({ visitId });
  if (newLabCount > 0) {
    hiTypes.add("DiagnosticReport");
  }

  if (
    dischargeSummary &&
    (dischargeSummary.diagnosis || dischargeSummary.clinicalSummary)
  ) {
    hiTypes.add("DischargeSummary");
  }

  if (hasImmunizationEvidence(assessment?.immunization)) {
    hiTypes.add("ImmunizationRecord");
  }

  // WellnessRecord for vitals
  if (assessment?.vitals) {
    hiTypes.add("WellnessRecord");
  }

  // HealthDocumentRecord if uploaded documents exist
  if ((assessment as any)?.documentUploads?.length > 0) {
    hiTypes.add("HealthDocumentRecord");
  }

  // Invoice if billing data exists
  const billingCount = await VisitDayCareBilling.countDocuments({ visitId });
  if (billingCount > 0) {
    hiTypes.add("Invoice");
  }

  return Array.from(hiTypes) as HIType[];
};

/**
 * Create CareContexts for all existing visits when ABHA is linked retroactively.
 *
 * This should be called when:
 * 1. Patient.abhaaddress is set for the first time
 * 2. Patient had visits before ABHA was linked
 *
 * For each visit:
 * 1. Check if CareContext already exists
 * 2. If not, create CareContext with detected hiTypes
 * 3. Optionally trigger linking (if linkToken available)
 *
 * @param patientId - The patient ID
 * @param abhaAddress - The ABHA address to link
 * @param triggerLinking - If true, attempt to link with ABDM immediately
 * @returns Number of CareContexts created
 */
export const bulkUpdateCareContextsForPatient = async (
  patientId: Types.ObjectId | string,
  abhaAddress: string,
): Promise<number> => {
  try {
    const patient = await PatientModel.findById(patientId).lean();
    if (!patient) {
      return 0;
    }

    const patientReference = patient.uhid || patient._id.toString();

    // Single bulk update operation - FAST!
    const result = await CareContextModel.updateMany(
      {
        patientId,
        // Only update if abhaAddress is missing or different
        $or: [
          { abhaAddress: { $exists: false } },
          { abhaAddress: { $ne: abhaAddress } },
        ],
      },
      {
        $set: {
          abhaAddress,
          patientReference,
        },
      },
    );
    return result.modifiedCount;
  } catch (error: any) {
    console.error(
      "CareContext: bulkUpdateCareContextsForPatient error:",
      error.message,
    );
    return 0;
  }
};

export const createCareContextsForExistingVisits = async (
  patientId: Types.ObjectId | string,
  abhaAddress: string,
  triggerLinking: boolean = true,
): Promise<{ created: number; linked: number; errors: string[] }> => {
  const result = { created: 0, linked: 0, errors: [] as string[] };

  try {
    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      result.errors.push("Patient not found");
      return result;
    }

    const uhid = patient.uhid || patient._id.toString();

    // Collect all visits: from ScanShareVisit and Patient.visits[]
    const visitIds: Types.ObjectId[] = [];

    // 1. ScanShareVisits linked to this patient
    const scanShareVisits = await ScanShareVisitModel.find({
      patientId,
    }).lean();
    for (const v of scanShareVisits) {
      visitIds.push(v._id);
    }

    // 2. Embedded visits in Patient.visits[]
    if (patient.visits && patient.visits.length > 0) {
      for (const embeddedVisit of patient.visits) {
        if (embeddedVisit.visitId) {
          visitIds.push(new Types.ObjectId(embeddedVisit.visitId.toString()));
        }
      }
    }

    // Deduplicate visit IDs
    const uniqueVisitIds = Array.from(
      new Map(visitIds.map((id) => [id.toString(), id])).values(),
    );
    if (uniqueVisitIds.length === 0) {
      return result;
    }

    // ── STEP 1: Detect hiTypes for ALL visits concurrently ────────────────────
    const hiTypeResults = await Promise.all(
      uniqueVisitIds.map(async (visitId) => {
        try {
          const hiTypes = await detectHiTypesForVisit(visitId);
          return { visitId, hiTypes, error: null };
        } catch (err: any) {
          return { visitId, hiTypes: [] as HIType[], error: err.message };
        }
      }),
    );

    for (const r of hiTypeResults) {
      if (r.error) result.errors.push(`Visit ${r.visitId}: ${r.error}`);
    }

    // Flat list of (visitId, hiType) pairs to process
    const pairs = hiTypeResults.flatMap(({ visitId, hiTypes }) =>
      hiTypes.map((hiType) => ({ visitId, hiType })),
    );

    if (pairs.length === 0) {
      return result;
    }

    // ── STEP 2: Single batch query for all existing CCs ───────────────────────
    const existingCCs = await CareContextModel.find({
      patientId,
      $or: pairs.map(({ visitId, hiType }) => ({ visitId, hiType })),
    })
      .select("_id visitId hiType abhaAddress")
      .lean();

    const existingSet = new Set(
      existingCCs.map((cc) => `${cc.visitId}-${cc.hiType}`),
    );

    // ── STEP 3: Batch-fix stale abhaAddress on existing CCs in one shot ──────
    const staleIds = existingCCs
      .filter((cc) => !cc.abhaAddress || cc.abhaAddress !== abhaAddress)
      .map((cc) => cc._id);

    if (staleIds.length > 0) {
      await CareContextModel.updateMany(
        { _id: { $in: staleIds } },
        { $set: { abhaAddress } },
      );
    }

    // ── STEP 4: Build new CC docs for missing pairs concurrently ─────────────
    const newPairs = pairs.filter(
      ({ visitId, hiType }) => !existingSet.has(`${visitId}-${hiType}`),
    );

    if (newPairs.length > 0) {
      // Build visitDate lookup map (avoid repeated array scans)
      const visitDateMap = new Map<string, Date>();
      for (const v of scanShareVisits) {
        visitDateMap.set(v._id.toString(), v.visitDate);
      }
      for (const ev of patient.visits ?? []) {
        if (ev.visitId && ev.visitDate) {
          visitDateMap.set(ev.visitId.toString(), ev.visitDate);
        }
      }

      // Generate all CC references concurrently
      const newDocs = await Promise.all(
        newPairs.map(async ({ visitId, hiType }) => {
          const visitDate = visitDateMap.get(visitId.toString()) ?? new Date();
          const ccRef = await generateCareContextReference(uhid, visitDate);
          const hiTypeDisplay = HI_TYPE_DISPLAY_NAMES[hiType] || hiType;
          const ssVisit = scanShareVisits.find(
            (v) => v._id.toString() === visitId.toString(),
          );
          const display = generateDisplayText(
            hiTypeDisplay,
            ssVisit?.department,
            visitDate,
          );
          return {
            patientId: patient._id,
            visitId,
            careContextReference: ccRef,
            patientReference: uhid,
            abhaAddress,
            display,
            hiType,
            hiTypes: [hiType],
            linkingStatus: CareContextStatus.PENDING,
            linkAttempts: 0,
            facilityId,
            facilityName,
          };
        }),
      );

      // Batch insert — ordered:false so a single duplicate doesn't block the rest
      try {
        await CareContextModel.insertMany(newDocs, {
          ordered: false,
        } as any);
        result.created = newDocs.length;
      } catch (bulkErr: any) {
        // Partial inserts on duplicate key are ok (concurrent requests)
        const insertedCount =
          bulkErr.result?.insertedCount ?? bulkErr.insertedDocs?.length ?? 0;
        if (insertedCount > 0) {
          result.created = insertedCount;
          console.warn(
            `[CareContext] Retroactive: insertMany partial — ${result.created} inserted, some duplicates skipped`,
          );
        } else {
          result.errors.push(`insertMany error: ${bulkErr.message}`);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(err.message);
  }

  return result;
};

// ============================================================
// Export service object
// ============================================================

export const CareContextService = {
  // Utilities
  generateCareContextReference,
  generateDisplayText,
  isLinkTokenValid,
  calculateTokenExpiry,

  // Link Token
  storeLinkToken,
  storeLinkTokenByAbhaAddress,
  requestLinkToken,

  // CRUD
  createCareContextForVisit,
  createOrUpdateCareContextForVisit,
  createCareContextForHiType,
  addHiTypesForVisit,

  // HIP-Initiated Linking
  linkCareContext,
  linkPendingCareContexts,
  linkPendingCareContextsByAbhaAddress,

  // Context Notify
  notifyContext,

  // Callback Handlers
  handleLinkCallback,
  handleContextNotifyCallback,

  // Queries
  getCareContextsByPatient,
  getCareContextsByAbhaAddress,
  getPendingCareContexts,
  getLinkedButNotNotified,
  markExpiredLinkTokens,

  // Retroactive Creation (when ABHA linked after visits)
  detectHiTypesForVisit,
  createCareContextsForExistingVisits,
  bulkUpdateCareContextsForPatient,
};

export default CareContextService;
