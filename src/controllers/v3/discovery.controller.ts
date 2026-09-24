import { Request, Response } from "express";
import axios from "axios";
import {
  DiscoveryService,
  LinkInitProfile,
  extractAbhaFromProfile,
} from "../../services/discovery.service";
import { CareContextModel, CareContextStatus } from "../../models/CareContext";
import { PatientModel } from "../../models/Patient";
import {
  CareContextService,
  resolveCanonicalHiType,
} from "../../services/carecontext.service";
import {
  STATUS_CODE,
  generateUID,
  facilityId,
  X_CM_ID,
  X_HIP_ID,
  ENDPOINTS,
  DISCOVERY_UPDATE_PATIENT_NAME,
} from "../../utils/constant";
import { AbdmTokenService } from "../../services/abdm.token.service";

// Redis-based cache for ABHA data extracted during discover, keyed by transactionId.
// Link/init doesn't carry ABHA number in its body (only abhaAddress), so we need
// to retrieve it from the discover step via the shared transactionId.
// Falls back to in-memory Map if Redis is unavailable.
const DISCOVERY_CACHE_PREFIX = "abdm:discover:";
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

// Fallback in-memory cache (for when Redis is unavailable)
const fallbackCache = new Map<
  string,
  {
    abhaAddress?: string;
    abhaNumber?: string;
    patientName?: string;
    patientId?: string;
    ts: number;
  }
>();

const getRedis = () => {
  try {
    const { getRedisConnection } = require("../../services/abdm.queue.service");
    return getRedisConnection();
  } catch {
    return null;
  }
};

const cacheDiscoveryAbha = async (
  txnId: string,
  abhaAddress?: string,
  abhaNumber?: string,
  patientName?: string,
  patientId?: string,
) => {
  if (!txnId) return;
  const redis = getRedis();
  const key = `${DISCOVERY_CACHE_PREFIX}${txnId}`;

  if (redis) {
    // Try to get existing data to merge
    let existing: any = null;
    try {
      const existingStr = await redis.get(key);
      if (existingStr) existing = JSON.parse(existingStr);
    } catch (_) {}

    const data = {
      abhaAddress: abhaAddress ?? existing?.abhaAddress,
      abhaNumber: abhaNumber ?? existing?.abhaNumber,
      patientName: patientName ?? existing?.patientName,
      patientId: patientId ?? existing?.patientId,
    };
    await redis.set(key, JSON.stringify(data), "EX", CACHE_TTL_SECONDS);
  } else {
    // Fallback to in-memory
    const existing = fallbackCache.get(txnId);
    fallbackCache.set(txnId, {
      abhaAddress: abhaAddress ?? existing?.abhaAddress,
      abhaNumber: abhaNumber ?? existing?.abhaNumber,
      patientName: patientName ?? existing?.patientName,
      patientId: patientId ?? existing?.patientId,
      ts: Date.now(),
    });
    // Evict stale entries
    const now = Date.now();
    for (const [k, v] of fallbackCache) {
      if (now - v.ts > CACHE_TTL_SECONDS * 1000) fallbackCache.delete(k);
    }
  }
};

const getCachedDiscoveryAbha = async (
  txnId: string,
): Promise<
  | {
      abhaAddress?: string;
      abhaNumber?: string;
      patientName?: string;
      patientId?: string;
    }
  | undefined
> => {
  if (!txnId) return undefined;
  const redis = getRedis();
  const key = `${DISCOVERY_CACHE_PREFIX}${txnId}`;

  if (redis) {
    try {
      const data = await redis.get(key);
      if (data) return JSON.parse(data);
    } catch (_) {}
    return undefined;
  } else {
    // Fallback to in-memory
    const entry = fallbackCache.get(txnId);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > CACHE_TTL_SECONDS * 1000) {
      fallbackCache.delete(txnId);
      return undefined;
    }
    return {
      abhaAddress: entry.abhaAddress,
      abhaNumber: entry.abhaNumber,
      patientName: entry.patientName,
      patientId: entry.patientId,
    };
  }
};

/**
 * Outbound Gateway caller with automatic session token refresh on 401 or code 900901.
 */
export const callGatewayWithRetry = async (
  endpoint: string,
  payload: any,
  hipId?: string,
) => {
  const baseUrl = process.env.ABDM_BASE_URL;
  if (!baseUrl) {
    throw new Error("ABDM_BASE_URL environment variable not set");
  }
  const targetHipId = hipId || X_HIP_ID || facilityId;

  const buildHeaders = (token: string) => ({
    "Content-Type": "application/json",
    "REQUEST-ID": generateUID(),
    TIMESTAMP: new Date().toISOString(),
    "X-CM-ID": X_CM_ID,
    "X-HIP-ID": targetHipId,
    Authorization: token,
  });

  let token = await AbdmTokenService.getToken();
  try {
    return await axios.post(`${baseUrl}${endpoint}`, payload, {
      headers: buildHeaders(token),
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errData = error.response?.data;
    const isTokenExpired =
      status === 401 ||
      errData?.code === 900901 ||
      errData?.error?.code === 900901 ||
      (typeof errData === "string" && errData.includes("900901"));

    if (isTokenExpired) {
      console.warn(
        `[ABDM-GATEWAY] Token error (${status} / 900901). Refreshing token and retrying outbound call to ${endpoint}...`,
      );
      AbdmTokenService.invalidate();
      token = await AbdmTokenService.refresh();
      return await axios.post(`${baseUrl}${endpoint}`, payload, {
        headers: buildHeaders(token),
      });
    }
    throw error;
  }
};

export const onDiscover = async (req: Request, res: Response) => {
  try {
    const requestId = req.headers["request-id"] || req.headers["REQUEST-ID"];
    const hipId = (req.headers["x-hip-id"] as string) || X_HIP_ID || facilityId;

    const rawTxn = req.body.transactionId;
    const txnIdFromRequest =
      typeof rawTxn === "string" ? rawTxn.trim() : rawTxn;
    if (!txnIdFromRequest) {
      console.warn(
        "Discovery: No transaction ID in request. Body keys:",
        Object.keys(req.body || {}),
      );
    } else {
    }

    const body = req.body?.data ? { ...req.body, ...req.body?.data } : req.body;
    const { patient } = body;

    if (!patient || !requestId) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged",
      });
    }

    res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Discovery request received",
    });

    try {
      const results = await DiscoveryService.discoverPatient({
        id: patient.id,
        name: patient.name,
        gender: patient.gender,
        yearOfBirth: patient.yearOfBirth,
        verifiedIdentifiers: patient.verifiedIdentifiers || [],
        unverifiedIdentifiers: patient.unverifiedIdentifiers || [],
      });

      const responsePayload: any = {
        requestId: requestId,
      };

      const onDiscoverPayload: any = {
        response: responsePayload,
      };

      if (txnIdFromRequest) {
        onDiscoverPayload.transactionId = txnIdFromRequest;
      }

      if (results && results.length > 0) {
        const allMatchedBy = new Set<string>();
        results.forEach((r) => r.matchedBy.forEach((t) => allMatchedBy.add(t)));
        onDiscoverPayload.matchedBy =
          allMatchedBy.size > 0 ? Array.from(allMatchedBy) : ["ABHA_NUMBER"];
        const patientResults: any[] = [];
        results.forEach((result) => {
          const grouped = new Map<string, typeof result.careContexts>();
          result.careContexts.forEach((cc) => {
            const type = (cc as any).hiType || "OPConsultation";
            if (!grouped.has(type)) grouped.set(type, []);
            grouped.get(type)!.push(cc);
          });

          for (const [type, ccs] of grouped) {
            const careContextsList = ccs.slice(0, 20).map((cc) => ({
              referenceNumber: cc.referenceNumber,
              display: cc.display,
            }));

            if (careContextsList.length > 0) {
              patientResults.push({
                referenceNumber: result.referenceNumber,
                display: result.display,
                careContexts: careContextsList,
                hiType: type,
                count: careContextsList.length,
              });
            }
          }
        });

        if (patientResults.length > 0) {
          onDiscoverPayload.patient = patientResults;

          // NOTE: ABHA data is NOT persisted here. Discovery is read-only per ABDM spec.
          // ABHA address/number will be saved only after OTP verification in link/confirm.
          // Cache the ABHA data so link/init can retrieve the ABHA number (not in its body).
          try {
            const discoverProfile = {
              id: patient.id,
              verifiedIdentifiers: patient.verifiedIdentifiers || [],
              unverifiedIdentifiers: patient.unverifiedIdentifiers || [],
            } as import("../../services/discovery.service").LinkInitProfile;
            const { abhaAddress: cachedAddr, abhaNumber: cachedNum } =
              extractAbhaFromProfile(discoverProfile);
            const cachedName = patient.name?.trim() || undefined;
            if (txnIdFromRequest) {
              // Cache the patient ID from discover so link/init can identify the
              // EXACT same patient even if ABDM strips the referenceNumber.
              let cachedPatientId: string | undefined;
              const uniqueUhids = Array.from(
                new Set(
                  patientResults
                    .map((r: any) => r.referenceNumber)
                    .filter(Boolean),
                ),
              );
              if (uniqueUhids.length === 1) {
                const discoverUhid = uniqueUhids[0];
                const discoverPatient = await PatientModel.findOne({
                  uhid: discoverUhid,
                  isMerged: { $ne: true },
                  status: { $ne: "merged" },
                })
                  .select("_id")
                  .lean();
                if (discoverPatient) {
                  cachedPatientId = discoverPatient._id.toString();
                }
              }
              await cacheDiscoveryAbha(
                txnIdFromRequest,
                cachedAddr,
                cachedNum,
                cachedName,
                cachedPatientId,
              );
            }
          } catch (_) {}
        } else {
          onDiscoverPayload.error = {
            code: 1000,
            message: "No matching records with care contexts found",
          };
        }
      } else {
        onDiscoverPayload.error = {
          code: 1000,
          message: "No matching records found",
        };
      }

      await callGatewayWithRetry(
        ENDPOINTS.ON_DISCOVER,
        onDiscoverPayload,
        hipId,
      );
    } catch (discoverError: any) {
      const errBody = discoverError.response?.data;
      const errStatus = discoverError.response?.status;
      const errDataStr =
        typeof errBody === "string"
          ? errBody
          : JSON.stringify(errBody ?? {}, null, 2);
      console.error(
        "Discovery: Error processing discover",
        discoverError.message,
        "status",
        errStatus,
        "body",
        errDataStr,
      );
    }
  } catch (error: any) {
    console.error("Discovery: discover handler error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};

export const onLinkInit = async (req: Request, res: Response) => {
  try {
    const requestId =
      req.headers["request-id"] ||
      req.headers["REQUEST-ID"] ||
      req.body.requestId;
    const hipId = (req.headers["x-hip-id"] as string) || X_HIP_ID || facilityId;

    const { transactionId, patient } = req.body;
    const txnId = transactionId ?? req.body.txn_id;

    if (!txnId || !patient || !requestId) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged",
      });
    }

    res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Link init received",
    });

    try {
      const patientBlocks: any[] = Array.isArray(patient) ? patient : [patient];
      const patientData = patientBlocks[0] || {};

      // Flatten careContexts across all hiType patient blocks
      const careContextRefs: string[] = [];
      for (const block of patientBlocks) {
        const ccs = block.careContexts ?? block.care_contexts ?? [];
        for (const cc of ccs) {
          const ref = cc.referenceNumber ?? cc.ref_num ?? cc.reference_number;
          if (ref && !careContextRefs.includes(ref)) {
            careContextRefs.push(ref);
          }
        }
      }

      const bodyAbha = req.body.abhaAddress ?? req.body.abha_address;

      const verifiedIds = [...(patientData.verifiedIdentifiers ?? [])];

      const profile = {
        referenceNumber: patientData.referenceNumber,
        id: patientData.id ?? bodyAbha,
        name: patientData.name ?? patientData.display,
        gender: patientData.gender,
        yearOfBirth:
          patientData.yearOfBirth != null
            ? Number(patientData.yearOfBirth)
            : undefined,
        verifiedIdentifiers: verifiedIds,
        unverifiedIdentifiers: patientData.unverifiedIdentifiers ?? [],
      } as LinkInitProfile;
      // --- Multi-strategy patient identification with cross-validation ---
      let dbPatient: import("../../models/Patient").IPatient | null = null;

      // Extract linking ABHA address and number for validation & OTP generation
      const cached = await getCachedDiscoveryAbha(txnId);
      const { abhaAddress: extractedAbha, abhaNumber: abhaNumFromProfile } =
        extractAbhaFromProfile(profile);
      const abhaAddress = (
        extractedAbha ||
        cached?.abhaAddress ||
        bodyAbha ||
        profile.id ||
        ""
      )
        .trim()
        .toLowerCase();
      const abhaNumber = abhaNumFromProfile || cached?.abhaNumber;

      // Priority 1: Direct UHID match from ABDM profile referenceNumber (Authoritative)
      if (profile.referenceNumber?.trim()) {
        const ref = profile.referenceNumber.trim();
        const isObjectId = /^[0-9a-fA-F]{24}$/.test(ref);
        const candidateByUhid = (await PatientModel.findOne({
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
        }).lean()) as any;

        if (candidateByUhid) {
          // Cross-validate: Candidate must not have a conflicting existing ABHA address
          const candAbha = (candidateByUhid.abhaaddress || "")
            .trim()
            .toLowerCase();
          if (!candAbha || !abhaAddress || candAbha === abhaAddress) {
            dbPatient = candidateByUhid;
          } else {
            console.warn(
              `[HIP-LINK] onLinkInit: Patient ${candidateByUhid._id} (UHID ${candidateByUhid.uhid}) has conflicting ABHA ("${candAbha}" vs linking "${abhaAddress}"). Refusing match.`,
            );
          }
        }
      }

      // Priority 2: Cached patientId from discover step (same transactionId)
      if (!dbPatient && cached?.patientId) {
        const candidateByCache = (await PatientModel.findById(
          cached.patientId,
        ).lean()) as any;
        if (candidateByCache) {
          const candAbha = (candidateByCache.abhaaddress || "")
            .trim()
            .toLowerCase();
          if (!candAbha || !abhaAddress || candAbha === abhaAddress) {
            dbPatient = candidateByCache;
          } else {
            console.warn(
              `[HIP-LINK] onLinkInit: Cached patient ${candidateByCache._id} has conflicting ABHA ("${candAbha}" vs linking "${abhaAddress}"). Refusing match.`,
            );
          }
        }
      }

      // Priority 3: Care context references (validated against linking patient)
      if (!dbPatient && careContextRefs.length > 0) {
        const ccDoc = await CareContextModel.findOne({
          careContextReference: { $in: careContextRefs },
        }).lean();
        if (ccDoc?.patientId) {
          const candidateByCC = (await PatientModel.findById(
            ccDoc.patientId,
          ).lean()) as any;
          if (candidateByCC) {
            const candAbha = (candidateByCC.abhaaddress || "")
              .trim()
              .toLowerCase();
            if (!candAbha || !abhaAddress || candAbha === abhaAddress) {
              dbPatient = candidateByCC;
            } else {
              console.warn(
                `[HIP-LINK] onLinkInit: CareContext ${ccDoc.careContextReference} belongs to patient ${candidateByCC._id} with conflicting ABHA ("${candAbha}" vs linking "${abhaAddress}"). Refusing match.`,
              );
            }
          }
        }
      }

      // Priority 4: identifyPatientForLink (UHID / ABHA / mobile+demographics fallback)
      if (!dbPatient) {
        dbPatient = await DiscoveryService.identifyPatientForLink(profile);
      }

      const onInitPayload: any = {
        transactionId: txnId,
        txn_id: txnId,
        timestamp: new Date().toISOString(),
        response: {
          requestId: requestId,
        },
      };

      if (!dbPatient) {
        onInitPayload.error = {
          code: 1000,
          message: "Patient not found",
        };
      } else {
        // Store the ABDM profile name in cache so link/confirm can use it
        const abdmName = profile.name?.trim();
        if (txnId && abdmName) {
          await cacheDiscoveryAbha(txnId, undefined, undefined, abdmName);
        }

        // NOTE: ABHA data is NOT persisted here. Link/init only sends OTP.
        // ABHA address/number will be saved only after OTP verification in link/confirm.
        const otp = await DiscoveryService.generateLinkOTP(
          transactionId,
          dbPatient._id.toString(),
          dbPatient.mobile,
          careContextRefs,
          abhaAddress || undefined,
          abhaNumber,
        );
        onInitPayload.link = {
          referenceNumber: txnId,
          authenticationType: "DIRECT",
          meta: {
            communicationMedium: "MOBILE",
            communicationHint: dbPatient.mobile
              ? `XXXXXX${dbPatient.mobile.slice(-4)}`
              : "XXXXXX",
            communicationExpiry: new Date(
              Date.now() + 15 * 60 * 1000,
            ).toISOString(),
          },
        };
      }

      await callGatewayWithRetry(
        ENDPOINTS.ON_LINK_INIT,
        onInitPayload,
        hipId,
      );
    } catch (initError: any) {
      console.error(
        "Discovery: Error processing link/init",
        initError.response?.data || initError.message,
      );
    }
  } catch (error: any) {
    console.error("Discovery: link/init handler error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};

export const onLinkConfirm = async (req: Request, res: Response) => {
  try {
    const requestId =
      req.headers["request-id"] ||
      req.headers["REQUEST-ID"] ||
      req.body.requestId;
    const hipId = (req.headers["x-hip-id"] as string) || X_HIP_ID || facilityId;

    const { transactionId, token, confirmation } = req.body;
    const linkRefNumber = confirmation?.linkRefNumber;
    const otp = confirmation?.token || token;
    const finalTransactionId = transactionId || linkRefNumber;

    if (!finalTransactionId || !requestId) {
      return res.status(STATUS_CODE.ACCEPTED).json({
        status: "success",
        message: "Acknowledged",
      });
    }

    // ABDM M2 spec: /confirm must immediately respond with HTTP 202 Accepted
    res.status(STATUS_CODE.ACCEPTED).json({
      status: "success",
      message: "Link confirm received",
    });

    try {
      const onConfirmPayload: any = {
        timestamp: new Date().toISOString(),
        response: {
          requestId: requestId,
        },
      };

      const verification = await DiscoveryService.verifyLinkOTP(
        linkRefNumber || transactionId,
        otp,
      );

      if (!verification.valid) {
        onConfirmPayload.error = {
          code: 1003,
          message: "Invalid or expired OTP",
        };
      } else {
        const { patientId, careContextRefs, abhaAddress, abhaNumber } =
          verification;

        const patient = await PatientModel.findById(patientId);
        if (!patient) {
          onConfirmPayload.error = {
            code: 1000,
            message: "Patient not found",
          };
        } else {
          const normalizedAbha = (abhaAddress || "").trim().toLowerCase();
          const existingPatientAbha = (
            (patient as any).abhaaddress || ""
          )
            .trim()
            .toLowerCase();

          // GUARD 1: Prevent identity hijacking. If patient already has a DIFFERENT ABHA address, reject!
          if (
            existingPatientAbha &&
            normalizedAbha &&
            existingPatientAbha !== normalizedAbha
          ) {
            console.error(
              `[HIP-LINK] onLinkConfirm: SECURITY REJECTION - Patient ${patient._id} already has ABHA "${existingPatientAbha}". Cannot overwrite with "${normalizedAbha}".`,
            );
            onConfirmPayload.error = {
              code: 1004,
              message:
                "Patient record is already linked to a different ABHA address",
            };
          } else if (normalizedAbha && normalizedAbha !== existingPatientAbha) {
            // GUARD 2: Prevent assigning an ABHA address already owned by another patient
            const conflicting = await PatientModel.findOne({
              abhaaddress: new RegExp(
                `^${normalizedAbha.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
                "i",
              ),
              _id: { $ne: patient._id },
              isMerged: { $ne: true },
              status: { $ne: "merged" },
            })
              .select("_id")
              .lean();
            if (conflicting) {
              console.error(
                `[HIP-LINK] onLinkConfirm: ABHA "${normalizedAbha}" is already owned by patient ${conflicting._id}. Cannot assign to ${patient._id}.`,
              );
              onConfirmPayload.error = {
                code: 1005,
                message:
                  "ABHA address is already linked to another patient profile",
              };
            }
          }

          if (onConfirmPayload.error) {
            // Error detected by guards — dispatch error response immediately without DB changes
            await callGatewayWithRetry(
              ENDPOINTS.ON_LINK_CONFIRM,
              onConfirmPayload,
              hipId,
            );
            return;
          }

          // --- Persist ABHA address/number and name on patient upon successful link confirm ---
          const abhaUpdateData: Record<string, unknown> = {};
          if (normalizedAbha && normalizedAbha !== existingPatientAbha) {
            abhaUpdateData.abhaaddress = normalizedAbha;
          }
          if (abhaNumber && abhaNumber !== (patient as any).ABHANumber) {
            abhaUpdateData.ABHANumber = abhaNumber;
          }
          // Update name from ABDM profile (cached from onDiscover where ABDM sends it)
          if (DISCOVERY_UPDATE_PATIENT_NAME) {
            const cachedForConfirm =
              await getCachedDiscoveryAbha(finalTransactionId);
            const abdmName = cachedForConfirm?.patientName;
            const storedName = (patient as any).name?.trim();
            if (abdmName && abdmName !== storedName) {
              abhaUpdateData.name = abdmName;
              // Split into f_name / m_name / l_name
              const parts = abdmName.trim().split(/\s+/);
              if (parts.length === 1) {
                abhaUpdateData.f_name = parts[0];
                abhaUpdateData.m_name = "";
                abhaUpdateData.l_name = "";
              } else if (parts.length === 2) {
                abhaUpdateData.f_name = parts[0];
                abhaUpdateData.m_name = "";
                abhaUpdateData.l_name = parts[1];
              } else {
                abhaUpdateData.f_name = parts[0];
                abhaUpdateData.m_name = parts.slice(1, -1).join(" ");
                abhaUpdateData.l_name = parts[parts.length - 1];
              }
            } else {
            }
          }
          // Always record abhaLinkedAt on successful OTP verification
          abhaUpdateData.abhaLinkedAt = new Date();
          await PatientModel.updateOne(
            { _id: patient._id },
            { $set: abhaUpdateData },
          );
          if (careContextRefs && careContextRefs.length > 0) {
            const ccUpdateData: Record<string, unknown> = {
              linkingStatus: CareContextStatus.LINKED,
              linkedAt: new Date(),
              linkError: null,
            };
            if (normalizedAbha) {
              ccUpdateData.abhaAddress = normalizedAbha;
            }
            await CareContextModel.updateMany(
              {
                careContextReference: { $in: careContextRefs },
                patientId: patient._id,
              },
              { $set: ccUpdateData },
            );
          }

          const linkedContexts = await CareContextModel.find({
            careContextReference: { $in: careContextRefs || [] },
            patientId: patient._id,
          }).lean();

          const patientName =
            patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();

          // Group contexts by hiType (canonical field — one CC = one group).
          // NEVER iterate cc.hiTypes (the array) — it can be contaminated.
          // Use cc.hiType (singular) as the ONLY grouping key.
          const contextsByType = new Map<string, typeof linkedContexts>();

          for (const cc of linkedContexts) {
            // Use hiType (canonical). Safe for legacy CCs.
            const type = await resolveCanonicalHiType(cc);

            if (!contextsByType.has(type)) {
              contextsByType.set(type, []);
            }
            contextsByType.get(type)!.push(cc);
          }

          onConfirmPayload.patient = [];

          for (const [type, contexts] of contextsByType) {
            onConfirmPayload.patient.push({
              referenceNumber: patient.uhid || patient._id.toString(),
              display: patientName,
              careContexts: contexts.map((cc) => ({
                referenceNumber: cc.careContextReference,
                display: cc.display,
              })),
              hiType: type,
              count: contexts.length,
            });
          }
          try {
            const authToken = await AbdmTokenService.getToken();
            for (const cc of linkedContexts) {
              await CareContextService.notifyContext(cc as any, authToken);
            }
          } catch (notifyErr: any) {
            console.error(
              "Discovery: context/notify failed",
              notifyErr?.message,
            );
          }

          // Request link token if patient doesn't have one (for future HIP-initiated linking)
          const refreshedPatient = await PatientModel.findById(
            patient._id,
          ).lean();
          if (
            refreshedPatient &&
            (refreshedPatient as any).abhaaddress &&
            !CareContextService.isLinkTokenValid(refreshedPatient as any)
          ) {
            setImmediate(() => {
              CareContextService.requestLinkToken(
                refreshedPatient as any,
              ).catch((err) =>
                console.warn(
                  "Discovery: link token request (post-link-confirm) failed:",
                  err?.message,
                ),
              );
            });
          }
          try {
            if (patient.mobile) {
              import("../../services/sms.notification.service")
                .then(({ SmsNotificationService }) => {
                  SmsNotificationService.sendSmsNotify2(patient.mobile).catch(
                    (err) =>
                      console.error("Discovery: Deeplink SMS error:", err),
                  );
                })
                .catch((err) =>
                  console.error("Failed to load SMS service:", err),
                );
            }
          } catch (error) {
            console.error(error);
          }
        }
      }

      await callGatewayWithRetry(
        ENDPOINTS.ON_LINK_CONFIRM,
        onConfirmPayload,
        hipId,
      );
    } catch (confirmError: any) {
      console.error(
        "Discovery: Error processing link/confirm",
        confirmError.response?.data || confirmError.message,
      );
    }
  } catch (error: any) {
    console.error("Discovery: link/confirm handler error", error);
    return res.status(STATUS_CODE.ACCEPTED).json({
      status: "error",
      message: error.message,
    });
  }
};
