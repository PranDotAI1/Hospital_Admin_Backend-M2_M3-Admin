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
import {
  getSessions,
  revokeSession,
  logoutAllDevices,
  markSessionTrusted,
} from "../../../controllers/session.controller";
import { auth } from "../../../middlewares/user.authentication";
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
router.post("/logout", auth(), asyncHandler(logout));

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

router.get("/sessions", auth(), asyncHandler(getSessions));

router.post("/sessions/logout-all", auth(), asyncHandler(logoutAllDevices));

router.delete("/sessions/:sessionId", auth(), asyncHandler(revokeSession));

router.post(
  "/sessions/:sessionId/trust",
  auth(),
  asyncHandler(markSessionTrusted),
);

export default router;
