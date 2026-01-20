import { Router } from "express";
import { login, logout } from "../../../controllers/login.controller";
import {
  forgotPassword,
  verifyResetToken,
  resetPassword,
  requestOtp,
  verifyOtp,
  resetPasswordWithOtp,
} from "../../../controllers/password.controller";
import { checkToken } from "../../../middlewares/user.authentication";
import { validate } from "../../../middlewares/validate";
import { asyncHandler } from "../../../utils/asyncHandler";
import {
  loginSchema,
  forgotPasswordSchema,
  verifyResetTokenSchema,
  resetPasswordSchema,
  requestOtpSchema,
  verifyOtpSchema,
  resetPasswordOtpSchema,
} from "../../../validations/auth.schema";

const router = Router();

router.post("/login", validate(loginSchema), asyncHandler(login));
router.get("/logout", checkToken, asyncHandler(logout));

router.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  asyncHandler(forgotPassword),
);

router.post(
  "/verify-reset-token",
  validate(verifyResetTokenSchema),
  asyncHandler(verifyResetToken),
);

router.post(
  "/reset-password",
  validate(resetPasswordSchema),
  asyncHandler(resetPassword),
);

// OTP Flow Routes
router.post(
  "/forgot-password-otp",
  validate(requestOtpSchema),
  asyncHandler(requestOtp),
);

router.post("/verify-otp", validate(verifyOtpSchema), asyncHandler(verifyOtp));

router.post(
  "/reset-password-otp",
  validate(resetPasswordOtpSchema),
  asyncHandler(resetPasswordWithOtp),
);

export default router;
