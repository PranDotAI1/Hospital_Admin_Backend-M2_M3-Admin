import { Router } from "express";
import { login, logout } from "../../../controllers/login.controller";
import {
  forgotPassword,
  verifyResetToken,
  resetPassword,
} from "../../../controllers/password.controller";
import { checkToken } from "../../../middlewares/user.authentication";
import { validate } from "../../../middlewares/validate";
import { asyncHandler } from "../../../utils/asyncHandler";
import {
  loginSchema,
  forgotPasswordSchema,
  verifyResetTokenSchema,
  resetPasswordSchema,
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

export default router;
