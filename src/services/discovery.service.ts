import { PatientModel, IPatient } from "../models/Patient";
import {
  CareContextModel,
  CareContextStatus,
  ICareContext,
} from "../models/CareContext";
import { formatAbhaForStorage } from "../utils/common";

const normalizeGender = (g: string) => {
  if (!g) return "";
  const upper = g.toUpperCase();
  if (upper.startsWith("M")) return "M";
  if (upper.startsWith("F")) return "F";
  if (upper.startsWith("O")) return "O";
  return upper;
};

const normalizeMobile = (s: string): string => {
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10 && digits.startsWith("91")) {
    return digits.slice(2);
  }
  return digits;
};

interface DiscoveryIdentifier {
  type: string;
  value: string;
}

interface DiscoveryPatientInfo {
  id: string;
  name: string;
  gender: string;
  yearOfBirth: number;
  verifiedIdentifiers: DiscoveryIdentifier[];
  unverifiedIdentifiers?: DiscoveryIdentifier[];
}

interface DiscoveryCareContext {
  referenceNumber: string;
  display: string;
  hiType?: string; // Included so onDiscover can group correctly by actual type
}

interface DiscoveryPatientResult {
  referenceNumber: string;
  display: string;
  careContexts: DiscoveryCareContext[];
  matchedBy: string[];
}

const isNamePhoneticallySimilar = (name1: string, name2: string): boolean => {
  const normalize = (n: string) =>
    n
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .trim()
      .split(/\s+/)
      .sort()
      .join(" ");

  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (n1 === n2) return true;

  if (n1.includes(n2) || n2.includes(n1)) return true;

  const parts1 = n1.split(" ");
  const parts2 = n2.split(" ");
  if (parts1[0] === parts2[0]) return true;

  const soundex = (s: string): string => {
    if (!s) return "";
    const a = s.toLowerCase().split("");
    const codes: Record<string, string> = {
      b: "1",
      f: "1",
      p: "1",
      v: "1",
      c: "2",
      g: "2",
      j: "2",
      k: "2",
      q: "2",
      s: "2",
      x: "2",
      z: "2",
      d: "3",
      t: "3",
      l: "4",
      m: "5",
      n: "5",
      r: "6",
    };
    const result = [a[0].toUpperCase()];
    let prev = codes[a[0]] || "";
    for (let i = 1; i < a.length && result.length < 4; i++) {
      const code = codes[a[i]] || "";
      if (code && code !== prev) {
        result.push(code);
      }
      prev = code || prev;
    }
    return result.join("").padEnd(4, "0");
  };

  if (soundex(parts1[0]) === soundex(parts2[0])) return true;

  return false;
};

const getAgeFromYearOfBirth = (yearOfBirth: number): number => {
  return new Date().getFullYear() - yearOfBirth;
};

const getPatientYearOfBirth = (patient: IPatient): number | null => {
  if (patient.dob) {
    const d = new Date(patient.dob);
    if (!isNaN(d.getTime())) return d.getFullYear();
    const match = patient.dob.match(/\d{4}/);
    if (match) return parseInt(match[0], 10);
  }
  if (patient.age) {
    const age = parseInt(patient.age, 10);
    if (!Number.isNaN(age)) return new Date().getFullYear() - age;
  }
  return null;
};

const buildDiscoveryResult = async (
  patient: IPatient,
  matchedBy: string[],
): Promise<DiscoveryPatientResult> => {
  const careContexts = await CareContextModel.find({
    patientId: patient._id,
    // linkingStatus: {
    //   $nin: [CareContextStatus.LINKED],
    // },
  })
    .sort({ createdAt: -1 })
    .lean();

  const displayName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();

  const referenceNumber = patient.uhid || patient._id.toString();
  return {
    referenceNumber: referenceNumber,
    display: displayName,
    // Include hiType from the CC's canonical field.
    // onDiscover groups by (cc as any).hiType || "OPConsultation"
    careContexts: careContexts.map((cc) => ({
      referenceNumber: cc.careContextReference,
      display: cc.display,
      hiType:
        (cc as any).hiType ||
        ((cc as any).hiTypes && (cc as any).hiTypes[0]) ||
        "OPConsultation",
    })),
    matchedBy,
  };
};

export const discoverPatient = async (
  patientInfo: DiscoveryPatientInfo,
): Promise<DiscoveryPatientResult[]> => {
  const addPatientToMap = (
    map: Map<string, { patient: IPatient; matchedBy: Set<string> }>,
    patient: IPatient,
    tags: string[],
  ) => {
    const pid = patient._id.toString();
    if (!map.has(pid)) {
      map.set(pid, { patient, matchedBy: new Set(tags) });
    } else {
      const existing = map.get(pid)!;
      tags.forEach((t) => existing.matchedBy.add(t));
    }
  };

  const resultsMap = new Map<
    string,
    { patient: IPatient; matchedBy: Set<string> }
  >();

  // --- Step 1: Search by ABHA Address or 14-digit ABHA Number ---
  const targetAbha = (patientInfo.id || "").trim().toLowerCase();
  const allIdentifiers = [
    ...(patientInfo.verifiedIdentifiers || []),
    ...(patientInfo.unverifiedIdentifiers || []),
  ];

  const abhaFromVerified = allIdentifiers.find((id) =>
    ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type),
  );
  const abhaAddressToMatch =
    targetAbha || (abhaFromVerified?.value?.trim().toLowerCase() ?? "");

  // Anti-conflict guard: Candidate patients must NOT be linked to a DIFFERENT ABHA address!
  const noConflictingAbhaFilter: any = abhaAddressToMatch
    ? {
        $or: [
          { abhaaddress: { $exists: false } },
          { abhaaddress: null },
          { abhaaddress: "" },
          {
            abhaaddress: new RegExp(
              `^${abhaAddressToMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i",
            ),
          },
        ],
      }
    : {};

  // Stage 1A: Direct ABHA Address match (Authoritative: this exact account)
  if (abhaAddressToMatch) {
    const byExactAbha = (await PatientModel.find({
      abhaaddress: new RegExp(
        `^${abhaAddressToMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    }).lean()) as unknown as IPatient[];

    if (byExactAbha.length > 0) {
      for (const p of byExactAbha) {
        addPatientToMap(resultsMap, p, ["ABHA_NUMBER"]);
      }
      const results: DiscoveryPatientResult[] = [];
      for (const item of resultsMap.values()) {
        results.push(
          await buildDiscoveryResult(item.patient, Array.from(item.matchedBy)),
        );
      }
      const withCareContexts = results.filter((r) => r.careContexts.length > 0);
      if (withCareContexts.length > 0) return withCareContexts;

      // If this exact patient has no care contexts, return [] immediately.
      // NEVER fall through to other patients with the same ABHA number or mobile!
      return [];
    }
  }

  // Stage 1B: Search unlinked patient by 14-digit ABHA Number
  const abhaNumberTypes = [
    "ABHA_NUMBER",
    "abha_number",
    "HEALTH_NUMBER",
    "healthNumber",
    "HEALTH_ID_NUMBER",
    "healthIdNumber",
    "abhaNumber",
    "ABHANumber",
  ];

  const abhaNumObj = allIdentifiers.find(
    (id) =>
      abhaNumberTypes.includes(id.type) &&
      !id.value?.includes("@") &&
      id.value?.replace(/\D/g, "").length >= 14,
  );

  if (abhaNumObj?.value) {
    const rawNum = abhaNumObj.value;
    const cleanDigits = rawNum.replace(/\D/g, "");
    const formatted = formatAbhaForStorage(rawNum);

    const abhaNumQueries: any[] = [];
    if (formatted) abhaNumQueries.push({ ABHANumber: formatted });
    if (cleanDigits) abhaNumQueries.push({ ABHANumber: cleanDigits });
    if (cleanDigits.length === 14) {
      const hyphenated = `${cleanDigits.slice(0, 2)}-${cleanDigits.slice(2, 6)}-${cleanDigits.slice(6, 10)}-${cleanDigits.slice(10, 14)}`;
      abhaNumQueries.push({ ABHANumber: hyphenated });
    }

    const byAbhaNum = (await PatientModel.find({
      $and: [
        { $or: abhaNumQueries },
        noConflictingAbhaFilter,
        { isMerged: { $ne: true } },
        { status: { $ne: "merged" } },
      ],
    }).lean()) as unknown as IPatient[];

    if (byAbhaNum.length > 0) {
      for (const p of byAbhaNum) {
        addPatientToMap(resultsMap, p, ["ABHA_NUMBER"]);
      }
      const results: DiscoveryPatientResult[] = [];
      for (const item of resultsMap.values()) {
        results.push(
          await buildDiscoveryResult(item.patient, Array.from(item.matchedBy)),
        );
      }
      const withCareContexts = results.filter((r) => r.careContexts.length > 0);
      if (withCareContexts.length > 0) return withCareContexts;

      return [];
    }
  }

  // --- Step 2: Demographic / Mobile Fallback ---
  const mobileIdentifier = allIdentifiers.find(
    (id) => id.type === "MOBILE",
  );
  const mobileRaw = mobileIdentifier?.value?.trim();
  const mobileNorm = mobileRaw ? normalizeMobile(mobileRaw) : "";
  const mobile = mobileRaw || undefined;

  if (mobile && mobileNorm) {
    const mobilePatients = (await PatientModel.find({
      $and: [
        { $or: [{ mobile }, { mobile: mobileNorm }] },
        noConflictingAbhaFilter,
        { isMerged: { $ne: true } },
        { status: { $ne: "merged" } },
      ],
    }).lean()) as unknown as IPatient[];

    // Matched records (from mobile). Only MR may come as unverified identifier: when present, match matched records with MR; else return all mobile-matched.
    const mrValues: string[] = [];
    (patientInfo.unverifiedIdentifiers || []).forEach((id) => {
      if (id.type === "MR" && id.value?.trim()) mrValues.push(id.value.trim());
    });

    // Demographic validation fields from the discovery request
    const reqGender = patientInfo.gender
      ? normalizeGender(patientInfo.gender)
      : "";
    const reqYoB = patientInfo.yearOfBirth || 0;
    const reqName = patientInfo.name?.trim() || "";

    const mobileCandidates: {
      patient: IPatient;
      tags: string[];
      demographicScore: number;
    }[] = [];

    for (const patient of mobilePatients) {
      const tags: string[] = ["MOBILE"];
      if (mrValues.length > 0) {
        const uhid = (patient.uhid || "").trim();
        const idStr = patient._id?.toString() || "";
        const matchesMr = mrValues.some((mr) => {
          const m = mr.trim();
          if (!m) return false;
          if (uhid && (uhid === m || uhid.toLowerCase() === m.toLowerCase()))
            return true;
          if (idStr && m === idStr) return true;
          if (/^[0-9a-fA-F]{24}$/.test(m) && idStr === m) return true;
          return false;
        });
        if (matchesMr) tags.push("MR");
        else continue; // when MR in unverifiedIdentifiers: only include records that match MR
      }

      // --- Demographic validation per ABDM standards ---
      // Apply scoring: gender + yearOfBirth must partially match to be included
      let demographicScore = 0;
      if (reqGender && patient.gender) {
        if (normalizeGender(patient.gender) === reqGender)
          demographicScore += 1;
        else demographicScore -= 1;
      }
      if (reqYoB) {
        const patientYoB = getPatientYearOfBirth(patient);
        if (patientYoB != null) {
          if (Math.abs(patientYoB - reqYoB) <= 2) demographicScore += 1;
          else if (Math.abs(patientYoB - reqYoB) > 5) demographicScore -= 1;
        }
      }
      if (reqName) {
        const pName =
          patient.name ||
          `${patient.f_name || ""} ${patient.l_name || ""}`.trim();
        if (pName && isNamePhoneticallySimilar(reqName, pName))
          demographicScore += 1;
      }

      // Filter out patients where both gender AND yearOfBirth mismatch
      if (demographicScore < -1) continue;

      mobileCandidates.push({ patient, tags, demographicScore });
    }

    if (mobileCandidates.length > 0) {
      const candidatePatientIds = mobileCandidates.map((c) => c.patient._id);
      const patientIdsWithCC = new Set(
        (
          await CareContextModel.distinct("patientId", {
            patientId: { $in: candidatePatientIds },
          })
        ).map((id: any) => id.toString()),
      );

      mobileCandidates.sort((a, b) => {
        if (b.demographicScore !== a.demographicScore)
          return b.demographicScore - a.demographicScore;
        const aHasCC = patientIdsWithCC.has(a.patient._id.toString()) ? 1 : 0;
        const bHasCC = patientIdsWithCC.has(b.patient._id.toString()) ? 1 : 0;
        if (bHasCC !== aHasCC) return bHasCC - aHasCC;
        const getTime = (p: IPatient) => {
          if (p.createdAt) return new Date(p.createdAt).getTime();
          if (p._id && typeof (p._id as any).getTimestamp === "function") {
            return (p._id as any).getTimestamp().getTime();
          }
          return 0;
        };
        return getTime(b.patient) - getTime(a.patient);
      });

      const best = mobileCandidates[0];
      addPatientToMap(resultsMap, best.patient, best.tags);
    }
  }

  const sortedItems = Array.from(resultsMap.values()).sort((a, b) => {
    const getCreationTime = (p: IPatient) => {
      if (p.createdAt) return new Date(p.createdAt).getTime();
      if (p._id && typeof (p._id as any).getTimestamp === "function") {
        return (p._id as any).getTimestamp().getTime();
      }
      return 0;
    };
    return getCreationTime(b.patient) - getCreationTime(a.patient);
  });

  const results: DiscoveryPatientResult[] = [];
  for (const item of sortedItems) {
    results.push(
      await buildDiscoveryResult(item.patient, Array.from(item.matchedBy)),
    );
  }

  // Filter out any matched candidates who have 0 care contexts
  return results.filter((r) => r.careContexts.length > 0);
};

export interface LinkInitProfile {
  referenceNumber?: string;
  id?: string;
  name?: string;
  gender?: string;
  yearOfBirth?: number;
  verifiedIdentifiers?: { type: string; value: string }[];
  unverifiedIdentifiers?: { type: string; value: string }[];
}

export const extractAbhaFromProfile = (
  profile: LinkInitProfile,
): { abhaAddress?: string; abhaNumber?: string } => {
  let abhaAddress: string | undefined = profile.id?.trim();
  if (!abhaAddress && (profile.verifiedIdentifiers || []).length > 0) {
    const v = (profile.verifiedIdentifiers || []).find((id) =>
      ["ABHA_ADDRESS", "abhaAddress", "healthId", "NDHM_HEALTH_ID"].includes(
        id.type,
      ),
    );
    if (v?.value?.trim()) abhaAddress = v.value.trim();
  }
  if (!abhaAddress && (profile.unverifiedIdentifiers || []).length > 0) {
    const u = (profile.unverifiedIdentifiers || []).find((id) =>
      ["ABHA_ADDRESS", "abhaAddress", "healthId", "NDHM_HEALTH_ID"].includes(
        id.type,
      ),
    );
    if (u?.value?.trim()) abhaAddress = u.value.trim();
  }

  let abhaNumber: string | undefined;
  const allIds = [
    ...(profile.verifiedIdentifiers || []),
    ...(profile.unverifiedIdentifiers || []),
  ];
  const abhaNumberTypes = [
    "ABHA_NUMBER",
    "abha_number",
    "HEALTH_NUMBER",
    "healthNumber",
    "HEALTH_ID_NUMBER",
    "healthIdNumber",
    "abhaNumber",
    "ABHANumber",
  ];
  const numId = allIds.find(
    (id) =>
      abhaNumberTypes.includes(id.type) &&
      !id.value?.includes("@") &&
      id.value?.replace(/\D/g, "").length >= 14,
  );
  if (numId?.value) {
    const formatted = formatAbhaForStorage(numId.value);
    if (formatted) abhaNumber = formatted;
  }
  return { abhaAddress, abhaNumber };
};

export const identifyPatientForLink = async (
  profile: LinkInitProfile,
): Promise<IPatient | null> => {
  if (!profile) return null;

  const linkTargetAbha = (profile.id || "").trim().toLowerCase();

  // Priority 1: Direct referenceNumber match (UHID or ObjectId)
  const ref = profile.referenceNumber?.trim();
  if (ref) {
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(ref);
    const byRef = await PatientModel.findOne({
      $or: [
        {
          uhid: new RegExp(
            `^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i",
          ),
        },
        ...(isObjectId ? [{ _id: ref }] : []),
      ],
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    }).lean();
    if (byRef) {
      const candidateAbha = ((byRef as any).abhaaddress || "")
        .trim()
        .toLowerCase();
      if (
        !candidateAbha ||
        !linkTargetAbha ||
        candidateAbha === linkTargetAbha
      ) {
        return byRef as unknown as IPatient;
      }
    }
  }

  // Priority 2: Match by ABHA Number or ABHA Address
  const allIds = [
    ...(profile.verifiedIdentifiers || []),
    ...(profile.unverifiedIdentifiers || []),
  ];

  const abhaNumberTypes = [
    "ABHA_NUMBER",
    "abha_number",
    "HEALTH_NUMBER",
    "healthNumber",
    "HEALTH_ID_NUMBER",
    "healthIdNumber",
    "abhaNumber",
    "ABHANumber",
  ];
  const numId = allIds.find(
    (id) =>
      abhaNumberTypes.includes(id.type) &&
      !id.value?.includes("@") &&
      id.value?.replace(/\D/g, "").length >= 14,
  );

  const targetAbha = (profile.id || "").trim().toLowerCase();

  // Anti-conflict filter: A candidate patient must NOT be linked to a different ABHA address!
  const noConflictingAbhaFilter: any = targetAbha
    ? {
        $or: [
          { abhaaddress: { $exists: false } },
          { abhaaddress: null },
          { abhaaddress: "" },
          {
            abhaaddress: new RegExp(
              `^${targetAbha.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i",
            ),
          },
        ],
      }
    : {};

  // Priority 2A: Direct ABHA Address match
  if (targetAbha) {
    const byExactAbha = await PatientModel.findOne({
      abhaaddress: new RegExp(
        `^${targetAbha.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    }).lean();
    if (byExactAbha) return byExactAbha as unknown as IPatient;
  }

  // Priority 2B: Match unlinked patient by ABHA Number
  if (numId?.value) {
    const cleanDigits = numId.value.replace(/\D/g, "");
    const formatted = formatAbhaForStorage(numId.value);
    const abhaNumQueries: any[] = [];
    if (formatted) abhaNumQueries.push({ ABHANumber: formatted });
    if (cleanDigits) abhaNumQueries.push({ ABHANumber: cleanDigits });
    if (cleanDigits.length === 14) {
      const hyphenated = `${cleanDigits.slice(0, 2)}-${cleanDigits.slice(2, 6)}-${cleanDigits.slice(6, 10)}-${cleanDigits.slice(10, 14)}`;
      abhaNumQueries.push({ ABHANumber: hyphenated });
    }

    const byAbhaNum = await PatientModel.findOne({
      $and: [
        { $or: abhaNumQueries },
        noConflictingAbhaFilter,
        { isMerged: { $ne: true } },
        { status: { $ne: "merged" } },
      ],
    }).lean();
    if (byAbhaNum) return byAbhaNum as unknown as IPatient;
  }

  let mobile: string | undefined;
  const v = (profile.verifiedIdentifiers || []).find(
    (id) => id.type === "MOBILE",
  );
  const u = (profile.unverifiedIdentifiers || []).find(
    (id) => id.type === "MOBILE",
  );
  if (v?.value?.trim()) mobile = v.value.trim();
  else if (u?.value?.trim()) mobile = u.value.trim();

  if (!mobile) return null;

  const mobileNorm = normalizeMobile(mobile);

  // If a target ABHA address is specified, strictly exclude patients who already
  // have a different, non-empty ABHA address. A patient with ABHA A can NEVER be
  // matched for an ABHA B link request!
  const mobileQuery: any = {
    $and: [
      { $or: [{ mobile }, { mobile: mobileNorm }] },
      noConflictingAbhaFilter,
      { isMerged: { $ne: true } },
      { status: { $ne: "merged" } },
    ],
  };

  const byMobile = await PatientModel.find(mobileQuery).lean();
  if (byMobile.length === 0) return null;
  if (byMobile.length === 1) return byMobile[0] as unknown as IPatient;

  const name = profile.name?.trim();
  const gender = profile.gender ? normalizeGender(profile.gender) : "";
  const yearOfBirth = profile.yearOfBirth;

  let best: IPatient | null = null;
  let bestScore = -1;
  for (const p of byMobile as unknown as IPatient[]) {
    let score = 0;
    if (gender && p.gender && normalizeGender(p.gender) === gender) score += 2;
    if (yearOfBirth != null) {
      const py = getPatientYearOfBirth(p);
      if (py != null && Math.abs(py - yearOfBirth) <= 5) score += 2;
    }
    if (name) {
      const pName = p.name || `${p.f_name || ""} ${p.l_name || ""}`.trim();
      if (pName && isNamePhoneticallySimilar(name, pName)) score += 3;
    }
    // Prefer patients WITHOUT ABHA address — they are the ones being linked
    // for the first time. Patients already linked should not be re-identified.
    const hasAbha = !!(p as any).abhaaddress?.trim();
    if (!hasAbha) score += 5;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best || (byMobile[0] as unknown as IPatient);
};

import { LinkOTPModel } from "../models/LinkOTP";
import { generateOTP, sendOTPUnified } from "./twilio.otp.service";

const LINK_REDIS_PREFIX = "abdm_user_initiated_linking__";
const LINK_TTL_SECONDS = 15 * 60; // 15 minutes (900 seconds)

const getRedisClient = () => {
  try {
    const { getRedisConnection } = require("../config/redis");
    return getRedisConnection();
  } catch {
    return null;
  }
};

export const generateLinkOTP = async (
  transactionId: string,
  patientId: string,
  mobile: string,
  careContextRefs: string[],
  abhaAddress?: string,
  abhaNumber?: string,
): Promise<string> => {
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000);

  // 1. Store OTP in DB
  await LinkOTPModel.create({
    transactionId,
    otp,
    patientId,
    mobile,
    careContextRefs,
    abhaAddress: abhaAddress || undefined,
    abhaNumber: abhaNumber || undefined,
    expiresAt,
  });

  // 2. Also cache in Redis with 15-minute TTL per ABDM reference implementation
  try {
    const redis = getRedisClient();
    if (redis) {
      const redisPayload = JSON.stringify({
        reference_id: transactionId,
        otp,
        abha_address: abhaAddress || undefined,
        abha_number: abhaNumber || undefined,
        patient_id: patientId,
        mobile,
        care_contexts: careContextRefs,
      });
      await redis.set(
        `${LINK_REDIS_PREFIX}${transactionId}`,
        redisPayload,
        "EX",
        LINK_TTL_SECONDS,
      );
    }
  } catch (err: any) {
    console.warn(`[HIP-LINK] Failed to cache link OTP in Redis: ${err?.message}`);
  }

  // 3. Dispatch SMS OTP
  const result = await sendOTPUnified(mobile, otp);
  if (!result.success) {
    console.error(
      `Discovery: SMS delivery failed for transaction ${transactionId}, mobile ${mobile}: ${result.error}. OTP ${otp} stored in DB.`,
    );
  }

  return otp;
};

export const verifyLinkOTP = async (
  transactionId: string,
  otp: string,
  patientIdParam?: string,
): Promise<{
  valid: boolean;
  patientId?: string;
  careContextRefs?: string[];
  abhaAddress?: string;
  abhaNumber?: string;
  error?: string;
}> => {
  let stored = await LinkOTPModel.findOne({ transactionId });

  // Fallback to Redis if Mongo record is missing or lagged
  if (!stored) {
    try {
      const redis = getRedisClient();
      if (redis) {
        const raw = await redis.get(`${LINK_REDIS_PREFIX}${transactionId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.otp === otp) {
            await redis.del(`${LINK_REDIS_PREFIX}${transactionId}`);
            return {
              valid: true,
              patientId: parsed.patient_id,
              careContextRefs: parsed.care_contexts || [],
              abhaAddress: parsed.abha_address,
              abhaNumber: parsed.abha_number,
            };
          }
        }
      }
    } catch (_) {}
    return { valid: false, error: "OTP transaction expired or invalid" };
  }

  if (stored.expiresAt < new Date()) {
    await LinkOTPModel.deleteOne({ _id: stored._id });
    try {
      const redis = getRedisClient();
      if (redis) await redis.del(`${LINK_REDIS_PREFIX}${transactionId}`);
    } catch (_) {}
    return { valid: false, error: "OTP has expired" };
  }

  if (stored.otp !== otp) {
    const attempts = (stored.attempts || 0) + 1;
    if (attempts >= 3) {
      // Exceeded max attempts: delete OTP immediately to prevent brute force
      await LinkOTPModel.deleteOne({ _id: stored._id });
      try {
        const redis = getRedisClient();
        if (redis) await redis.del(`${LINK_REDIS_PREFIX}${transactionId}`);
      } catch (_) {}
      return {
        valid: false,
        error: "Too many failed attempts. OTP has been invalidated.",
      };
    }
    await LinkOTPModel.updateOne({ _id: stored._id }, { $inc: { attempts: 1 } });
    return { valid: false, error: "Incorrect OTP" };
  }

  // Single-use guarantee: Invalidate and delete immediately upon successful verification
  await LinkOTPModel.deleteOne({ _id: stored._id });
  try {
    const redis = getRedisClient();
    if (redis) await redis.del(`${LINK_REDIS_PREFIX}${transactionId}`);
  } catch (_) {}

  return {
    valid: true,
    patientId: stored.patientId,
    careContextRefs: stored.careContextRefs,
    abhaAddress: stored.abhaAddress || undefined,
    abhaNumber: stored.abhaNumber || undefined,
  };
};

export const DiscoveryService = {
  discoverPatient,
  identifyPatientForLink,
  generateLinkOTP,
  verifyLinkOTP,
};

export default DiscoveryService;
