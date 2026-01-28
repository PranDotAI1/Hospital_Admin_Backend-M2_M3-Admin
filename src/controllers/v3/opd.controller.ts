import axios from "axios";
import QRCode from "qrcode";
import { Request, Response } from "express";
import { OPDVisitModel, VisitStatus, IOPDVisit } from "../../models/OPDVisit";
import { DailyOpdQueueModel } from "../../models/DailyOpdQueue";
import {
  generateUID,
  X_HIP_ID,
  HIP_NAME,
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
    });

    if (existingVisit) {
      console.log(
        "Duplicate scan detected for ABHA:",
        abhaAddress,
        "Existing token:",
        existingVisit.tokenNumber,
      );
      const existingTokenNumber = existingVisit.tokenNumber;
      await callAbdmOnShare(
        abhaAddress,
        context,
        existingTokenNumber,
        requestId,
        req,
        authorization,
      );
      return;
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

    const addressArray = patient?.address || [];
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
      `${process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in"}${ENDPOINTS.HIP_PATIENT_SHARE_ON_SHARE}`,
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
      .sort({ visitDate: -1 })
      .lean();

    const visitsWithAge = pendingVisits.map((visit: any) => {
      const age = visit.dob ? calculateAge(visit.dob) : undefined;
      return {
        _id: visit._id,
        name: visit.name,
        mobile: visit.mobile,
        tokenNumber: visit.tokenNumber,
        visitDate: visit.visitDate,
        age: age,
        gender: visit.gender,
        abhaAddress: visit.abhaAddress,
        aadhaarNumber: visit.aadhaarNumber,
        hprId: visit.hprId,
        latitude: visit.latitude,
        longitude: visit.longitude,
        address: visit.address,
        abhaNumber: visit.abhaNumber,
        counterId: visit.counterId,
        visitStatus: visit.visitStatus,
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

    if (!id) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "id is required",
      });
    }

    const opdVisit = await OPDVisitModel.findOne({
      _id: id,
      visitStatus: VisitStatus.PENDING,
    });

    if (!opdVisit) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Pending visit not found for the given token number",
      });
    }

    const updateData: Partial<IOPDVisit> = {
      visitStatus: VisitStatus.REGISTERED,
    };

    if (manualFields.department !== undefined)
      updateData.department = manualFields.department;
    if (manualFields.doctorName !== undefined)
      updateData.doctorName = manualFields.doctorName;
    if (manualFields.consultationFee !== undefined) {
      updateData.consultationFee = Number(manualFields.consultationFee);
    }
    if (manualFields.complaint !== undefined)
      updateData.complaint = manualFields.complaint;
    if (manualFields.isEmergency !== undefined)
      updateData.isEmergency = Boolean(manualFields.isEmergency);

    if (manualFields.insurance) {
      updateData.insurance = {
        provider: manualFields.insurance.provider,
        policyNumber: manualFields.insurance.policyNumber,
      };
    }

    if (manualFields.payment) {
      updateData.payment = {
        mode: manualFields.payment.mode,
        amount: manualFields.payment.amount
          ? Number(manualFields.payment.amount)
          : undefined,
      };
    }

    if (manualFields.address) {
      updateData.address = {
        line: manualFields.address.line || "",
        district: manualFields.address.district || "",
        state: manualFields.address.state || "",
        pincode: manualFields.address.pincode || "",
      };
    }

    if (manualFields.name !== undefined) updateData.name = manualFields.name;
    if (manualFields.mobile !== undefined)
      updateData.mobile = manualFields.mobile;
    if (manualFields.aadhaarNumber !== undefined)
      updateData.aadhaarNumber = manualFields.aadhaarNumber;
    if (manualFields.dob !== undefined) updateData.dob = manualFields.dob;
    if (manualFields.gender !== undefined)
      updateData.gender = manualFields.gender;

    const updatedVisit = await OPDVisitModel.findByIdAndUpdate(
      opdVisit._id,
      { $set: updateData },
      { new: true },
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Registration completed successfully",
      data: updatedVisit,
    });
  } catch (error: any) {
    console.error("Complete Registration error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to complete registration",
    });
  }
};

export const queueStatus = async (req: Request, res: Response) => {
  try {
    console.log(
      "Queue Status request received:",
      JSON.stringify(req.body, null, 2),
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
        todayDate,
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
      req,
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
  req: Request,
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
      `${process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in"}${ENDPOINTS.HIP_RUNNING_TOKEN_ON_STATUS}`,
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
      },
    );

    console.log(
      "ABDM running token status response:",
      statusResponse.status,
      statusResponse.data,
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
      },
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
      },
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
      `inline; filename="qr-code-${counterIdStr}.png"`,
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
    const {
      fromDate,
      toDate,
      search,
      status,
      page = 1,
      limit = 10,
    } = req.query;

    const query: any = {};

    if (fromDate && toDate) {
      const start = new Date(String(fromDate));
      start.setHours(0, 0, 0, 0);
      const end = new Date(String(toDate));
      end.setHours(23, 59, 59, 999);
      query.visitDate = { $gte: start, $lte: end };
    }

    if (status) {
      query.visitStatus = status;
    }

    if (search) {
      const searchRegex = { $regex: search, $options: "i" };
      query.$or = [
        { name: searchRegex },
        { mobile: searchRegex },
        { abhaAddress: searchRegex },
        { tokenNumber: searchRegex },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const visits = await OPDVisitModel.find(query)
      .sort({ visitDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const total = await OPDVisitModel.countDocuments(query);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: visits,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error("Get All Visits error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch visits",
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
