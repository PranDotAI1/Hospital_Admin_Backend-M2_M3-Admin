import { z } from "zod";
import {
  isStringifiedJson,
  containsHtmlOrScript,
  containsControlChars,
  isObjectSerialization,
} from "../utils/sanitizer";
import {
  isCommonPassword,
  hasSequentialSequence,
  hasRepeatedCharacters,
} from "../utils/password.blacklist";

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
  .min(12, { message: "Password must be at least 12 characters in length (14+ recommended)" })
  .max(128, { message: "Password must not exceed 128 characters" })
  .regex(/[A-Z]/, {
    message: "Password must contain at least one uppercase letter (A-Z)",
  })
  .regex(/[a-z]/, {
    message: "Password must contain at least one lowercase letter (a-z)",
  })
  .regex(/[0-9]/, {
    message: "Password must contain at least one numeric digit (0-9)",
  })
  .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/, {
    message:
      "Password must contain at least one special character (!@#$%^&*()_+-=[]{};':\"|,.<>/?~)",
  })
  .refine((val) => !isCommonPassword(val), {
    message:
      "Password is too common or easily guessable. Please choose a unique passphrase.",
  })
  .refine((val) => !hasSequentialSequence(val, 4), {
    message:
      "Password must not contain sequential numbers or keyboard patterns (e.g. 1234, abcd, qwerty)",
  })
  .refine((val) => !hasRepeatedCharacters(val, 4), {
    message:
      "Password must not contain 4 or more repeated consecutive characters (e.g. aaaa, 1111)",
  });

export const passwordSchema = strongPasswordSchema;

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

/**
 * Base refinement for safe text fields: rejects double-serialized JSON,
 * HTML/script injection, control characters, and [object Object] artifacts.
 * Use this for any general text field that should accept clean strings only.
 */
export const cleanStringSchema = (maxLength: number = 500) =>
  z
    .string()
    .max(maxLength, { message: `Maximum ${maxLength} characters allowed` })
    .refine((val) => !isStringifiedJson(val), {
      message: "Value appears to be a JSON-stringified string — send the raw value, not JSON.stringify(value)",
    })
    .refine((val) => !containsHtmlOrScript(val), {
      message: "Value contains HTML or script content",
    })
    .refine((val) => !containsControlChars(val), {
      message: "Value contains invisible or control characters",
    })
    .refine((val) => !isObjectSerialization(val), {
      message: "Value contains [object Object] or similar serialization artifact",
    });

/**
 * Optional version of cleanStringSchema — allows undefined/missing but rejects bad strings.
 */
export const optionalCleanStringSchema = (maxLength: number = 500) =>
  z
    .string()
    .max(maxLength, { message: `Maximum ${maxLength} characters allowed` })
    .refine((val) => !isStringifiedJson(val), {
      message: "Value appears to be a JSON-stringified string — send the raw value, not JSON.stringify(value)",
    })
    .refine((val) => !containsHtmlOrScript(val), {
      message: "Value contains HTML or script content",
    })
    .refine((val) => !containsControlChars(val), {
      message: "Value contains invisible or control characters",
    })
    .refine((val) => !isObjectSerialization(val), {
      message: "Value contains [object Object] or similar serialization artifact",
    })
    .optional();
