import crypto from "crypto";
import { Request, Response } from "express";
import { UserModel } from "../models/User";
import { hashPassword, comparePassword, apiResponse } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { MSG } from "../utils/msgs";
import {
  sendPasswordResetEmail,
  sendOtpEmail,
} from "../services/email.service";
import type {
  ForgotPasswordInput,
  VerifyResetTokenInput,
  ResetPasswordInput,
  RequestOtpInput,
  VerifyOtpInput,
  ResetPasswordOtpInput,
} from "../validations/auth.schema";

const PASSWORD_RESET_EXPIRY_MINUTES = parseInt(
  process.env.PASSWORD_RESET_EXPIRY_MINUTES || "15",
  10,
);
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_HOURS = 1;
const PASSWORD_HISTORY_COUNT = 3;

const generateSecureToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

const generateOtp = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const isPasswordInHistory = async (
  password: string,
  previousPasswords: string[],
): Promise<boolean> => {
  if (!previousPasswords || previousPasswords.length === 0) {
    return false;
  }

  for (const hashedPassword of previousPasswords) {
    if (await comparePassword(password, hashedPassword)) {
      return true;
    }
  }
  return false;
};

const isRateLimited = (
  attempts: number,
  lastAttempt: Date | undefined,
): boolean => {
  if (!lastAttempt) return false;

  const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
  const timeSinceLastAttempt = Date.now() - new Date(lastAttempt).getTime();

  if (timeSinceLastAttempt > windowMs) {
    return false;
  }

  return attempts >= RATE_LIMIT_MAX_ATTEMPTS;
};

export const forgotPassword = async (
  req: Request<unknown, unknown, ForgotPasswordInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
    }).select("email name passwordResetAttempts passwordResetLastAttempt");

    const genericResponse = () =>
      apiResponse(res, null, STATUS_CODE.SUCCESS, MSG.PASSWORD_RESET_SENT);

    if (!user) {
      return genericResponse();
    }

    if (
      isRateLimited(
        user.passwordResetAttempts || 0,
        user.passwordResetLastAttempt,
      )
    ) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RATE_LIMITED,
      );
    }

    const plainToken = generateSecureToken();
    const hashedToken = hashToken(plainToken);

    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
    );

    const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;

    const lastAttempt = user.passwordResetLastAttempt;

    const isNewWindow =
      !lastAttempt || Date.now() - new Date(lastAttempt).getTime() > windowMs;

    await UserModel.findByIdAndUpdate(user._id, {
      passwordResetToken: hashedToken,
      passwordResetExpires: expiresAt,
      passwordResetAttempts: isNewWindow
        ? 1
        : (user.passwordResetAttempts || 0) + 1,
      passwordResetLastAttempt: new Date(),
    });

    sendPasswordResetEmail({
      to: user.email || "",
      userName: user.name || "User",
      resetToken: plainToken,
      expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    }).catch((error) => {
      console.error("Failed to send password reset email:", error);
    });

    return genericResponse();
  } catch (error) {
    console.error("Forgot password error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const verifyResetToken = async (
  req: Request<unknown, unknown, VerifyResetTokenInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { token } = req.body;

    const hashedToken = hashToken(token);

    const user = await UserModel.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select("_id email");

    if (!user) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    return apiResponse(
      res,
      { valid: true },
      STATUS_CODE.SUCCESS,
      "Token is valid",
    );
  } catch (error) {
    console.error("Verify reset token error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const resetPassword = async (
  req: Request<unknown, unknown, ResetPasswordInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { token, password } = req.body;

    const hashedToken = hashToken(token);

    const user = await UserModel.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select("_id password previous_passwords");

    if (!user) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    if (user.password && (await comparePassword(password, user.password))) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    if (await isPasswordInHistory(password, user.previous_passwords || [])) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    const hashedPassword = await hashPassword(password);

    const previousPasswords: string[] = [...(user.previous_passwords || [])];
    if (user.password) {
      previousPasswords.unshift(user.password);
    }
    const trimmedHistory = previousPasswords.slice(0, PASSWORD_HISTORY_COUNT);

    await UserModel.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordResetAttempts: 0,
      previous_passwords: trimmedHistory,
    });

    return apiResponse(
      res,
      null,
      STATUS_CODE.SUCCESS,
      MSG.PASSWORD_RESET_SUCCESS,
    );
  } catch (error) {
    console.error("Reset password error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const requestOtp = async (
  req: Request<unknown, unknown, RequestOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
    }).select("email name passwordResetAttempts passwordResetLastAttempt");

    const genericResponse = () =>
      apiResponse(res, null, STATUS_CODE.SUCCESS, MSG.PASSWORD_RESET_SENT);

    if (!user) {
      return genericResponse();
    }

    if (
      isRateLimited(
        user.passwordResetAttempts || 0,
        user.passwordResetLastAttempt,
      )
    ) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RATE_LIMITED,
      );
    }

    const otp = generateOtp();
    const hashedOtp = hashToken(otp); // Reuse hashToken for OTPs as well

    const expiresAt = new Date(
      Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000,
    );

    const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
    const lastAttempt = user.passwordResetLastAttempt;
    const isNewWindow =
      !lastAttempt || Date.now() - new Date(lastAttempt).getTime() > windowMs;

    await UserModel.findByIdAndUpdate(user._id, {
      reset_otp: hashedOtp,
      otpExpires: expiresAt,
      passwordResetAttempts: isNewWindow
        ? 1
        : (user.passwordResetAttempts || 0) + 1,
      passwordResetLastAttempt: new Date(),
    });

    sendOtpEmail({
      to: user.email || "",
      userName: user.name || "User",
      otp: otp,
      expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    }).catch((error) => {
      console.error("Failed to send OTP email:", error);
    });

    return genericResponse();
  } catch (error) {
    console.error("Request OTP error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const verifyOtp = async (
  req: Request<unknown, unknown, VerifyOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, otp } = req.body;

    const hashedOtp = hashToken(otp);

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      reset_otp: hashedOtp,
      otpExpires: { $gt: new Date() },
    }).select("_id email");

    if (!user) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    return apiResponse(
      res,
      { valid: true },
      STATUS_CODE.SUCCESS,
      "OTP is valid",
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const resetPasswordWithOtp = async (
  req: Request<unknown, unknown, ResetPasswordOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, otp, password } = req.body;

    const hashedOtp = hashToken(otp);

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      reset_otp: hashedOtp,
      otpExpires: { $gt: new Date() },
    }).select("_id password previous_passwords");

    if (!user) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    if (user.password && (await comparePassword(password, user.password))) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    if (await isPasswordInHistory(password, user.previous_passwords || [])) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    const hashedPassword = await hashPassword(password);

    const previousPasswords: string[] = [...(user.previous_passwords || [])];
    if (user.password) {
      previousPasswords.unshift(user.password);
    }
    const trimmedHistory = previousPasswords.slice(0, PASSWORD_HISTORY_COUNT);

    await UserModel.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      reset_otp: null,
      otpExpires: null,
      passwordResetAttempts: 0,
      previous_passwords: trimmedHistory,
    });

    return apiResponse(
      res,
      null,
      STATUS_CODE.SUCCESS,
      MSG.PASSWORD_RESET_SUCCESS,
    );
  } catch (error) {
    console.error("Reset password with OTP error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};
