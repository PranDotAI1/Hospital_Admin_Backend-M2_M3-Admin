import axios from "axios";
import QRCode from "qrcode";
import { Request, Response } from "express";
import { Types } from "mongoose";
import { OPDVisitModel, VisitStatus, IOPDVisit } from "../../models/OPDVisit";
import { DailyOpdQueueModel } from "../../models/DailyOpdQueue";
import { PatientModel, IPatientVisitRef } from "../../models/Patient";
import {
  generateUID,
  X_HIP_ID,
  ABDM_PHR_WEB_BASE_URL,
} from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";
import { STATUS_CODE } from "../../utils/constant";

const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const calculateAge = (dob: string): number | undefined => {
  try {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  } catch (error) {
    return undefined;
  }
};

const isValidObjectId = (id: string): boolean => {
  return /^[a-fA-F0-9]{24}$/.test(id);
};

const sanitizeString = (
  value: unknown,
  maxLength: number = 500,
): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  if (str.length === 0) return undefined;
  return str.slice(0, maxLength);
};

const safeNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  if (isNaN(num) || !isFinite(num)) return undefined;
  return num;
};

const safeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
};

const isValidMobile = (mobile: string): boolean => {
  return /^[6-9]\d{9}$/.test(mobile);
};

const isValidPincode = (pincode: string): boolean => {
  return /^\d{6}$/.test(pincode);
};

const isValidGender = (gender: string): boolean => {
  return ["M", "F", "O", "Male", "Female", "Other"].includes(gender);
};

const isValidDate = (dateStr: string): boolean => {
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && date <= new Date();
};

export const scanAndShareWebhook = async (req: Request, res: Response) => {
  try {
    console.log("entry on scan", JSON.stringify(req.body, null, 2));
    console.log({
      ip: req.ip,
      origin: req.headers.origin,
      referer: req.headers.referer,
      userAgent: req.headers["user-agent"],
    });

    const authorization = req.headers["authorization"];

    res.status(202).json({
      status: "Accepted",
      message: "Request received and processing",
    });

    const webhookBody = req.body;
    const context = webhookBody?.metaData?.context;

    let requestId = (req.headers["request-id"] as string) ?? "";
    if (!requestId) {
      console.warn(
        "WARNING: requestId missing in webhook body. Generating a new one. This will likely cause ABDM-1015 error.",
      );
      requestId = generateUID();
    } else {
      console.log("Found requestId in webhook:", requestId);
    }

    if (!context) {
      console.error("Missing context in metaData:", webhookBody);
      return;
    }

    const profile = webhookBody?.profile;
    const patient = profile?.patient || {};
    const abhaAddress =
      patient?.id || profile?.abhaAddress || patient?.abhaAddress;

    if (!abhaAddress) {
      console.error("Missing ABHA address in webhook payload:", webhookBody);
      return;
    }

    const todayDate = getTodayDateString();

    const startOfToday = new Date(todayDate);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(todayDate);
    endOfToday.setHours(23, 59, 59, 999);

    const existingVisit = await OPDVisitModel.findOne({
      abhaAddress: abhaAddress,
      visitDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    }).sort({ createdAt: -1 });

    if (existingVisit) {
      const existingTokenNum = parseInt(existingVisit.tokenNumber, 10);
      const existingStatus = existingVisit.visitStatus;

      console.log(
        "Existing visit found for ABHA:",
        abhaAddress,
        "Token:",
        existingVisit.tokenNumber,
        "Status:",
        existingStatus
      );

      if (
        existingStatus === VisitStatus.COMPLETED ||
        existingStatus === VisitStatus.CANCELLED ||
        existingStatus === VisitStatus.MISSED ||
        existingStatus === VisitStatus.REGISTERED
      ) {
        console.log(
          `Visit status is ${existingStatus}, allowing new token generation`
        );
      } else {
        const queueDoc = await DailyOpdQueueModel.findOne({
          date: todayDate,
          counterId: context,
        });

        const currentServingToken = queueDoc?.currentServingToken || 0;

        if (currentServingToken > existingTokenNum) {
          console.log(
            `Token ${existingVisit.tokenNumber} missed. Current serving: ${currentServingToken}. Marking as MISSED and issuing new token.`
          );

          await OPDVisitModel.findByIdAndUpdate(existingVisit._id, {
            $set: { visitStatus: VisitStatus.MISSED },
          });

        } else {
          console.log(
            `Token ${existingVisit.tokenNumber} still valid. Current serving: ${currentServingToken}. Returning existing token.`
          );

          await callAbdmOnShare(
            abhaAddress,
            context,
            existingVisit.tokenNumber,
            requestId,
            req,
            authorization
          );
          return;
        }
      }
    }

    const queueDoc = await DailyOpdQueueModel.findOneAndUpdate(
      { date: todayDate, counterId: context },
      { $inc: { lastIssuedToken: 1 } },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    const tokenNumber = queueDoc.lastIssuedToken.toString().padStart(4, "0");

    let addressObj: any = {};
    if (Array.isArray(patient?.address)) {
      addressObj = patient.address.length > 0 ? patient.address[0] : {};
    } else if (patient?.address) {
      addressObj = patient.address;
    }

    let dob = patient?.dateOfBirth || patient?.dob;
    if (
      !dob &&
      patient?.yearOfBirth &&
      patient?.monthOfBirth &&
      patient?.dayOfBirth
    ) {
      dob = `${patient.yearOfBirth}-${patient.monthOfBirth}-${patient.dayOfBirth}`;
    }

    const metaData = webhookBody?.metaData || {};

    const opdVisitData: Partial<IOPDVisit> = {
      tokenNumber,
      visitStatus: VisitStatus.PENDING,
      visitDate: new Date(),
      counterId: context,
      abhaAddress: abhaAddress,
      abhaNumber: patient?.abhaNumber || profile?.abhaNumber,
      name:
        patient?.name ||
        `${patient?.firstName || ""} ${patient?.lastName || ""}`.trim(),
      gender: patient?.gender,
      dob: dob,
      mobile: patient?.mobile || patient?.phoneNumber,
      aadhaarNumber:
        patient?.aadhaarNumber || patient?.aadhaar || patient?.kycId,
      hprId: metaData?.hprId,
      latitude: metaData?.latitude,
      longitude: metaData?.longitude,
      address:
        addressObj?.line || addressObj?.line1
          ? {
              line: addressObj?.line || addressObj?.line1 || "",
              district: addressObj?.district || "",
              state: addressObj?.state || "",
              pincode: addressObj?.pincode || "",
            }
          : undefined,
    };

    const opdVisit = await OPDVisitModel.create(opdVisitData);
    console.log(
      "OPDVisit created:",
      opdVisit._id,
      "Token:",
      tokenNumber,
      "Counter:",
      context,
    );

    await callAbdmOnShare(
      abhaAddress,
      context,
      tokenNumber,
      requestId,
      req,
      authorization,
    );
  } catch (error: any) {
    console.error("Scan & Share Webhook error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
    });
  }
};

const callAbdmOnShare = async (
  abhaAddress: string,
  context: string,
  tokenNumber: string,
  requestId: string,
  req: Request,
  authorization: string | undefined,
) => {
  try {
    const random32String = generateUID();

    const onSharePayload = {
      acknowledgement: {
        status: "SUCCESS",
        abhaAddress: abhaAddress,
        profile: {
          context: context,
          tokenNumber: tokenNumber,
          expiry: "1800",
        },
      },
      response: {
        requestId: requestId,
      },
    };

    const onShareResponse = await axios.post(
      `${process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in"}${
        ENDPOINTS.HIP_PATIENT_SHARE_ON_SHARE
      }`,
      onSharePayload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": random32String,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": "sbx",
          Authorization: authorization || req.headers["authorization"] || "",
        },
        timeout: 10000,
      },
    );

    console.log(
      "ABDM on-share response:",
      onShareResponse.status,
      onShareResponse.data,
    );
  } catch (onShareError: any) {
    console.error("ABDM on-share call failed (non-blocking):", {
      message: onShareError.message,
      response: onShareError.response?.data,
      status: onShareError.response?.status,
      tokenNumber: tokenNumber,
      context: context,
      sentRequestId: requestId,
    });
  }
};

export const getPendingTokens = async (req: Request, res: Response) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const pendingVisits = await OPDVisitModel.find({
      visitStatus: VisitStatus.PENDING,
      visitDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    })
      .sort({ tokenNumber: 1 })
      .lean();

    const visitsWithAge = pendingVisits.map((visit: any) => {
      const age = visit.dob ? calculateAge(visit.dob) : undefined;
      return {
        ...visit,
        age,
      };
    });

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      count: visitsWithAge.length,
      data: visitsWithAge,
    });
  } catch (error: any) {
    console.error("Get Pending Tokens error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch pending tokens",
    });
  }
};

export const completeRegistration = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tokenNumber, ...manualFields } = req.body;

    if (!id || Array.isArray(id)) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Visit ID is required",
      });
    }

    const visitId = String(id);

    if (!isValidObjectId(visitId)) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Invalid visit ID format",
      });
    }

    const validationErrors: string[] = [];

    const mobile = sanitizeString(manualFields.mobile, 15);
    if (mobile && !isValidMobile(mobile)) {
      validationErrors.push(
        "Invalid mobile number format (must be 10 digits starting with 6-9)"
      );
    }

    const gender = sanitizeString(manualFields.gender, 10);
    if (gender && !isValidGender(gender)) {
      validationErrors.push(
        "Invalid gender (must be M, F, O, Male, Female, or Other)"
      );
    }

    const dob = sanitizeString(manualFields.dob, 20);
    if (dob && !isValidDate(dob)) {
      validationErrors.push("Invalid date of birth format or future date");
    }

    const pincode = sanitizeString(manualFields.address?.pincode, 10);
    if (pincode && !isValidPincode(pincode)) {
      validationErrors.push("Invalid pincode format (must be 6 digits)");
    }

    const consultationFee = safeNumber(manualFields.consultationFee);
    if (
      manualFields.consultationFee !== undefined &&
      consultationFee === undefined
    ) {
      validationErrors.push(
        "Invalid consultation fee (must be a valid number)"
      );
    }
    if (consultationFee !== undefined && consultationFee < 0) {
      validationErrors.push("Consultation fee cannot be negative");
    }

    const paymentAmount = safeNumber(manualFields.payment?.amount);
    if (
      manualFields.payment?.amount !== undefined &&
      paymentAmount === undefined
    ) {
      validationErrors.push("Invalid payment amount (must be a valid number)");
    }
    if (paymentAmount !== undefined && paymentAmount < 0) {
      validationErrors.push("Payment amount cannot be negative");
    }

    if (validationErrors.length > 0) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    const opdVisit = await OPDVisitModel.findOne({
      _id: visitId,
      // visitStatus: VisitStatus.PENDING,
    });

    if (!opdVisit) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Pending visit not found for the given token number",
      });
    }

    const updateData: Partial<IOPDVisit> = {
      visitStatus:
        opdVisit?.visitStatus === VisitStatus.COMPLETED
          ? VisitStatus.COMPLETED
          : VisitStatus.REGISTERED,
    };

    const department = sanitizeString(manualFields.department, 100);
    if (department) updateData.department = department;

    const doctorName = sanitizeString(manualFields.doctorName, 100);
    if (doctorName) updateData.doctorName = doctorName;

    if (consultationFee !== undefined) {
      updateData.consultationFee = consultationFee;
    }

    const complaint = sanitizeString(manualFields.complaint, 1000);
    if (complaint) updateData.complaint = complaint;

    const isEmergency = safeBoolean(manualFields.isEmergency);
    if (isEmergency !== undefined) updateData.isEmergency = isEmergency;

    if (manualFields.insurance && typeof manualFields.insurance === "object") {
      const provider = sanitizeString(manualFields.insurance.provider, 100);
      const policyNumber = sanitizeString(
        manualFields.insurance.policyNumber,
        50,
      );
      if (provider || policyNumber) {
        updateData.insurance = {
          provider: provider || "",
          policyNumber: policyNumber || "",
        };
      }
    }

    if (manualFields.payment && typeof manualFields.payment === "object") {
      const mode = sanitizeString(manualFields.payment.mode, 20);
      if (mode || paymentAmount !== undefined) {
        updateData.payment = {
          mode: mode || "",
          amount: paymentAmount,
        };
      }
    }

    if (manualFields.address && typeof manualFields.address === "object") {
      const line = sanitizeString(manualFields.address.line, 200);
      const district = sanitizeString(manualFields.address.district, 50);
      const state = sanitizeString(manualFields.address.state, 50);
      if (line || district || state || pincode) {
        updateData.address = {
          line: line || "",
          district: district || "",
          state: state || "",
          pincode: pincode || "",
        };
      }
    }

    const name = sanitizeString(manualFields.name, 100);
    if (name) updateData.name = name;

    if (mobile) updateData.mobile = mobile;

    const aadhaarNumber = sanitizeString(manualFields.aadhaarNumber, 12);
    if (aadhaarNumber) updateData.aadhaarNumber = aadhaarNumber;

    if (dob) updateData.dob = dob;

    if (gender) updateData.gender = gender;

    const updatedVisit = await OPDVisitModel.findByIdAndUpdate(
      opdVisit._id,
      { $set: updateData },
      { new: true }
    );

    if (opdVisit.counterId && opdVisit.tokenNumber) {
      const todayDate = getTodayDateString();
      const tokenNum = parseInt(opdVisit.tokenNumber, 10);

      if (!isNaN(tokenNum)) {
        await DailyOpdQueueModel.findOneAndUpdate(
          { date: todayDate, counterId: opdVisit.counterId },
          { $set: { currentServingToken: tokenNum } },
          { upsert: false }
        );
      }
    }

    if (updatedVisit && opdVisit.abhaNumber) {
      try {
        const visitRef: IPatientVisitRef = {
          visitId: updatedVisit._id as Types.ObjectId,
          tokenNumber: updatedVisit.tokenNumber,
          visitDate: updatedVisit.visitDate,
          visitStatus: updatedVisit.visitStatus,
          department: updatedVisit.department,
          doctorName: updatedVisit.doctorName,
        };

        const fullName = updatedVisit.name || opdVisit.name || "";
        const nameParts = fullName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const middleName =
          nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : undefined;
        const lastName =
          nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;

        let addressString = "";
        const addr = updatedVisit.address || opdVisit.address;
        if (addr) {
          const parts = [
            addr.line,
            addr.district,
            addr.state,
            addr.pincode,
          ].filter(Boolean);
          addressString = parts.join(", ");
        }

        const existingPatient = await PatientModel.findOne({
          ABHANumber: opdVisit.abhaNumber,
        });

        const visitInsurance = updatedVisit.insurance;
        const hasNewInsurance =
          visitInsurance?.provider || visitInsurance?.policyNumber;

        let patientId: Types.ObjectId;

        if (existingPatient) {
          let shouldAddInsurance = false;
          if (hasNewInsurance) {
            const existingInsurances = existingPatient.insurance || [];
            const insuranceExists = existingInsurances.some(
              (ins) =>
                ins.provider === visitInsurance?.provider &&
                ins.policyNumber === visitInsurance?.policyNumber
            );
            shouldAddInsurance = !insuranceExists;
          }

          const updateOps: any = {
            $push: { visits: visitRef },
            $set: {
              lastVisitDate: updatedVisit.visitDate,
              ...(fullName && { name: fullName }),
              ...(updatedVisit.mobile && { mobile: updatedVisit.mobile }),
              ...(updatedVisit.dob && { dob: updatedVisit.dob }),
              ...(updatedVisit.gender && { gender: updatedVisit.gender }),
              ...(addressString && { address: addressString }),
              ...(addr?.pincode && { pincode: addr.pincode }),
              ...(opdVisit.abhaAddress && {
                abhaaddress: opdVisit.abhaAddress,
              }),
              ...(updatedVisit.aadhaarNumber && {
                aadhaarNumber: updatedVisit.aadhaarNumber,
              }),
            },
            $inc: { totalVisits: 1 },
          };

          if (shouldAddInsurance) {
            updateOps.$push.insurance = {
              provider: visitInsurance?.provider,
              policyNumber: visitInsurance?.policyNumber,
              addedOn: new Date(),
            };
          }

          await PatientModel.findByIdAndUpdate(existingPatient._id, updateOps);
          patientId = existingPatient._id as Types.ObjectId;
          console.log("Patient record updated:", existingPatient._id);
        } else {
          const initialInsurance = hasNewInsurance
            ? [
                {
                  provider: visitInsurance?.provider,
                  policyNumber: visitInsurance?.policyNumber,
                  addedOn: new Date(),
                },
              ]
            : [];

          const newPatient = await PatientModel.create({
            f_name: firstName || "Unknown",
            m_name: middleName,
            l_name: lastName,
            name: fullName || "Unknown",
            mobile: updatedVisit.mobile || opdVisit.mobile || "0000000000",
            dob: updatedVisit.dob || opdVisit.dob || "1900-01-01",
            address: addressString,
            ABHANumber: opdVisit.abhaNumber,
            abhaaddress: opdVisit.abhaAddress,
            gender: updatedVisit.gender || opdVisit.gender,
            status: "active",
            pincode: addr?.pincode,
            aadhaarNumber: updatedVisit.aadhaarNumber || opdVisit.aadhaarNumber,
            visits: [visitRef],
            lastVisitDate: updatedVisit.visitDate,
            totalVisits: 1,
            insurance: initialInsurance,
          });
          patientId = newPatient._id as Types.ObjectId;
          console.log("New patient record created:", newPatient._id);
        }

        await OPDVisitModel.findByIdAndUpdate(updatedVisit._id, {
          $set: { patientId: patientId },
        });
      } catch (patientError: any) {
        console.error("Error updating patient record:", {
          message: patientError.message,
          abhaNumber: opdVisit.abhaNumber,
        });
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Registration completed successfully",
      data: updatedVisit,
    });
  } catch (error: any) {
    console.error("Complete Registration error:", {
      message: error.message,
      stack: error.stack,
      id: req.params?.id,
    });
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: "Failed to complete registration. Please try again.",
    });
  }
};

export const queueStatus = async (req: Request, res: Response) => {
  try {
    console.log(
      "Queue Status request received:",
      JSON.stringify(req.body, null, 2)
    );

    res.status(202).json({
      status: "Accepted",
      message: "Request received and processing",
    });

    const webhookBody = req.body;
    const context = webhookBody?.context || webhookBody?.metaData?.context;
    const requestId =
      webhookBody?.requestId ||
      webhookBody?.response?.requestId ||
      generateUID();

    if (!context) {
      console.error("Missing context in queue status request:", webhookBody);
      return;
    }

    const todayDate = getTodayDateString();
    const queueDoc = await DailyOpdQueueModel.findOne({
      date: todayDate,
      counterId: context,
    });

    if (!queueDoc) {
      console.error(
        "Queue not found for context:",
        context,
        "date:",
        todayDate
      );
      await callAbdmRunningTokenStatus(context, "0", 10, requestId, req);
      return;
    }

    const currentServingToken = queueDoc.currentServingToken
      .toString()
      .padStart(4, "0");
    const avgServiceTime = queueDoc.avgServiceTime;

    await callAbdmRunningTokenStatus(
      context,
      currentServingToken,
      avgServiceTime,
      requestId,
      req
    );
  } catch (error: any) {
    console.error("Queue Status error:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
    });
  }
};

const callAbdmRunningTokenStatus = async (
  context: string,
  tokenNumber: string,
  avgServiceTime: number,
  requestId: string,
  req: Request
) => {
  try {
    const random32String = generateUID();

    const statusPayload = {
      runningTokenStatus: {
        status: "SUCCESS",
        tokenNumber: tokenNumber,
        avgServiceTime: avgServiceTime.toString(),
      },
      response: {
        requestId: requestId,
      },
    };

    const statusResponse = await axios.post(
      `${process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in"}${
        ENDPOINTS.HIP_RUNNING_TOKEN_ON_STATUS
      }`,
      statusPayload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": random32String,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": "sbx",
          Authorization: req.headers["authorization"] || "",
        },
        timeout: 10000,
      }
    );

    console.log(
      "ABDM running token status response:",
      statusResponse.status,
      statusResponse.data
    );
  } catch (statusError: any) {
    console.error("ABDM running token status call failed (non-blocking):", {
      message: statusError.message,
      response: statusError.response?.data,
      status: statusError.response?.status,
      context: context,
    });
  }
};

export const nextPatient = async (req: Request, res: Response) => {
  try {
    const { counterId } = req.body;

    if (!counterId) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "counterId is required",
      });
    }

    const todayDate = getTodayDateString();

    const queueDoc = await DailyOpdQueueModel.findOneAndUpdate(
      { date: todayDate, counterId: counterId },
      { $inc: { currentServingToken: 1 } },
      {
        upsert: false,
        new: true,
      }
    );

    if (!queueDoc) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Queue not found for the given counterId and date",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Queue updated successfully",
      data: {
        counterId: queueDoc.counterId,
        currentServingToken: queueDoc.currentServingToken
          .toString()
          .padStart(4, "0"),
        lastIssuedToken: queueDoc.lastIssuedToken.toString().padStart(4, "0"),
        avgServiceTime: queueDoc.avgServiceTime,
      },
    });
  } catch (error: any) {
    console.error("Next Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to update queue",
    });
  }
};

export const getQueueStatusDetails = async (req: Request, res: Response) => {
  try {
    const { counterId } = req.query;
    const todayDate = getTodayDateString();

    const query: any = { date: todayDate };
    if (counterId) {
      query.counterId = counterId;
    }

    const queueDocs = await DailyOpdQueueModel.find(query).lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: queueDocs,
    });
  } catch (error: any) {
    console.error("Get Queue Status error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch queue status",
    });
  }
};

export const getTokenDetails = async (req: Request, res: Response) => {
  try {
    const { tokenNumber, date } = req.query;

    if (!tokenNumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "tokenNumber is required",
      });
    }

    let queryDateStart, queryDateEnd;
    if (date) {
      const dateStr = String(date);
      const startOfDay = new Date(dateStr);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateStr);
      endOfDay.setHours(23, 59, 59, 999);
      queryDateStart = startOfDay;
      queryDateEnd = endOfDay;
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      queryDateStart = today;
      queryDateEnd = todayEnd;
    }

    const visit = await OPDVisitModel.findOne({
      tokenNumber: String(tokenNumber),
      visitDate: {
        $gte: queryDateStart,
        $lte: queryDateEnd,
      },
    }).lean();

    if (!visit) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Visit not found for this token number on the specified date",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: visit,
    });
  } catch (error: any) {
    console.error("Get Token Details error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch token details",
    });
  }
};

export const updateCurrentServing = async (req: Request, res: Response) => {
  try {
    const { counterId, currentServingToken } = req.body;

    if (!counterId || currentServingToken === undefined) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "counterId and currentServingToken are required",
      });
    }

    const todayDate = getTodayDateString();

    const queueDoc = await DailyOpdQueueModel.findOneAndUpdate(
      { date: todayDate, counterId: counterId },
      { $set: { currentServingToken: Number(currentServingToken) } },
      {
        upsert: false,
        new: true,
      }
    );

    if (!queueDoc) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Queue not found for the given counterId today",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Current serving token updated successfully",
      data: queueDoc,
    });
  } catch (error: any) {
    console.error("Update Serving Token error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to update serving token",
    });
  }
};

export const generateQrCode = async (req: Request, res: Response) => {
  try {
    const { counterId } = req.query;

    if (!counterId) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "counterId is required",
      });
    }

    const hipId = X_HIP_ID;
    const counterIdStr = counterId.toString().trim();

    const payloadString = `${ABDM_PHR_WEB_BASE_URL}/share-profile?hip-id=${hipId}&counter-id=${counterIdStr}`;

    const qrCodeImage = await QRCode.toDataURL(payloadString);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: {
        qrCode: qrCodeImage,
        payload: payloadString,
      },
    });
  } catch (error: any) {
    console.error("Generate QR Code error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to generate QR code",
    });
  }
};

export const generateQrCodePreview = async (req: Request, res: Response) => {
  try {
    const { counterId } = req.query;

    if (!counterId) {
      return res.status(STATUS_CODE.ERROR).send("counterId is required");
    }

    const hipId = X_HIP_ID;
    const counterIdStr = counterId.toString().trim();

    const payloadString = `${ABDM_PHR_WEB_BASE_URL}/share-profile?hip-id=${hipId}&counter-id=${counterIdStr}`;

    const qrCodeBuffer = await QRCode.toBuffer(payloadString, {
      type: "png",
      width: 400,
      margin: 2,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="qr-code-${counterIdStr}.png"`
    );

    return res.status(STATUS_CODE.SUCCESS).send(qrCodeBuffer);
  } catch (error: any) {
    console.error("Generate QR Code Preview error:", error);
    return res
      .status(STATUS_CODE.ERROR)
      .send("Failed to generate QR code preview");
  }
};

export const getOPDStats = async (req: Request, res: Response) => {
  try {
    const todayDate = getTodayDateString();
    const startOfToday = new Date(todayDate);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(todayDate);
    endOfToday.setHours(23, 59, 59, 999);

    const matchQuery = {
      visitDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    };

    const stats = await OPDVisitModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [{ $eq: ["$visitStatus", VisitStatus.PENDING] }, 1, 0],
            },
          },
          registered: {
            $sum: {
              $cond: [{ $eq: ["$visitStatus", VisitStatus.REGISTERED] }, 1, 0],
            },
          },
          completed: {
            $sum: {
              $cond: [{ $eq: ["$visitStatus", VisitStatus.COMPLETED] }, 1, 0],
            },
          },
          cancelled: {
            $sum: {
              $cond: [{ $eq: ["$visitStatus", VisitStatus.CANCELLED] }, 1, 0],
            },
          },
          missed: {
            $sum: {
              $cond: [{ $eq: ["$visitStatus", VisitStatus.MISSED] }, 1, 0],
            },
          },
        },
      },
    ]);

    const data =
      stats.length > 0
        ? stats[0]
        : {
            total: 0,
            pending: 0,
            registered: 0,
            completed: 0,
            cancelled: 0,
            missed: 0,
          };
    delete data._id;

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: data,
    });
  } catch (error: any) {
    console.error("Get OPD Stats error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch OPD stats",
    });
  }
};

export const getAllVisits = async (req: Request, res: Response) => {
  try {
    const { from, to, search, status, page, limit } = req.query;

    const validationErrors: string[] = [];
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 10;
    const MAX_LIMIT = 100;

    if (isNaN(pageNum) || pageNum < 1) {
      validationErrors.push("Invalid page number (must be a positive integer)");
    }
    if (isNaN(limitNum) || limitNum < 1) {
      validationErrors.push("Invalid limit (must be a positive integer)");
    }
    // if (limitNum > MAX_LIMIT) {
    //   validationErrors.push(`Limit cannot exceed ${MAX_LIMIT}`);
    // }

    const validStatuses = Object.values(VisitStatus) as string[];
    let normalizedStatus: string | undefined;

    if (status) {
      const statusStr = String(status).toUpperCase().trim();
      if (statusStr !== "ALL" && !validStatuses.includes(statusStr)) {
        validationErrors.push(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}, or ALL`
        );
      } else if (statusStr !== "ALL") {
        normalizedStatus = statusStr;
      }
    }

    let startDate: Date;
    let endDate: Date;

    if (from) {
      const fromStr = sanitizeString(String(from), 20);
      if (!fromStr || !isValidDate(fromStr)) {
        validationErrors.push("Invalid from date format");
      } else {
        startDate = new Date(fromStr);
        startDate.setHours(0, 0, 0, 0);
      }

      if (to) {
        const toStr = sanitizeString(String(to), 20);
        if (!toStr || !isValidDate(toStr)) {
          validationErrors.push("Invalid to date format");
        } else {
          endDate = new Date(toStr);
          endDate.setHours(23, 59, 59, 999);
        }
      } else {
        endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
      }

      if (startDate! && endDate! && startDate! > endDate!) {
        validationErrors.push("from date cannot be after to date");
      }
    } else {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    }

    if (validationErrors.length > 0) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Validation failed",
        errors: validationErrors,
      });
    }

    const query: Record<string, unknown> = {
      visitDate: { $gte: startDate!, $lte: endDate! },
    };

    if (normalizedStatus) {
      query.visitStatus = normalizedStatus;
    }

    if (search) {
      const searchStr = sanitizeString(String(search), 100);
      if (searchStr) {
        const escapedSearch = searchStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const searchRegex = { $regex: escapedSearch, $options: "i" };
        query.$or = [
          { name: searchRegex },
          { mobile: searchRegex },
          { abhaAddress: searchRegex },
          { tokenNumber: searchRegex },
        ];
      }
    }

    const safePage = Math.max(1, pageNum);
    const safeLimit = Math.min(Math.max(1, limitNum), MAX_LIMIT);
    const skip = (safePage - 1) * safeLimit;
    const [visits, total] = await Promise.all([
      OPDVisitModel.find(query)
        .sort({ visitDate: -1, tokenNumber: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      OPDVisitModel.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / safeLimit);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: visits,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPrevPage: safePage > 1,
      },
    });
  } catch (error: any) {
    console.error("Get All Visits error:", {
      message: error.message,
      stack: error.stack,
      query: req.query,
    });
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: "Failed to fetch visits. Please try again.",
    });
  }
};

export const cancelVisit = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Visit ID is required",
      });
    }

    const visit = await OPDVisitModel.findById(id);

    if (!visit) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Visit not found",
      });
    }

    if (
      visit.visitStatus === VisitStatus.COMPLETED ||
      visit.visitStatus === VisitStatus.CANCELLED
    ) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: `Cannot cancel visit with status ${visit.visitStatus}`,
      });
    }

    visit.visitStatus = VisitStatus.CANCELLED;
    await visit.save();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Visit cancelled successfully",
      data: visit,
    });
  } catch (error: any) {
    console.error("Cancel Visit error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to cancel visit",
    });
  }
};

export const getPatientVisitHistory = async (req: Request, res: Response) => {
  try {
    const { abhaAddress } = req.params;

    if (!abhaAddress) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "ABHA address is required",
      });
    }

    const visits = await OPDVisitModel.find({ abhaAddress })
      .sort({ visitDate: -1 })
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      count: visits.length,
      data: visits,
    });
  } catch (error: any) {
    console.error("Get Patient History error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch patient history",
    });
  }
};
