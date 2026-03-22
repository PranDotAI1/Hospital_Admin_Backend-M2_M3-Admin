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
import {
  generateUID,
  facilityId,
  facilityName,
  X_HIP_ID,
  X_CM_ID,
  MAX_LINK_ATTEMPTS,
  LINK_TOKEN_VALIDITY_MONTHS,
  LINK_TOKEN_REQUEST_COOLDOWN_HOURS,
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

  return now < expiresAt;
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
  await PatientModel.updateOne(
    { _id: patientId },
    {
      $set: {
        "abdmLinkToken.token": linkToken,
        "abdmLinkToken.issuedAt": now,
        "abdmLinkToken.expiresAt": calculateTokenExpiry(),
        "abdmLinkToken.status": "ACTIVE",
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
        console.log(
          "CareContext: Skipping link token request (cooldown). Last requested",
          Math.round(hoursSince),
          "h ago. Retry after",
          LINK_TOKEN_REQUEST_COOLDOWN_HOURS,
          "h.",
        );
        return false;
      }
    }

    // Use refreshed patient data (abhaaddress/ABHANumber may have just been saved)
    const latestPatient = fresh as unknown as IPatient;
    if (!latestPatient.abhaaddress?.trim()) {
      console.log(
        "CareContext: Skipping link token request — patient has no abhaAddress stored.",
      );
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
      name: latestPatient.name || `${latestPatient.f_name} ${latestPatient.l_name || ""}`.trim(),
      gender: normalizeGenderForAbdm(latestPatient.gender),
      yearOfBirth: yearOfBirth || "",
    };
    if (abhaNumber14.length === 14) {
      payload.abhaNumber = abhaNumber14 ?? "";
    }

    console.log(
      "CareContext: Requesting link token with payload:",
      JSON.stringify(payload),
    );

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

    console.log(
      "CareContext: Link token requested, status:",
      response.status,
      "| ABDM will call your callback with the token. Ensure callback URL is reachable:",
      "POST /api/v3/hip/token/on-generate-token",
    );
    return isSuccess;
  } catch (error: any) {
    console.error(
      "CareContext: Error requesting link token",
      error.response?.data || error.message,
    );
    // Clear abdmLinkTokenRequestedAt on failure so retries are not blocked
    try {
      const patientId = patient._id?.toString();
      if (patientId) {
        await PatientModel.updateOne(
          { _id: patientId },
          { $unset: { abdmLinkTokenRequestedAt: 1 } },
        );
        console.log(
          "CareContext: Cleared abdmLinkTokenRequestedAt after failed token request for patient",
          patientId,
        );
      }
    } catch (clearErr) {
      console.warn("CareContext: Failed to clear abdmLinkTokenRequestedAt:", clearErr);
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
      console.log("[CareContext: Patient not found", patientId);
      return null;
    }

    // Check if context already exists for this visit
    const existingContext = await CareContextModel.findOne({
      patientId,
      visitId,
    });
    if (existingContext) {
      console.log("CareContext: Already exists for visit", visitId);
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

    // Deprecated combined model guard: keep one CareContext = one HI type.
    // Resolve type from actual visit data + requested types; never trust array order.
    const requestedTypes = Array.from(new Set(hiTypes || [])) as HIType[];
    const detectedTypes = await detectHiTypesForVisit(visitId);
    const matchedTypes = requestedTypes.filter((t) =>
      detectedTypes.includes(t),
    );

    const normalizedHiType: HIType =
      matchedTypes.find((t) => t !== "OPConsultation") ||
      matchedTypes[0] ||
      detectedTypes.find((t) => t !== "OPConsultation") ||
      detectedTypes[0] ||
      requestedTypes.find((t) => t !== "OPConsultation") ||
      requestedTypes[0] ||
      "OPConsultation";

    if (requestedTypes.length > 1 || matchedTypes.length > 1) {
      console.warn(
        "CareContext: createCareContextForVisit received multiple hiTypes; resolved single type",
        {
          requestedTypes,
          detectedTypes,
          matchedTypes,
          normalizedHiType,
          visitId: String(visitId),
        },
      );
    }

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

    console.log("CareContext: Created", careContext.careContextReference);

    if (patient.abhaaddress) {
      if (isLinkTokenValid(patient)) {
        console.log(
          "CareContext: Patient has valid link token, auto-linking...",
        );
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
        console.log(
          "CareContext: No valid link token for patient",
          patient.uhid || patient._id,
          "-> requesting link token from ABDM (cooldown-protected)",
        );
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
      console.log(
        "CareContext: Patient has no ABHA address. Context created locally. Skipping ABDM linking.",
      );
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
 * Create or update a single CareContext for a visit, adding the given hiType.
 *
 * One-CareContext-per-visit model: all HI types for a single visit
 * are accumulated in one CareContext's hiTypes array, but each type
 * gets its own separate FHIR bundle when data is pushed to ABDM.
 *
 * Idempotent: if a CareContext already exists for (patientId, visitId),
 * the hiType is added to its hiTypes array (if not already present).
 */
export const createOrUpdateCareContextForVisit = async (
  patientId: Types.ObjectId | string,
  visitId: Types.ObjectId | string,
  hiType: HIType,
): Promise<ICareContext | null> => {
  try {
    const patient = await PatientModel.findById(patientId);
    if (!patient) {
      console.log(
        "[CareContext] createOrUpdateCareContextForVisit: Patient not found",
        patientId,
      );
      return null;
    }

    // Check if a CareContext already exists for this visit
    const existingContext = await CareContextModel.findOne({
      patientId,
      visitId,
    });
    if (existingContext) {
      // Add the new hiType to the existing context (idempotent via $addToSet)
      const alreadyHasType = Array.isArray(existingContext.hiTypes) && existingContext.hiTypes.includes(hiType);
      if (!alreadyHasType) {
        await CareContextModel.updateOne(
          { _id: existingContext._id },
          { $addToSet: { hiTypes: hiType } },
        );
        existingContext.hiTypes = [...(existingContext.hiTypes || []), hiType];
        console.log(
          "CareContext: Added hiType",
          hiType,
          "to existing context for visit",
          visitId,
          "-> hiTypes:",
          existingContext.hiTypes,
        );
      } else {
        console.log(
          "CareContext: Already has hiType",
          hiType,
          "for visit",
          visitId,
        );
      }

      // Existing context may still need sync actions after clinical updates.
      if (patient.abhaaddress) {
        if (
          existingContext.linkingStatus === CareContextStatus.LINKED ||
          existingContext.linkingStatus === CareContextStatus.NOTIFIED
        ) {
          setImmediate(async () => {
            try {
              await notifyContext(existingContext);
            } catch (err) {
              console.warn(
                "CareContext: notify retry failed for existing context:",
                (err as any)?.message || err,
              );
            }
          });
        } else {
          if (isLinkTokenValid(patient)) {
            setImmediate(async () => {
              try {
                const abdmToken = await AbdmTokenService.getToken();
                await linkCareContext(existingContext._id, abdmToken);
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
        }
      }

      return existingContext;
    }

    // Get visit details for display
    const visit = await ScanShareVisitModel.findById(visitId);
    const department = visit?.department;
    const visitDate = visit?.visitDate || new Date();

    const patientRef = patient.uhid || patient._id.toString();

    // Generate unique care context reference
    const careContextReference = await generateCareContextReference(
      patientRef,
      visitDate,
    );

    // Display text uses generic "OPD Visit" since one context covers all HI types
    const display = generateDisplayText("OPD Visit", department, visitDate);

    // Create care context record with the initial hiType
    // Retry with new reference if duplicate key error (E11000) on careContextReference occurs
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
        // Duplicate key on (patientId, visitId) means another request created it
        // between our findOne and create. Just find and update it.
        if (
          createErr?.code === 11000 &&
          (createErr?.keyPattern?.patientId ||
            createErr?.keyPattern?.visitId ||
            String(createErr?.message || "").includes("patientId_1_visitId_1"))
        ) {
          console.log(
            "CareContext: Concurrent creation detected for visit",
            visitId,
            "— merging hiType",
            hiType,
          );
          const raceContext = await CareContextModel.findOneAndUpdate(
            { patientId, visitId },
            { $addToSet: { hiTypes: hiType } },
            { new: true },
          );
          if (raceContext) return raceContext;
          return null;
        }

        // Duplicate careContextReference collision — retry with new ref
        if (createErr.code === 11000 && retries > 1) {
          retries--;
          console.warn(
            "CareContext: Duplicate reference collision, retrying...",
            retries,
            "attempts left",
          );
          continue;
        }
        throw createErr;
      }
    }

    console.log(
      "CareContext: Created for visit",
      visitId,
      "with hiType",
      hiType,
      "->",
      careContext.careContextReference,
    );

    if (patient.abhaaddress) {
      if (isLinkTokenValid(patient)) {
        console.log(
          "CareContext: Patient has valid link token, auto-linking...",
        );
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
        console.log(
          "CareContext: No valid link token for patient",
          patient.uhid || patient._id,
          "-> requesting link token from ABDM (cooldown-protected)",
        );
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
      console.log(
        "CareContext: Patient has no ABHA address. Context created locally. Skipping ABDM linking.",
      );
    }

    return careContext;
  } catch (error) {
    console.error("CareContext: Error in createOrUpdateCareContextForVisit", hiType, error);
    return null;
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
    const ctx = await createOrUpdateCareContextForVisit(patientId, visitId, hiType);
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
      console.log("CareContext: Not found for linking", careContextId);
      return false;
    }

    if (
      !force &&
      (careContext.linkingStatus === CareContextStatus.LINKED ||
        careContext.linkingStatus === CareContextStatus.NOTIFIED)
    ) {
      console.log("CareContext: Already linked", careContextId);
      return true;
    }

    // Check max attempts
    if (careContext.linkAttempts >= MAX_LINK_ATTEMPTS) {
      console.log("CareContext: Max attempts reached", careContextId);
      careContext.linkingStatus = CareContextStatus.FAILED;
      careContext.linkError = { message: "Maximum link attempts reached" };
      await careContext.save();
      return false;
    }

    // Get patient and check link token
    const patient = await PatientModel.findById(careContext.patientId);
    if (!patient) {
      console.log("CareContext: Patient not found", careContext.patientId);
      return false;
    }

    if (!isLinkTokenValid(patient)) {
      console.log(
        "CareContext: No valid link token for patient",
        patient._id,
        "-> requesting token (no error thrown)",
      );
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
        patient.ABHANumber ? "***" : "missing",
      );
      careContext.linkingStatus = CareContextStatus.PENDING;
      careContext.linkError = {
        message: "ABHA number must be 14 digits for ABDM link",
      };
      await careContext.save();
      return false;
    }
    const payload = {
      abhaNumber: abhaNumber14,
      abhaAddress: normalizeAbhaAddress(patient.abhaaddress),
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
          hiType:
            careContext.hiType || careContext.hiTypes[0] || "Prescription",
          count: 1,
        },
      ],
    };

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

    console.log("CareContext: Link API response", response.status);

    // 200 or 202 = request accepted, wait for callback
    if (response.status === 200 || response.status === 202) {
      return true;
    }

    return false;
  } catch (error: any) {
    const errData = error.response?.data;
    const errMsg = errData?.message ?? error.message ?? "";
    const isMismatch =
      String(errData?.code || "").includes("9999") ||
      /mismatch.*link token/i.test(errMsg);

    console.error("CareContext: Link error", errData || error.message);

    const ctx = await CareContextModel.findById(careContextId);
    if (isMismatch && ctx?.patientId) {
      await PatientModel.updateOne(
        { _id: ctx.patientId },
        { $unset: { abdmLinkToken: 1 } },
      );
      console.log(
        "CareContext: Cleared link token due to ABHA mismatch; a new token will be requested on next attempt.",
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

  console.log(
    `CareContext: Linked ${linked}/${pendingContexts.length} for patient ${patientId}`,
  );
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
    console.log("CareContext: No patient found for ABHA address", abhaAddress);
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

    // Resolve the primary hiType for ABDM notify payload.
    // The CareContext may have multiple hiTypes (one per visit), but ABDM link/notify
    // needs a single primary type. Use hiType field (set at creation time).
    let resolvedHiType = careContext.hiType || careContext.hiTypes?.[0];
    if (!resolvedHiType && careContext.visitId) {
      try {
        const detectedTypes = await detectHiTypesForVisit(careContext.visitId);
        const specific = detectedTypes.find((t) => t !== "OPConsultation");
        resolvedHiType =
          specific || detectedTypes[0] || careContext.hiTypes?.[0];
        if (resolvedHiType && !careContext.hiType) {
          // Set primary hiType if not set yet
          await CareContextModel.updateOne(
            { _id: careContext._id },
            { $set: { hiType: resolvedHiType } },
          );
          console.log(
            `CareContext notifyContext: Set primary hiType for context ${careContext.careContextReference} → ${resolvedHiType}`,
          );
        }
      } catch (detectErr: any) {
        console.warn(
          "CareContext notifyContext: hiType detection failed (non-blocking):",
          detectErr.message,
        );
      }
    }
    if (!resolvedHiType) {
      console.error(
        "CareContext notifyContext: Unable to resolve a single hiType; skipping notify",
        {
          careContextId: String(careContext._id),
          hiType: careContext.hiType,
          hiTypes: careContext.hiTypes,
        },
      );
      return false;
    }

    // Ensure primary hiType is set on the CareContext.
    if (!careContext.hiType && resolvedHiType) {
      await CareContextModel.updateOne(
        { _id: careContext._id },
        { $set: { hiType: resolvedHiType } },
      );
    }

    const payload = {
      notification: {
        patient: {
          id: patient.abhaaddress.trim(),
        },
        careContext: {
          patientReference: patient.uhid || patient._id.toString(),
          careContextReference: careContext.careContextReference,
        },
        // Send ALL hiTypes so PHR shows all record types for this visit
        hiTypes: Array.isArray(careContext.hiTypes) && careContext.hiTypes.length > 0
          ? careContext.hiTypes
          : [resolvedHiType],
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

    console.log("CareContext: context/notify response", response.status);

    if (response.status === 200 || response.status === 202) {
      console.log(
        "CareContext: context/notify accepted (awaiting callback ack) for",
        careContext.careContextReference,
      );
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
    console.log(
      "CareContext: No care context found for context-notify requestId:",
      requestId,
    );
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
    console.log(
      "CareContext: Context-notify ACK success for",
      careContext.careContextReference,
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
    console.log(
      "CareContext: No care context found for requestId:",
      requestId,
      "| Ensure ABDM callback sends response.requestId equal to the REQUEST-ID header you sent in link/carecontext.",
    );
    return;
  }

  if (success) {
    // Mark as LINKED
    careContext.linkingStatus = CareContextStatus.LINKED;
    careContext.linkedAt = new Date();
    careContext.linkError = null;
    await careContext.save();

    console.log(
      "CareContext: Marked as LINKED",
      careContext.careContextReference,
    );

    // CRITICAL: Trigger context/notify to inform PHR apps
    try {
      await notifyContext(careContext);
    } catch (notifyError) {
      console.error(
        "CareContext: context/notify failed after linking",
        notifyError,
      );
      // Don't revert LINKED status - notify can be retried
    }
  } else {
    // Check if retryable based on link attempts
    const newStatus =
      careContext.linkAttempts >= MAX_LINK_ATTEMPTS
        ? CareContextStatus.FAILED
        : CareContextStatus.PENDING;

    careContext.linkingStatus = newStatus;
    careContext.linkError = error;
    await careContext.save();

    console.log(
      "CareContext: Link failed, status set to",
      newStatus,
      "attempts:",
      careContext.linkAttempts,
    );
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

  // OPConsultation should be present only when OP consultation clinical data exists.
  // Do not auto-add it for every visit, otherwise unrelated contexts (e.g. DiagnosticReport)
  // get mislabeled as "Prescription, OPConsultation" in downstream views.
  if (
    (soapNotes &&
      (soapNotes.subjective ||
        soapNotes.objective ||
        soapNotes.assessment ||
        soapNotes.plan)) ||
    (assessment &&
      (assessment.symptomsComplaints ||
        (assessment.medicalHistory?.length ?? 0) > 0 ||
        (assessment.surgicalHistory?.length ?? 0) > 0 ||
        assessment.physicalActivity ||
        assessment.lifestyle ||
        assessment.womenHealth))
  ) {
    hiTypes.add("OPConsultation");
  }

  if (labReport && (labReport.reports?.length ?? 0) > 0) {
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

  // WellnessRecord for vitals, HealthDocumentRecord if we store documents
  if (assessment?.vitals) {
    hiTypes.add("WellnessRecord");
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
      console.log(
        "CareContext: bulkUpdateCareContextsForPatient - Patient not found",
      );
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

    console.log(
      `CareContext: Bulk updated ${result.modifiedCount} care contexts with ABHA for patient ${patientId}`,
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

    console.log(
      `[CareContext] Retroactive: Found ${visitIds.length} visits for patient ${uhid}`,
    );

    if (visitIds.length === 0) {
      console.log(`[CareContext] Retroactive: No visits to process`);
      return result;
    }

    // Process each visit
    for (const visitId of visitIds) {
      try {
        // Detect hiTypes from existing clinical data
        const hiTypes = await detectHiTypesForVisit(visitId);
        console.log(
          `[CareContext] Retroactive: Detected hiTypes for visit ${visitId}:`,
          hiTypes,
        );

        // Create a separate CareContext for each detected HI type
        for (const hiType of hiTypes) {
          // Check if CareContext already exists for this (patientId, visitId, hiType)
          const existingCC = await CareContextModel.findOne({
            patientId,
            visitId,
            hiType,
          });
          if (existingCC) {
            // Update abhaAddress if needed
            if (
              !existingCC.abhaAddress ||
              existingCC.abhaAddress !== abhaAddress
            ) {
              await CareContextModel.updateOne(
                { _id: existingCC._id },
                { $set: { abhaAddress } },
              );
            }
            continue;
          }

          // Get visit date for display text
          let visitDate = new Date();
          const ssVisit = scanShareVisits.find(
            (v) => v._id.toString() === visitId.toString(),
          );
          if (ssVisit) {
            visitDate = ssVisit.visitDate;
          } else {
            const embeddedVisit = patient.visits?.find(
              (v) => v.visitId?.toString() === visitId.toString(),
            );
            if (embeddedVisit?.visitDate) {
              visitDate = embeddedVisit.visitDate;
            }
          }

          // Generate care context reference
          const ccRef = await generateCareContextReference(uhid, visitDate);
          const hiTypeDisplay = HI_TYPE_DISPLAY_NAMES[hiType] || hiType;
          const display = generateDisplayText(
            hiTypeDisplay,
            ssVisit?.department,
            visitDate,
          );

          // Create CareContext for this specific HI type
          const newCC = await CareContextModel.create({
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
          });

          result.created++;
          console.log(
            `[CareContext] Retroactive: Created CareContext ${ccRef} for hiType: ${hiType}`,
          );

          // Trigger linking if requested and patient has valid link token
          if (triggerLinking && isLinkTokenValid(patient)) {
            try {
              const linked = await linkCareContext(newCC._id);
              if (linked) {
                result.linked++;
              }
            } catch (linkErr: any) {
              console.error(
                `[CareContext] Retroactive: Link error for ${ccRef}:`,
                linkErr.message,
              );
            }
          }
        }
      } catch (visitErr: any) {
        result.errors.push(`Visit ${visitId}: ${visitErr.message}`);
      }
    }

    console.log(
      `[CareContext] Retroactive: Created ${result.created}, Linked ${result.linked}, Errors ${result.errors.length}`,
    );
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
