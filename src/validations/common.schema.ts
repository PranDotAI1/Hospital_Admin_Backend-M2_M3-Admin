import { z } from "zod";

const OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

export const mongoIdSchema = z.string().regex(OBJECT_ID_REGEX, {
  message: "Invalid ID format",
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const emailSchema = z
  .string()
  .email({ message: "Invalid email format" })
  .toLowerCase()
  .trim();

export const phoneSchema = z
  .string()
  .min(10, { message: "Phone number must be at least 10 digits" })
  .max(15, { message: "Phone number must be at most 15 digits" })
  .regex(/^[+]?[\d\s-]+$/, { message: "Invalid phone number format" });

export const strongPasswordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters" })
  .regex(/[A-Z]/, {
    message: "Password must contain at least one uppercase letter",
  })
  .regex(/[a-z]/, {
    message: "Password must contain at least one lowercase letter",
  })
  .regex(/[0-9]/, { message: "Password must contain at least one number" });

export const passwordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters" });

export const idParamSchema = z.object({
  id: mongoIdSchema,
});

export const requiredString = z
  .string()
  .min(1, { message: "This field is required" })
  .trim();

export const optionalString = z.string().trim().optional();

export const searchSchema = z.object({
  search: z.string().trim().optional(),
});
