import { PatientModel, IPatient } from "../models/Patient";
import {
  CareContextModel,
  CareContextStatus,
  ICareContext,
} from "../models/CareContext";

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
  })
    .sort({ createdAt: -1 })
    .lean();

  const displayName =
    patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();

  const referenceNumber = patient.uhid || patient._id.toString();
  return {
    referenceNumber: referenceNumber,
    display: `${displayName}'s records`,
    careContexts: careContexts.map((cc) => ({
      referenceNumber: cc.careContextReference,
      display: cc.display,
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

  // --- Step 1: Search by ABHA address first (ABHA is verified identifier; not in unverified) ---
  // const abhaQueries: { abhaaddress: string }[] = [];
  // if (patientInfo.id?.trim()) {
  //   abhaQueries.push({ abhaaddress: patientInfo.id.trim() });
  // }
  // const abhaFromVerified = (patientInfo.verifiedIdentifiers || []).find((id) =>
  //   ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type),
  // );
  // if (abhaFromVerified?.value?.trim()) {
  //   abhaQueries.push({ abhaaddress: abhaFromVerified.value.trim() });
  // }

  if (abhaQueries.length > 0) {
    const abhaOrQuery = abhaQueries.map((q) => ({
      abhaaddress: new RegExp(
        `^${String(q.abhaaddress).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    }));
    const abhaPatients = (await PatientModel.find({
      $or: abhaOrQuery,
    }).lean()) as unknown as IPatient[];
    if (abhaPatients.length > 0) {
      for (const p of abhaPatients) {
        addPatientToMap(resultsMap, p, ["ABHA_ADDRESS"]);
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
      return results;
    }
  }

  // --- Step 2: If no match, search with Mobile number (mobile is verified identifier; not in unverified). When we have matched records, do fuzzy logic match with MR if present. ---
  const mobileIdentifier = (patientInfo.verifiedIdentifiers || []).find(
    (id) => id.type === "MOBILE",
  );
  const mobileRaw = mobileIdentifier?.value?.trim();
  const mobileNorm = mobileRaw ? normalizeMobile(mobileRaw) : "";
  const mobile = mobileRaw || undefined;

  if (mobile && mobileNorm) {
    const mobilePatients = (await PatientModel.find({
      $or: [{ mobile }, { mobile: mobileNorm }],
    }).lean()) as unknown as IPatient[];

    // Matched records (from mobile). Only MR may come as unverified identifier: when present, match matched records with MR; else return all mobile-matched.
    const mrValues: string[] = [];
    (patientInfo.unverifiedIdentifiers || []).forEach((id) => {
      if (id.type === "MR" && id.value?.trim()) mrValues.push(id.value.trim());
    });

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
      addPatientToMap(resultsMap, patient, tags);
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

  return results;
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
      ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type),
    );
    if (v?.value?.trim()) abhaAddress = v.value.trim();
  }
  if (!abhaAddress && (profile.unverifiedIdentifiers || []).length > 0) {
    const u = (profile.unverifiedIdentifiers || []).find((id) =>
      ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type),
    );
    if (u?.value?.trim()) abhaAddress = u.value.trim();
  }

  let abhaNumber: string | undefined;
  const allIds = [
    ...(profile.verifiedIdentifiers || []),
    ...(profile.unverifiedIdentifiers || []),
  ];
  const numId = allIds.find(
    (id) =>
      (id.type === "ABHA_NUMBER" || id.type === "abha_number") &&
      id.value?.replace(/\D/g, "").length >= 14,
  );
  if (numId?.value) {
    const digits = numId.value.replace(/\D/g, "");
    if (digits.length >= 14) abhaNumber = digits.slice(0, 14);
  }
  if (!abhaNumber && abhaAddress) {
    const digits = abhaAddress.replace(/\D/g, "");
    if (digits.length >= 14) abhaNumber = digits.slice(0, 14);
  }
  return { abhaAddress, abhaNumber };
};

export const identifyPatientForLink = async (
  profile: LinkInitProfile,
): Promise<IPatient | null> => {
  if (!profile) return null;

  const ref = profile.referenceNumber?.trim();
  if (ref) {
    const byUhid = await PatientModel.findOne({
      uhid: new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).lean();
    if (byUhid) return byUhid as unknown as IPatient;
  }

  const abhaValues: string[] = [];
  if (profile.id?.trim()) abhaValues.push(profile.id.trim());
  (profile.verifiedIdentifiers || []).forEach((id) => {
    if (
      id.type &&
      id.value &&
      ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type)
    ) {
      abhaValues.push(id.value.trim());
    }
  });
  (profile.unverifiedIdentifiers || []).forEach((id) => {
    if (
      id.type &&
      id.value &&
      ["ABHA_ADDRESS", "healthId", "NDHM_HEALTH_ID"].includes(id.type)
    ) {
      abhaValues.push(id.value.trim());
    }
  });

  if (abhaValues.length > 0) {
    const orAbha = abhaValues.map((v) => ({
      abhaaddress: new RegExp(
        `^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      ),
    }));
    const byAbha = await PatientModel.findOne({ $or: orAbha }).lean();
    if (byAbha) return byAbha as unknown as IPatient;
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
  const byMobile = await PatientModel.find({
    $or: [{ mobile }, { mobile: mobileNorm }],
  }).lean();
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
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best || (byMobile[0] as unknown as IPatient);
};

import { LinkOTPModel } from "../models/LinkOTP";

export const generateLinkOTP = async (
  transactionId: string,
  patientId: string,
  mobile: string,
  careContextRefs: string[],
): Promise<string> => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  await LinkOTPModel.create({
    transactionId,
    otp,
    patientId,
    mobile,
    careContextRefs,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  console.log(
    `Discovery: OTP ${otp} generated for transaction ${transactionId}, mobile ${mobile}`,
  );

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
}> => {
  const stored = await LinkOTPModel.findOne({ transactionId });

  if (!stored) {
    return { valid: false };
  }

  if (stored.expiresAt < new Date()) {
    await LinkOTPModel.deleteOne({ _id: stored._id });
    return { valid: false };
  }

  if (stored.otp !== otp) {
    return { valid: false };
  }

  await LinkOTPModel.deleteOne({ _id: stored._id });

  return {
    valid: true,
    patientId: stored.patientId,
    careContextRefs: stored.careContextRefs,
  };
};

export const DiscoveryService = {
  discoverPatient,
  identifyPatientForLink,
  generateLinkOTP,
  verifyLinkOTP,
};

export default DiscoveryService;
