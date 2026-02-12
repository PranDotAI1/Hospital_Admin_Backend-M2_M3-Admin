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
} from "../../utils/constant";
import { AbdmTokenService } from "../../services/abdm.token.service";

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
        onDiscoverPayload.patient = results.map((result) => {
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
        });
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
      const profile = {
        referenceNumber: patientData.referenceNumber ?? patientData.ref_num ?? patientData.reference_number,
        id: patientData.id ?? patientData.abhaAddress ?? patientData.abha_address ?? bodyAbha,
        name: patientData.name ?? patientData.display,
        gender: patientData.gender,
        yearOfBirth: patientData.yearOfBirth != null ? Number(patientData.yearOfBirth) : undefined,
        verifiedIdentifiers: patientData.verifiedIdentifiers ?? patientData.verified_identifiers ?? [],
        unverifiedIdentifiers: patientData.unverifiedIdentifiers ?? patientData.unverified_identifiers ?? [],
      } as LinkInitProfile;

      console.log(
        "Discovery: onLinkInit identify patient — referenceNumber:",
        profile.referenceNumber,
        "abhaId:",
        profile.id || "(none)",
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
        if (abhaAddress || abhaNumber) {
          const updateData: Record<string, unknown> = {};
          if (abhaAddress && abhaAddress !== (dbPatient as any).abhaaddress) {
            updateData.abhaaddress = abhaAddress;
          }
          if (abhaNumber && abhaNumber !== (dbPatient as any).ABHANumber) {
            updateData.ABHANumber = abhaNumber;
          }
          if (Object.keys(updateData).length > 0) {
            updateData.abhaLinkedAt = new Date();
            await PatientModel.updateOne({ _id: dbPatient._id }, { $set: updateData });
            if (careContextRefs?.length && abhaAddress) {
              await CareContextModel.updateMany(
                { patientId: dbPatient._id, careContextReference: { $in: careContextRefs } },
                { $set: { abhaAddress } },
              );
            }
            const refreshedPatient = await PatientModel.findById(dbPatient._id).lean();
            if (refreshedPatient && !CareContextService.isLinkTokenValid(refreshedPatient as any)) {
              setImmediate(() => {
                CareContextService.requestLinkToken(refreshedPatient as any).catch((err) =>
                  console.warn("Discovery: link token request (post-ABHA persist) failed:", err?.message),
                );
              });
            }
          }
        }

        const otp = await DiscoveryService.generateLinkOTP(
          transactionId,
          dbPatient._id.toString(),
          dbPatient.mobile,
          careContextRefs,
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
        const { patientId, careContextRefs } = verification;

        const patient = await PatientModel.findById(patientId);
        if (!patient) {
          onConfirmPayload.error = {
            code: 1000,
            message: "Patient not found",
          };
        } else {
          if (careContextRefs && careContextRefs.length > 0) {
            await CareContextModel.updateMany(
              {
                careContextReference: { $in: careContextRefs },
                patientId: patient._id,
              },
              {
                $set: {
                  linkingStatus: CareContextStatus.LINKED,
                  linkedAt: new Date(),
                  linkError: null,
                },
              },
            );
          }

          const linkedContexts = await CareContextModel.find({
            careContextReference: { $in: careContextRefs || [] },
            patientId: patient._id,
          }).lean();

          const patientName =
            patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim();

          onConfirmPayload.patient = [
            {
              referenceNumber: patient.uhid || patient._id.toString(),
              display: patientName,
              careContexts: linkedContexts.map((cc) => ({
                referenceNumber: cc.careContextReference,
                display: cc.display,
              })),
              hiType:
                linkedContexts.length > 0
                  ? linkedContexts[0].hiTypes[0]
                  : "Prescription",
              count: linkedContexts.length,
            },
          ];

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
