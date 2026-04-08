import { Request, Response } from "express";
import axios from "axios";
import {
  DiscoveryService,
  LinkInitProfile,
  extractAbhaFromProfile,
} from "../../services/discovery.service";
import { CareContextModel, CareContextStatus } from "../../models/CareContext";
import { PatientModel } from "../../models/Patient";
import { CareContextService } from "../../services/carecontext.service";
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

// In-memory cache for ABHA data extracted during discover, keyed by transactionId.
// Link/init doesn't carry ABHA number in its body (only abhaAddress), so we need
// to retrieve it from the discover step via the shared transactionId.
const discoveryAbhaCache = new Map<
  string,
  { abhaAddress?: string; abhaNumber?: string; ts: number }
>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cacheDiscoveryAbha = (
  txnId: string,
  abhaAddress?: string,
  abhaNumber?: string,
) => {
  if (!txnId) return;
  discoveryAbhaCache.set(txnId, { abhaAddress, abhaNumber, ts: Date.now() });
  // Evict stale entries (fire-and-forget, max 100 checked per call)
  let checked = 0;
  for (const [key, val] of discoveryAbhaCache) {
    if (++checked > 100) break;
    if (Date.now() - val.ts > CACHE_TTL_MS) discoveryAbhaCache.delete(key);
  }
};

const getCachedDiscoveryAbha = (
  txnId: string,
): { abhaAddress?: string; abhaNumber?: string } | undefined => {
  if (!txnId) return undefined;
  const entry = discoveryAbhaCache.get(txnId);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    discoveryAbhaCache.delete(txnId);
    return undefined;
  }
  return { abhaAddress: entry.abhaAddress, abhaNumber: entry.abhaNumber };
};

export const onDiscover = async (req: Request, res: Response) => {
  try {
    console.log(
      "Discovery: discover request received",
      "path:",
      req.path || req.originalUrl,
      "body:",
      JSON.stringify(req.body),
    );
    const requestId = req.headers["request-id"] || req.headers["REQUEST-ID"];

    const rawTxn = req.body.transactionId;
    const txnIdFromRequest =
      typeof rawTxn === "string" ? rawTxn.trim() : rawTxn;
    if (!txnIdFromRequest) {
      console.warn(
        "Discovery: No transaction ID in request. Body keys:",
        Object.keys(req.body || {}),
      );
    } else {
      console.log(
        "Discovery: using transactionId for on-discover:",
        txnIdFromRequest,
      );
    }

    const body = req.body?.data ? { ...req.body, ...req.body?.data } : req.body;
    const { patient } = body;

    if (!patient || !requestId) {
      console.log("Discovery: Missing patient or requestId");
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
        onDiscoverPayload.matchedBy = Array.from(allMatchedBy);
        const patientResults = results
          .map((result) => {
            const careContextsList = result.careContexts
              .slice(0, 20)
              .map((cc) => ({
                referenceNumber: cc.referenceNumber,
                display: cc.display,
              }));

            return {
              referenceNumber: result.referenceNumber,
              display: result.display,
              careContexts: careContextsList,
              hiType: "OPConsultation",
              count: careContextsList.length,
            };
          })
          .filter((p) => p.count > 0); // ABDM requires count between 1-20

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
            if (txnIdFromRequest) {
              cacheDiscoveryAbha(txnIdFromRequest, cachedAddr, cachedNum);
            }
            console.log(
              "Discovery: onDiscover matched",
              patientResults.length,
              "patient(s) with care contexts — cached ABHA:",
              cachedAddr || "(none)",
              cachedNum || "(none)",
              "(persist deferred to link/confirm)",
            );
          } catch (_) {
            console.log(
              "Discovery: onDiscover matched",
              patientResults.length,
              "patient(s) with care contexts (ABHA persist deferred to link/confirm)",
            );
          }
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

      const responseRequestId = generateUID();
      const authToken = await AbdmTokenService.getToken();

      console.log(
        "Discovery: Sending on-discover payload:",
        JSON.stringify(onDiscoverPayload),
      );

      await axios.post(
        `${process.env.ABDM_BASE_URL}${ENDPOINTS.ON_DISCOVER}`,
        onDiscoverPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "REQUEST-ID": responseRequestId,
            TIMESTAMP: new Date().toISOString(),
            "X-CM-ID": X_CM_ID,
            "X-HIP-ID": X_HIP_ID || facilityId,
            Authorization: authToken,
          },
        },
      );

      console.log(
        "Discovery: on-discover sent",
        results && results.length > 0 ? "with records" : "no records found",
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
    console.log(
      "Discovery: link/init request received",
      "path:",
      req.path || req.originalUrl,
      "body:",
      JSON.stringify(req.body),
    );

    const requestId =
      req.headers["request-id"] ||
      req.headers["REQUEST-ID"] ||
      req.body.requestId;

    const { transactionId, patient } = req.body;
    const txnId = transactionId ?? req.body.txn_id;

    if (!txnId || !patient || !requestId) {
      console.log("Discovery: Missing required fields in link/init");
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
      const patientData = Array.isArray(patient) ? patient[0] : patient;

      const careContextsList =
        patientData.careContexts ?? patientData.care_contexts ?? [];
      const careContextRefs = careContextsList.map(
        (cc: any) => cc.referenceNumber ?? cc.ref_num ?? cc.reference_number,
      );

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

      console.log("Discovery: onLinkInit profile —", JSON.stringify(profile));

      const dbPatient = await DiscoveryService.identifyPatientForLink(profile);

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
        const { abhaAddress, abhaNumber: abhaNumFromProfile } =
          extractAbhaFromProfile(profile);

        // Link/init body from ABDM typically only has abhaAddress, not ABHA number.
        // Retrieve ABHA number from the discover step's cached data (same transactionId).
        const cached = getCachedDiscoveryAbha(txnId);
        const abhaNumber = abhaNumFromProfile || cached?.abhaNumber;

        // NOTE: ABHA data is NOT persisted here. Link/init only sends OTP.
        // ABHA address/number will be saved only after OTP verification in link/confirm.
        console.log(
          "Discovery: onLinkInit identified patient",
          dbPatient.uhid || dbPatient._id,
          "— abhaAddress:",
          abhaAddress || "(none)",
          "abhaNumber:",
          abhaNumber || "(none)",
          abhaNumFromProfile
            ? "(from profile)"
            : cached?.abhaNumber
              ? "(from discover cache)"
              : "(not available)",
        );

        const otp = await DiscoveryService.generateLinkOTP(
          transactionId,
          dbPatient._id.toString(),
          dbPatient.mobile,
          careContextRefs,
          abhaAddress,
          abhaNumber,
        );

        console.log(
          `Discovery: OTP generated for patient ${dbPatient.uhid}, mobile ${dbPatient.mobile}`,
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
              Date.now() + 10 * 60 * 1000,
            ).toISOString(),
          },
        };
      }

      const responseRequestId = generateUID();
      const authToken = await AbdmTokenService.getToken();

      console.log(
        "Discovery: Sending on-init payload:",
        JSON.stringify(onInitPayload),
      );

      await axios.post(
        `${process.env.ABDM_BASE_URL}${ENDPOINTS.ON_LINK_INIT}`,
        onInitPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "REQUEST-ID": responseRequestId,
            TIMESTAMP: new Date().toISOString(),
            "X-CM-ID": X_CM_ID,
            "X-HIP-ID": X_HIP_ID || facilityId,
            Authorization: authToken,
          },
        },
      );

      console.log("Discovery: on-init sent");
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
    console.log(
      "Discovery: link/confirm request received",
      "path:",
      req.path || req.originalUrl,
      "body:",
      JSON.stringify(req.body),
    );

    const requestId =
      req.headers["request-id"] ||
      req.headers["REQUEST-ID"] ||
      req.body.requestId;

    const { transactionId, token, confirmation } = req.body;
    const linkRefNumber = confirmation?.linkRefNumber;
    const otp = confirmation?.token || token;
    const finalTransactionId = transactionId || linkRefNumber;

    if (!finalTransactionId || !requestId) {
      console.log("Discovery: Missing required fields in link/confirm");
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Acknowledged",
      });
    }

    res.status(STATUS_CODE.SUCCESS).json({
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
          // --- Persist ABHA address/number on patient upon successful link confirm ---
          const abhaUpdateData: Record<string, unknown> = {};
          if (abhaAddress && abhaAddress !== (patient as any).abhaaddress) {
            abhaUpdateData.abhaaddress = abhaAddress;
          }
          if (abhaNumber && abhaNumber !== (patient as any).ABHANumber) {
            abhaUpdateData.ABHANumber = abhaNumber;
          }
          // Ensure name field is populated — the ABDM name should have been stored
          // during onLinkInit. If it was missed (e.g. name was empty), fallback to f_name/l_name.
          if (DISCOVERY_UPDATE_PATIENT_NAME) {
            const storedName = (patient as any).name?.trim();
            if (!storedName) {
              const fullName =
                `${(patient as any).f_name || ""} ${(patient as any).l_name || ""}`.trim();
              if (fullName) {
                abhaUpdateData.name = fullName;
                console.log(
                  "Discovery: onLinkConfirm updating patient name (fallback from f_name/l_name):",
                  fullName,
                );
              }
            }
          }
          if (Object.keys(abhaUpdateData).length > 0) {
            abhaUpdateData.abhaLinkedAt = new Date();
            await PatientModel.updateOne(
              { _id: patient._id },
              { $set: abhaUpdateData },
            );
            console.log(
              "Discovery: Persisted ABHA data on patient at link confirm",
              patient.uhid || patient._id,
              abhaUpdateData,
            );
          }

          if (careContextRefs && careContextRefs.length > 0) {
            const ccUpdateData: Record<string, unknown> = {
              linkingStatus: CareContextStatus.LINKED,
              linkedAt: new Date(),
              linkError: null,
            };
            if (abhaAddress) {
              ccUpdateData.abhaAddress = abhaAddress;
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

          // Group contexts by hiType to support multiple types in one confirmation
          const contextsByType = new Map<string, typeof linkedContexts>();

          for (const cc of linkedContexts) {
            const types =
              cc.hiTypes && cc.hiTypes.length > 0
                ? cc.hiTypes
                : ["Prescription"]; // Default fallback
            for (const type of types) {
              if (!contextsByType.has(type)) {
                contextsByType.set(type, []);
              }
              contextsByType.get(type)?.push(cc);
            }
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

          console.log(
            "Discovery: Linked",
            linkedContexts.length,
            "care contexts for patient",
            patient.uhid,
          );

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
        }
      }

      const responseRequestId = generateUID();
      const authToken = await AbdmTokenService.getToken();

      console.log(
        "Discovery: Sending on-confirm payload:",
        JSON.stringify(onConfirmPayload),
      );

      await axios.post(
        `${process.env.ABDM_BASE_URL}${ENDPOINTS.ON_LINK_CONFIRM}`,
        onConfirmPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "REQUEST-ID": responseRequestId,
            TIMESTAMP: new Date().toISOString(),
            "X-CM-ID": X_CM_ID,
            "X-HIP-ID": X_HIP_ID || facilityId,
            Authorization: authToken,
          },
        },
      );

      console.log(
        "Discovery: on-confirm sent",
        onConfirmPayload.error ? "with error" : "success",
      );
    } catch (confirmError: any) {
      console.error(
        "Discovery: Error processing link/confirm",
        confirmError.response?.data || confirmError.message,
      );
    }
  } catch (error: any) {
    console.error("Discovery: link/confirm handler error", error);
    return res.status(STATUS_CODE.SUCCESS).json({
      status: "error",
      message: error.message,
    });
  }
};
