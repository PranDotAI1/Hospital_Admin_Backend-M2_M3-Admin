import { z } from "zod";
import { emailSchema, passwordSchema } from "./common.schema";

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const verifyResetTokenSchema = z.object({
  token: z
    .string()
    .min(64, { message: "Invalid token format" })
    .max(64, { message: "Invalid token format" }),
});

export type VerifyResetTokenInput = z.infer<typeof verifyResetTokenSchema>;

export const resetPasswordSchema = z
  .object({
    token: z
      .string()
      .min(64, { message: "Invalid token format" })
      .max(64, { message: "Invalid token format" }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const requestOtpSchema = z.object({
  email: emailSchema,
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  email: emailSchema,
  otp: z
    .string()
    .length(6, { message: "OTP must be exactly 6 digits" })
    .regex(/^\d+$/, { message: "OTP must contain only numbers" }),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

export const resetPasswordOtpSchema = z
  .object({
    email: emailSchema,
    otp: z
      .string()
      .length(6, { message: "OTP must be exactly 6 digits" })
      .regex(/^\d+$/, { message: "OTP must contain only numbers" }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordOtpInput = z.infer<typeof resetPasswordOtpSchema>;
