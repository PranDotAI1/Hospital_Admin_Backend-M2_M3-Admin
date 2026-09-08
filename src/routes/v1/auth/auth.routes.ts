import { Router } from "express";
import {
  forgotPassword,
  verifyResetToken,
  resetPassword,
  requestOtp,
  verifyOtp,
  resetPasswordWithOtp,
  changePassword,
} from "../../../controllers/password.controller";
import { checkToken } from "../../../middlewares/user.authentication";
import { passwordResetLimiter } from "../../../middlewares/rate.limiter";
import { validate } from "../../../middlewares/validate";
import { asyncHandler } from "../../../utils/asyncHandler";
import {
  forgotPasswordSchema,
  verifyResetTokenSchema,
  resetPasswordSchema,
  requestOtpSchema,
  verifyOtpSchema,
  resetPasswordOtpSchema,
  changePasswordSchema,
} from "../../../validations/auth.schema";

const router = Router();

// ── Email Link Reset Flow ──
router.post(
  "/forgot-password",
  passwordResetLimiter,
  validate(forgotPasswordSchema),
  asyncHandler(forgotPassword),
);

router.post(
  "/verify-reset-token",
  passwordResetLimiter,
  validate(verifyResetTokenSchema),
  asyncHandler(verifyResetToken),
);

router.post(
  "/reset-password",
  passwordResetLimiter,
  validate(resetPasswordSchema),
  asyncHandler(resetPassword),
);

// ── OTP Reset Flow (Email & Prepared SMS) ──
router.post(
  "/forgot-password-otp",
  passwordResetLimiter,
  validate(requestOtpSchema),
  asyncHandler(requestOtp),
);

router.post(
  "/verify-otp",
  passwordResetLimiter,
  validate(verifyOtpSchema),
  asyncHandler(verifyOtp),
);

router.post(
  "/reset-password-otp",
  passwordResetLimiter,
  validate(resetPasswordOtpSchema),
  asyncHandler(resetPasswordWithOtp),
);

// ── Authenticated Change Password ──
router.post(
  "/change-password",
  checkToken,
  validate(changePasswordSchema),
  asyncHandler(changePassword),
);

export default router;
