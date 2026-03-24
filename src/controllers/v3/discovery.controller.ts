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

const applyNameSplit = (updateData: Record<string, unknown>, fullName: string) => {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 0) {
    updateData.f_name = parts[0];
    if (parts.length > 1) {
      updateData.l_name = parts[parts.length - 1];
      updateData.m_name = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
    } else {
      updateData.l_name = "";
      updateData.m_name = "";
    }
  }
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
        // --- Persist ABHA data and name from discover request onto matched patients ---
        try {
          const discoverProfile = {
            id: patient.id,
            verifiedIdentifiers: patient.verifiedIdentifiers || [],
            unverifiedIdentifiers: patient.unverifiedIdentifiers || [],
          } as import("../../services/discovery.service").LinkInitProfile;

          const { abhaAddress, abhaNumber } = extractAbhaFromProfile(discoverProfile);
          const discoveryName = patient.name?.trim();

          console.log(
            "Discovery: onDiscover extracted — abhaAddress:",
            abhaAddress || "(none)",
            "abhaNumber:",
            abhaNumber || "(none)",
            "name:",
            discoveryName || "(none)",
          );

          if (abhaAddress || abhaNumber || discoveryName) {
            for (const result of results) {
              const refNum = result.referenceNumber;
              // Find the patient by UHID or _id (referenceNumber)
              const matchedPatient = await PatientModel.findOne({
                $or: [
                  { uhid: refNum },
                  ...(refNum.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: refNum }] : []),
                ],
              });
              if (matchedPatient) {
                const updateData: Record<string, unknown> = {};
                if (abhaAddress && abhaAddress !== (matchedPatient as any).abhaaddress) {
                  updateData.abhaaddress = abhaAddress;
                }
                if (abhaNumber && abhaNumber !== (matchedPatient as any).ABHANumber) {
                  updateData.ABHANumber = abhaNumber;
                }
                if (DISCOVERY_UPDATE_PATIENT_NAME && discoveryName) {
                  updateData.name = discoveryName;
                  applyNameSplit(updateData, discoveryName);
                }
                if (Object.keys(updateData).length > 0) {
                  updateData.abhaLinkedAt = new Date();
                  await PatientModel.updateOne(
                    { _id: matchedPatient._id },
                    { $set: updateData },
                  );
                  console.log(
                    "Discovery: onDiscover persisted ABHA data on patient",
                    matchedPatient.uhid || matchedPatient._id,
                    JSON.stringify(updateData),
                  );
                }
              }
            }
          }
        } catch (persistErr: any) {
          console.warn(
            "Discovery: onDiscover ABHA persist failed (non-blocking):",
            persistErr?.message,
          );
        }

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

      const verifiedIds = [
        ...(patientData.verifiedIdentifiers ?? []),
      ];

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

      console.log(
        "Discovery: onLinkInit profile —",
        JSON.stringify(profile),
      );

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
        const { abhaAddress, abhaNumber } = extractAbhaFromProfile(profile);
        const updateData: Record<string, unknown> = {};

        if (abhaAddress && abhaAddress !== (dbPatient as any).abhaaddress) {
          updateData.abhaaddress = abhaAddress;
        }
        if (abhaNumber && abhaNumber !== (dbPatient as any).ABHANumber) {
          updateData.ABHANumber = abhaNumber;
        }

        // Update patient name from discovery data
        const discoveryName = profile.name?.trim();
        if (DISCOVERY_UPDATE_PATIENT_NAME && discoveryName) {
          updateData.name = discoveryName;
          applyNameSplit(updateData, discoveryName);
        }

        if (Object.keys(updateData).length > 0) {
          updateData.abhaLinkedAt = new Date();
          await PatientModel.updateOne(
            { _id: dbPatient._id },
            { $set: updateData },
          );
          console.log(
            "Discovery: onLinkInit persisted on patient",
            dbPatient.uhid || dbPatient._id,
            JSON.stringify(updateData),
          );
          if (careContextRefs?.length && abhaAddress) {
            await CareContextModel.updateMany(
              {
                patientId: dbPatient._id,
                careContextReference: { $in: careContextRefs },
              },
              { $set: { abhaAddress } },
            );
          }
          const refreshedPatient = await PatientModel.findById(
            dbPatient._id,
          ).lean();
          if (
            refreshedPatient &&
            !CareContextService.isLinkTokenValid(refreshedPatient as any)
          ) {
            setImmediate(() => {
              CareContextService.requestLinkToken(
                refreshedPatient as any,
              ).catch((err) =>
                console.warn(
                  "Discovery: link token request (post-ABHA persist) failed:",
                  err?.message,
                ),
              );
            });
          }
        }

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
        const { patientId, careContextRefs, abhaAddress, abhaNumber } = verification;

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
              const fullName = `${(patient as any).f_name || ''} ${(patient as any).l_name || ''}`.trim();
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
          const refreshedPatient = await PatientModel.findById(patient._id).lean();
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
