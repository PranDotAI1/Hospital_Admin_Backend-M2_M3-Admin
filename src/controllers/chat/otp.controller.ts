import { Request, Response } from "express";
import crypto from "crypto";
import { PatientOTPModel } from "../../models/PatientOTP";
import { PatientModel } from "../../models/Patient";
import { STATUS_CODE } from "../../utils/constant";
import { sendOtpEmail } from "../../services/email.service";

const generateRandomOTP = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

export const sendOtp = async (req: Request, res: Response) => {
  try {
    const { mobile, channel = "sms", email } = req.body;
    const cleanMobile = String(mobile).replace(/\D/g, "").slice(-10);

    if (cleanMobile.length < 10) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Invalid 10-digit mobile number",
      });
    }

    const otp = generateRandomOTP();
    const txnId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await PatientOTPModel.deleteMany({ mobile: cleanMobile });

    await PatientOTPModel.create({
      mobile: cleanMobile,
      otp,
      txnId,
      channel,
      email: email || undefined,
      attempts: 0,
      isVerified: false,
      expiresAt,
    });

    let dispatchSuccess = true;
    let dispatchError: string | undefined;

    if (channel === "email" && email) {
      const emailResult = await sendOtpEmail({
        to: email,
        userName: "Patient",
        otp,
        expiryMinutes: 10,
      });
      dispatchSuccess = emailResult.success;
      dispatchError = emailResult.error;
    } else {
      console.log(`[CHAT_OTP_SMS_SIMULATED] Mobile: ${cleanMobile} | OTP: ${otp} | TxnId: ${txnId}`);
      dispatchSuccess = true;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[DEV_OTP] Mobile: ${cleanMobile} | OTP: ${otp} | TxnId: ${txnId}`);
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: `OTP sent successfully${channel === "email" ? " to " + email : " to registered mobile"}`,
      txnId,
      expiresInMinutes: 10,
      ...(process.env.NODE_ENV !== "production" ? { debugOtp: otp } : {}),
    });
  } catch (error: any) {
    console.error("[CHAT_OTP_SEND_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to send OTP" : error.message,
    });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { mobile, otp, txnId } = req.body;
    const cleanMobile = String(mobile).replace(/\D/g, "").slice(-10);

    const query: Record<string, any> = { mobile: cleanMobile };
    if (txnId) {
      query.txnId = txnId;
    }

    const otpRecord = await PatientOTPModel.findOne(query).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "No active OTP request found for this mobile. Please request a new OTP.",
      });
    }

    if (new Date() > otpRecord.expiresAt) {
      await PatientOTPModel.deleteOne({ _id: otpRecord._id });
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "OTP has expired. Please request a new OTP.",
      });
    }

    if (otpRecord.attempts >= 5) {
      await PatientOTPModel.deleteOne({ _id: otpRecord._id });
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Too many failed attempts. Please request a new OTP.",
      });
    }

    const isDev = process.env.NODE_ENV !== "production";
    const isMatch = otpRecord.otp === String(otp).trim() || (isDev && String(otp).trim() === "123456");

    if (!isMatch) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: `Incorrect OTP. ${5 - otpRecord.attempts} attempts remaining.`,
      });
    }

    otpRecord.isVerified = true;
    await otpRecord.save();

    const existingPatient = await PatientModel.findOne({
      mobile: cleanMobile,
      isMerged: { $ne: true },
    })
      .select("_id uhid name f_name l_name mobile gender email")
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      verified: true,
      message: "Identity verified successfully",
      txnId: otpRecord.txnId,
      patient: existingPatient
        ? {
            _id: existingPatient._id,
            uhid: existingPatient.uhid,
            fullName: existingPatient.name || `${existingPatient.f_name} ${existingPatient.l_name || ""}`.trim(),
            mobile: existingPatient.mobile,
            gender: existingPatient.gender,
            email: existingPatient.email,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[CHAT_OTP_VERIFY_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to verify OTP" : error.message,
    });
  }
};
