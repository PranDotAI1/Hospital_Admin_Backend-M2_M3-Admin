import crypto from "crypto";
import { Request, Response } from "express";
import { UserModel } from "../models/User";
import { hashPassword, comparePassword, apiResponse } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { MSG } from "../utils/msgs";
import { validatePasswordStrength } from "../utils/password.validator";
import {
  sendPasswordResetEmail,
  sendOtpEmail,
} from "../services/email.service";
import { sendOTPUnified } from "../services/twilio.otp.service";
import { revokeAllUserSessions } from "../services/session.service";
import type {
  ForgotPasswordInput,
  VerifyResetTokenInput,
  ResetPasswordInput,
  RequestOtpInput,
  VerifyOtpInput,
  ResetPasswordOtpInput,
  ChangePasswordInput,
} from "../validations/auth.schema";

const PASSWORD_RESET_EXPIRY_MINUTES = parseInt(
  process.env.PASSWORD_RESET_EXPIRY_MINUTES || "15",
  10,
);
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_HOURS = 1;
const PASSWORD_HISTORY_COUNT = 5;
const MAX_OTP_VERIFY_ATTEMPTS = 5;

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
  lastAttempt: Date | undefined | null,
): boolean => {
  if (!lastAttempt) return false;

  const windowMs = RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000;
  const timeSinceLastAttempt = Date.now() - new Date(lastAttempt).getTime();

  if (timeSinceLastAttempt > windowMs) {
    return false;
  }

  return attempts >= RATE_LIMIT_MAX_ATTEMPTS;
};

// ─── 1. FORGOT PASSWORD (EMAIL LINK FLOW) ──────────────────────────────────

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
      console.error("[FORGOT_PASSWORD] Failed to send email:", error?.message || error);
    });

    return genericResponse();
  } catch (error) {
    console.error("[FORGOT_PASSWORD_ERROR]", error);
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
    }).select("_id");

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
    console.error("[VERIFY_RESET_TOKEN_ERROR]", error);
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
    }).select(
      "_id email name mobile f_name l_name firstName lastName password previous_passwords",
    );

    if (!user) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    const strength = validatePasswordStrength(password, {
      email: user.email,
      name:
        user.name ||
        `${user.f_name || user.firstName || ""} ${user.l_name || user.lastName || ""}`.trim(),
      mobile: user.mobile,
    });
    if (!strength.valid) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        strength.message || "Password does not meet complexity requirements",
      );
    }

    if (user.password && (await comparePassword(password, user.password))) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "New password cannot be the same as your current password",
      );
    }

    if (await isPasswordInHistory(password, (user.previous_passwords as string[]) || [])) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    const hashedPassword = await hashPassword(password);

    const previousPasswords: string[] = [
      ...((user.previous_passwords as string[]) || []),
    ];
    if (user.password) {
      previousPasswords.unshift(user.password);
    }
    const trimmedHistory = previousPasswords.slice(0, PASSWORD_HISTORY_COUNT);

    await UserModel.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordResetAttempts: 0,
      failedLoginAttempts: 0,
      lockUntil: null,
      previous_passwords: trimmedHistory,
    });

    // Invalidate all active sessions across all devices for this user
    await revokeAllUserSessions(user._id);

    return apiResponse(
      res,
      null,
      STATUS_CODE.SUCCESS,
      MSG.PASSWORD_RESET_SUCCESS,
    );
  } catch (error) {
    console.error("[RESET_PASSWORD_ERROR]", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

// ─── 2. OTP FLOW (EMAIL + READY FOR SMS) ───────────────────────────────────

export const requestOtp = async (
  req: Request<unknown, unknown, RequestOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, mobile } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
    }).select("email name mobile passwordResetAttempts passwordResetLastAttempt");

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
    const hashedOtp = hashToken(otp);

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
      otpAttempts: 0,
      passwordResetAttempts: isNewWindow
        ? 1
        : (user.passwordResetAttempts || 0) + 1,
      passwordResetLastAttempt: new Date(),
    });

    // ── Email Delivery (Active) ──
    sendOtpEmail({
      to: user.email || "",
      userName: user.name || "User",
      otp: otp,
      expiryMinutes: PASSWORD_RESET_EXPIRY_MINUTES,
    }).catch((error) => {
      console.error("[REQUEST_OTP] Failed to send OTP email:", error?.message || error);
    });

    // ── SMS Delivery (Prepared - Uncomment or enable via ENABLE_SMS_PASSWORD_RESET=true) ──
    const enableSms = process.env.ENABLE_SMS_PASSWORD_RESET === "true";
    const targetMobile = mobile || user.mobile;
    if (enableSms && targetMobile) {
      sendOTPUnified(targetMobile, otp).catch((error) => {
        console.error("[REQUEST_OTP] Failed to send SMS OTP:", error?.message || error);
      });
    }

    return genericResponse();
  } catch (error) {
    console.error("[REQUEST_OTP_ERROR]", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const verifyOtp = async (
  req: Request<unknown, unknown, VerifyOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, otp } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      otpExpires: { $gt: new Date() },
    }).select("_id reset_otp otpAttempts");

    if (!user || !user.reset_otp) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    // WASA Brute-force protection: invalidate after max attempts
    if ((user.otpAttempts || 0) >= MAX_OTP_VERIFY_ATTEMPTS) {
      await UserModel.findByIdAndUpdate(user._id, {
        reset_otp: null,
        otpExpires: null,
        otpAttempts: 0,
      });
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "Too many failed OTP verification attempts. Please request a new OTP.",
      );
    }

    const hashedOtp = hashToken(otp);

    if (user.reset_otp !== hashedOtp) {
      await UserModel.findByIdAndUpdate(user._id, {
        $inc: { otpAttempts: 1 },
      });
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "Incorrect OTP. Please try again.",
      );
    }

    return apiResponse(
      res,
      { valid: true },
      STATUS_CODE.SUCCESS,
      "OTP is valid",
    );
  } catch (error) {
    console.error("[VERIFY_OTP_ERROR]", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

export const resetPasswordWithOtp = async (
  req: Request<unknown, unknown, ResetPasswordOtpInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { email, otp, password } = req.body;

    const user = await UserModel.findOne({
      email: email.toLowerCase(),
      otpExpires: { $gt: new Date() },
    }).select(
      "_id email name mobile f_name l_name firstName lastName password reset_otp otpAttempts previous_passwords",
    );

    if (!user || !user.reset_otp) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RESET_INVALID,
      );
    }

    const strength = validatePasswordStrength(password, {
      email: user.email,
      name:
        user.name ||
        `${user.f_name || user.firstName || ""} ${user.l_name || user.lastName || ""}`.trim(),
      mobile: user.mobile,
    });
    if (!strength.valid) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        strength.message || "Password does not meet complexity requirements",
      );
    }

    // WASA Brute-force protection check
    if ((user.otpAttempts || 0) >= MAX_OTP_VERIFY_ATTEMPTS) {
      await UserModel.findByIdAndUpdate(user._id, {
        reset_otp: null,
        otpExpires: null,
        otpAttempts: 0,
      });
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "Too many failed OTP verification attempts. Please request a new OTP.",
      );
    }

    const hashedOtp = hashToken(otp);
    if (user.reset_otp !== hashedOtp) {
      await UserModel.findByIdAndUpdate(user._id, {
        $inc: { otpAttempts: 1 },
      });
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "Incorrect OTP. Please try again.",
      );
    }

    if (user.password && (await comparePassword(password, user.password))) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "New password cannot be the same as your current password",
      );
    }

    if (await isPasswordInHistory(password, (user.previous_passwords as string[]) || [])) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    const hashedPassword = await hashPassword(password);

    const previousPasswords: string[] = [
      ...((user.previous_passwords as string[]) || []),
    ];
    if (user.password) {
      previousPasswords.unshift(user.password);
    }
    const trimmedHistory = previousPasswords.slice(0, PASSWORD_HISTORY_COUNT);

    await UserModel.findByIdAndUpdate(user._id, {
      password: hashedPassword,
      reset_otp: null,
      otpExpires: null,
      otpAttempts: 0,
      passwordResetAttempts: 0,
      failedLoginAttempts: 0,
      lockUntil: null,
      previous_passwords: trimmedHistory,
    });

    // Invalidate all active sessions across all devices for this user
    await revokeAllUserSessions(user._id);

    return apiResponse(
      res,
      null,
      STATUS_CODE.SUCCESS,
      MSG.PASSWORD_RESET_SUCCESS,
    );
  } catch (error) {
    console.error("[RESET_PASSWORD_WITH_OTP_ERROR]", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};

// ─── 3. AUTHENTICATED CHANGE PASSWORD ──────────────────────────────────────

export const changePassword = async (
  req: Request<unknown, unknown, ChangePasswordInput>,
  res: Response,
): Promise<Response> => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user?.id || (req as any).user?._id;

    if (!userId) {
      return apiResponse(res, null, STATUS_CODE.UNAUTHORIZED, MSG.UNAUTHORIZED);
    }

    const user = await UserModel.findById(userId).select(
      "+password email name mobile f_name l_name firstName lastName previous_passwords",
    );

    if (!user) {
      return apiResponse(res, null, STATUS_CODE.NOT_FOUND, MSG.USER_NOT_FOUND);
    }

    const strength = validatePasswordStrength(newPassword, {
      email: user.email,
      name:
        user.name ||
        `${user.f_name || user.firstName || ""} ${user.l_name || user.lastName || ""}`.trim(),
      mobile: user.mobile,
    });
    if (!strength.valid) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        strength.message || "Password does not meet complexity requirements",
      );
    }

    if (!user.password) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "User does not have a password set",
      );
    }

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.INVALID_PASSWORD,
      );
    }

    if (await comparePassword(newPassword, user.password)) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        "New password cannot be the same as the current password",
      );
    }

    if (await isPasswordInHistory(newPassword, (user.previous_passwords as string[]) || [])) {
      return apiResponse(
        res,
        null,
        STATUS_CODE.BAD_REQUEST,
        MSG.PASSWORD_RECENTLY_USED,
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    const previousPasswords: string[] = [
      ...((user.previous_passwords as string[]) || []),
    ];
    previousPasswords.unshift(user.password);
    const trimmedHistory = previousPasswords.slice(0, PASSWORD_HISTORY_COUNT);

    await UserModel.findByIdAndUpdate(userId, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null,
      passwordResetAttempts: 0,
      previous_passwords: trimmedHistory,
    });

    // Invalidate all active sessions across all devices for this user
    await revokeAllUserSessions(userId);

    return apiResponse(
      res,
      null,
      STATUS_CODE.SUCCESS,
      MSG.PASSWORD_RESET_SUCCESS,
    );
  } catch (error) {
    console.error("[CHANGE_PASSWORD_ERROR]", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.INTERNAL_SERVER_ERROR);
  }
};
