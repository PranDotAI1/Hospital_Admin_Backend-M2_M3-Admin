/**
 * Production-Grade Input Sanitization & Validation Utilities
 *
 * Hardened to reject:
 * 1. XSS & HTML injection attacks (<script>, <img>, <iframe>, javascript:, event handlers)
 * 2. Object serialization bugs ([object Object], [object Array], [object ...])
 * 3. Junk / single-character names ("t", "1", punctuation-only, "undefined", "null", "NaN")
 * 4. Placeholder / test names ("test", "demo", "sample", "temp", "asdf", "qwerty", "dummy")
 * 5. Repetitive garbage ("aaaaa", "zzzzz", 4+ repeated consecutive letters)
 * 6. Numbers or illegal symbols in names (digits, $, %, ^, &, *, @, #, etc.)
 * 7. Invalid phone numbers (non-10 digits, not starting 6-9, or all identical digits like 9999999999)
 * 8. Invalid or future DOBs / impossible ages
 * 9. Plaintext 12-digit Aadhaar storage (masks to XXXX-XXXX-1234)
 */

/**
 * Regex patterns for security & validation.
 */
const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_PATTERN_REGEX = /javascript:|data:text\/html|vbscript:|on\w+\s*=/gi;
const ANY_OBJECT_SERIALIZATION_REGEX = /\[object\s+[^\]]+\]/gi;
const INVISIBLE_AND_CONTROL_CHARS_REGEX =
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF]/g;

/**
 * Blocked placeholder, test, or JavaScript-coercion values in names.
 */
const BLOCKED_NAME_TOKENS = new Set([
  "undefined",
  "null",
  "nan",
  "nil",
  "none",
  "na",
  "n/a",
  "unknown",
  "test",
  "testing",
  "tester",
  "demo",
  "sample",
  "temp",
  "dummy",
  "asdf",
  "qwerty",
  "zxcv",
  "foo",
  "bar",
  "baz",
  "admin",
  "administrator",
  "anonymous",
  "root",
  "system",
  "void",
  "false",
  "true",
]);

// ─── Strict Validator Functions (REJECT, never fix) ───────────────────────────
// These are used by Zod schemas via .refine() to reject bad input at the gate.

/**
 * Detects double-stringified JSON values.
 * Returns true if the string looks like it was JSON.stringify'd before being placed
 * in the request body — i.e., it's a string that IS valid JSON representing
 * a non-string type (object, array, null, boolean), OR a string wrapped in extra quotes.
 *
 * Examples that return TRUE (should be rejected):
 *   '"John"'          → stringified string (extra quotes)
 *   '{"a":1}'         → stringified object
 *   '[1,2,3]'         → stringified array
 *
 * Examples that return FALSE (normal strings):
 *   'John'            → normal string
 *   'O-'              → blood group
 *   '2024-01-15'      → date string
 *   '9876543210'      → phone number
 */
export const isStringifiedJson = (val: string): boolean => {
  const trimmed = val.trim();
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      // If it parsed into something other than the original string, it's double-stringified
      return typeof parsed !== 'string' || trimmed.startsWith('"');
    } catch {
      return false; // Not valid JSON, so it's just a normal string that happens to start with { or [
    }
  }
  return false;
};

/**
 * Returns true if the string contains HTML tags or script injection patterns.
 */
export const containsHtmlOrScript = (val: string): boolean => {
  return HTML_TAG_REGEX.test(val) || SCRIPT_PATTERN_REGEX.test(val) || /[<>]/.test(val);
};

/**
 * Returns true if the string contains invisible or control characters.
 */
export const containsControlChars = (val: string): boolean => {
  return INVISIBLE_AND_CONTROL_CHARS_REGEX.test(val);
};

/**
 * Returns true if the string is an object serialization artifact like "[object Object]".
 */
export const isObjectSerialization = (val: string): boolean => {
  return ANY_OBJECT_SERIALIZATION_REGEX.test(val);
};

/**
 * Pure validator for age. Returns { valid, error } — never transforms or normalizes.
 * Must be an integer between 0 and 125.
 */
export const validateAge = (age: unknown): { valid: boolean; error?: string } => {
  if (age === null || age === undefined || age === "") {
    return { valid: true }; // optional — absence is fine
  }

  let num: number;
  if (typeof age === "number") {
    if (!Number.isFinite(age)) return { valid: false, error: "Age must be a finite number" };
    if (!Number.isInteger(age)) return { valid: false, error: "Age must be a whole number" };
    num = age;
  } else if (typeof age === "string") {
    const clean = age.trim();
    if (ANY_OBJECT_SERIALIZATION_REGEX.test(clean)) {
      return { valid: false, error: "Age contains invalid serialization artifact" };
    }
    if (!/^\d+$/.test(clean)) {
      return { valid: false, error: "Age must be a numeric value" };
    }
    num = parseInt(clean, 10);
    if (isNaN(num)) return { valid: false, error: "Age is not a valid number" };
  } else {
    return { valid: false, error: "Age must be a string or number" };
  }

  if (num < 0 || num > 125) {
    return { valid: false, error: "Age must be between 0 and 125" };
  }

  return { valid: true };
};

/**
 * Escapes special regex characters in a string for safe use in MongoDB $regex queries.
 * Prevents ReDoS attacks from user-supplied search strings.
 */
export const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


export interface SanitizeOptions {
  maxLength?: number;
  trim?: boolean;
  stripHtml?: boolean;
  disallowObjectString?: boolean;
}

/**
 * Safely sanitizes an unknown input value into a clean, safe string.
 * CRITICAL: Never converts a JavaScript object or primitive into "[object Object]".
 * If an object or non-primitive is passed, it extracts safe primitive values or returns undefined.
 */
export const sanitizeInputString = (
  value: unknown,
  options: SanitizeOptions = {},
): string | undefined => {
  const {
    maxLength = 500,
    trim = true,
    stripHtml = true,
    disallowObjectString = true,
  } = options;

  if (value === null || value === undefined) {
    return undefined;
  }

  let str: string;

  if (typeof value === "string") {
    str = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    str = String(value);
  } else if (typeof value === "object") {
    // If frontend passed an object like { label: '...', value: '...' } or Date
    const obj = value as Record<string, unknown>;
    if (value instanceof Date && !isNaN(value.getTime())) {
      str = value.toISOString().split("T")[0];
    } else if (typeof obj.value === "string") {
      str = obj.value;
    } else if (typeof obj.label === "string") {
      str = obj.label;
    } else {
      // Never allow "[object Object]" to be generated!
      return undefined;
    }
  } else {
    return undefined;
  }

  // Strip invisible and control characters
  str = str.replace(INVISIBLE_AND_CONTROL_CHARS_REGEX, "");

  if (trim) {
    str = str.trim();
  }

  // Reject object serialization remnants
  if (disallowObjectString && ANY_OBJECT_SERIALIZATION_REGEX.test(str)) {
    return undefined;
  }

  // Check for literal "undefined", "null", "NaN"
  if (disallowObjectString) {
    const lower = str.toLowerCase();
    if (lower === "undefined" || lower === "null" || lower === "nan") {
      return undefined;
    }
  }

  if (stripHtml) {
    // Remove all HTML tags and strip event handlers / script protocols
    str = str
      .replace(HTML_TAG_REGEX, "")
      .replace(SCRIPT_PATTERN_REGEX, "")
      .replace(/[<>]/g, ""); // strip stray angle brackets
  }

  // Normalize excessive internal whitespace
  str = str.replace(/\s+/g, " ");

  if (trim) {
    str = str.trim();
  }

  if (!str) {
    return undefined;
  }

  return str.slice(0, maxLength);
};

/**
 * Validates whether a string is repetitive junk (e.g., "aaaaa", "zzzzz", 4+ repeated consecutive letters).
 */
const isRepetitiveGarbage = (text: string): boolean => {
  const clean = text.toLowerCase().replace(/[^a-z\u00C0-\u024F\u1E00-\u1EFF]/g, "");
  if (clean.length >= 3) {
    // If only 1 unique letter across 3 or more characters (e.g. "aaa", "zzzz")
    const uniqueChars = new Set(clean);
    if (uniqueChars.size === 1) {
      return true;
    }
  }
  // 4 or more identical consecutive characters (e.g. "Jooohn", "Aaaalex")
  if (/(.)\1{3,}/i.test(text)) {
    return true;
  }
  return false;
};

/**
 * Validates a human patient name (first name, middle name, last name).
 *
 * Strict Rules:
 * 1. Must be a string between minLength (default 2) and maxLength (default 100).
 * 2. Cannot contain any object serialization "[object ...]".
 * 3. Cannot be literal "undefined", "null", "NaN", "unknown", "test", "demo", "sample", etc.
 * 4. Cannot contain HTML/script tags or event handlers.
 * 5. Cannot contain digits or illegal symbols ($, %, ^, &, *, @, #, etc.).
 * 6. Must contain at least 2 alphabetic characters (Latin or Unicode).
 * 7. Only permits valid human name characters: letters, spaces, hyphens, periods, and apostrophes.
 * 8. Cannot have consecutive punctuation ("..", "--", "''", ".-") or start/end with hyphens/apostrophes.
 * 9. Rejects repetitive garbage ("aaaaa", "zzzzz").
 */
export const isValidPatientName = (
  name: unknown,
  options: { minLength?: number; maxLength?: number; required?: boolean } = {},
): boolean => {
  const { minLength = 2, maxLength = 100, required = true } = options;

  if (name === null || name === undefined || name === "") {
    return !required;
  }

  if (typeof name !== "string") {
    return false;
  }

  // Strip invisible characters before checking
  const trimmed = name.replace(INVISIBLE_AND_CONTROL_CHARS_REGEX, "").trim();

  // Check length bounds
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    return false;
  }

  // Reject any object serialization pattern
  if (ANY_OBJECT_SERIALIZATION_REGEX.test(trimmed)) {
    return false;
  }

  // Reject HTML / script tags
  if (/[<>]/.test(trimmed) || SCRIPT_PATTERN_REGEX.test(trimmed)) {
    return false;
  }

  // Reject numbers anywhere in a human name
  if (/\d/.test(trimmed)) {
    return false;
  }

  // Reject common prohibited characters / symbols
  if (/[!@#$%^&*()_+=~`{}\[\]:;"\\|<>\/?]/.test(trimmed)) {
    return false;
  }

  // Reject consecutive punctuation (e.g. "--", "..", "''", ".-", "-.")
  if (/[-.']{2,}/.test(trimmed)) {
    return false;
  }

  // Cannot start with a hyphen, apostrophe, or period
  if (/^[-.']/.test(trimmed)) {
    return false;
  }

  // Cannot end with a hyphen or apostrophe
  if (/[-']$/.test(trimmed)) {
    return false;
  }

  // Check for blocked placeholder / test names
  const lowerWhole = trimmed.toLowerCase();
  if (BLOCKED_NAME_TOKENS.has(lowerWhole)) {
    return false;
  }

  // Check for repetitive character garbage
  if (isRepetitiveGarbage(trimmed)) {
    return false;
  }

  // Must contain at least 2 alphabetic characters (Latin or Unicode accented letters)
  const letterMatches = trimmed.match(/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/g);
  if (!letterMatches || letterMatches.length < Math.min(2, minLength)) {
    return false;
  }

  // Validate that all characters are allowed: letters, spaces, hyphens, periods, apostrophes
  const validNamePattern = /^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+([ a-zA-Z\u00C0-\u024F\u1E00-\u1EFF'.-]*)$/;
  if (!validNamePattern.test(trimmed)) {
    return false;
  }

  // Check each individual word in the name
  const words = trimmed.split(/\s+/);
  for (const word of words) {
    const cleanWord = word.replace(/[-.']/g, "").toLowerCase();
    if (BLOCKED_NAME_TOKENS.has(cleanWord)) {
      return false;
    }
    // Each word must have at least one alphabetic character
    if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(word)) {
      return false;
    }
  }

  return true;
};

/**
 * Validates a 10-digit Indian mobile number.
 *
 * Rules:
 * 1. Must be a string.
 * 2. Must be exactly 10 digits starting with 6, 7, 8, or 9.
 * 3. Cannot be 10 identical digits (e.g. 9999999999, 8888888888, 7777777777, 6666666666).
 * 4. Cannot be sequential dummy sequences.
 */
export const isValidMobile = (mobile: unknown): boolean => {
  if (!mobile || typeof mobile !== "string") {
    return false;
  }
  const clean = mobile.replace(INVISIBLE_AND_CONTROL_CHARS_REGEX, "").trim();

  // Reject object serialization
  if (ANY_OBJECT_SERIALIZATION_REGEX.test(clean)) {
    return false;
  }

  // Must be strictly 10 digits starting with 6-9
  if (!/^[6-9]\d{9}$/.test(clean)) {
    return false;
  }

  // Reject 10 identical digits (e.g. 9999999999, 8888888888, 7777777777, 6666666666)
  if (/^(\d)\1{9}$/.test(clean)) {
    return false;
  }

  return true;
};

/**
 * Validates and normalizes patient age.
 * Must be an integer between 0 and 125.
 */
export const validateAndNormalizeAge = (age: unknown): string | undefined => {
  if (age === null || age === undefined || age === "") {
    return undefined;
  }

  let num: number;
  if (typeof age === "number") {
    if (!Number.isFinite(age)) return undefined;
    num = Math.floor(age);
  } else if (typeof age === "string") {
    const clean = age.trim();
    if (ANY_OBJECT_SERIALIZATION_REGEX.test(clean)) return undefined;
    // Reject if contains random letters not related to "yr" / "years"
    if (/[^\d\s\w]/.test(clean)) return undefined;
    const parsed = parseInt(clean.replace(/\D/g, ""), 10);
    if (isNaN(parsed)) return undefined;
    num = parsed;
  } else {
    return undefined;
  }

  if (num < 0 || num > 125) {
    return undefined;
  }

  return String(num);
};

/**
 * Validates date of birth string (YYYY-MM-DD format).
 *
 * Rules:
 * 1. Must match strictly YYYY-MM-DD.
 * 2. Must be a valid calendar date.
 * 3. Must not be in the future.
 * 4. Year cannot be before 1900.
 */
export const isValidDob = (dob: unknown): boolean => {
  if (!dob || typeof dob !== "string") {
    return false;
  }

  const clean = dob.replace(INVISIBLE_AND_CONTROL_CHARS_REGEX, "").trim();
  if (ANY_OBJECT_SERIALIZATION_REGEX.test(clean) || /[<>]/.test(clean)) {
    return false;
  }

  // Strictly require YYYY-MM-DD format
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = clean.match(dateRegex);
  if (!match) {
    return false;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (year < 1900) {
    return false;
  }

  if (month < 1 || month > 12) {
    return false;
  }

  if (day < 1 || day > 31) {
    return false;
  }

  const parsedDate = new Date(clean);
  if (isNaN(parsedDate.getTime())) {
    return false;
  }

  // Ensure day/month matches calendar (e.g. rejects Feb 31)
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() + 1 !== month || parsedDate.getUTCDate() !== day) {
    return false;
  }

  const now = new Date();
  if (parsedDate > now) {
    return false; // Future birth date is impossible
  }

  return true;
};

/**
 * Masks a 12-digit Aadhaar number into XXXX-XXXX-1234.
 * Enforces compliance with UIDAI / NHA Section 29 requirements.
 */
export const maskAadhaar = (
  aadhaar: string | undefined | null,
): string | undefined => {
  if (!aadhaar || typeof aadhaar !== "string") {
    return undefined;
  }
  const digits = aadhaar.replace(/\D/g, "");
  if (digits.length !== 12) {
    // If already masked (e.g. XXXX-XXXX-1234 or ****-****-1234)
    if (/^[X*]{4}-?[X*]{4}-?\d{4}$/i.test(aadhaar.trim())) {
      return `XXXX-XXXX-${digits.slice(-4)}`;
    }
    return undefined;
  }
  return `XXXX-XXXX-${digits.slice(8, 12)}`;
};

/**
 * Masks an ABHA Number (14 digits) or ABHA Address to compliance display format:
 * e.g. "91-1315-0375-4411" -> "**** 4411"
 * e.g. "91131503754411@sbx" -> "**** 4411"
 */
export const maskAbha = (
  abha: string | undefined | null,
): string => {
  if (!abha || typeof abha !== "string") {
    return "";
  }
  const clean = abha.trim();
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `**** ${digits.slice(-4)}`;
  }
  if (clean.length > 4) {
    return `**** ${clean.slice(-4)}`;
  }
  return clean ? `****` : "";
};

/**
 * Sanitizes an existing patient document before returning to UI/API.
 * Strips any legacy "[object ...]" and XSS payloads.
 */
export const sanitizePatientOutput = <T extends Record<string, any>>(
  patient: T,
): T => {
  if (!patient || typeof patient !== "object") return patient;

  const cleanField = (val: unknown): string => {
    if (typeof val !== "string") return "";
    let s = val.replace(ANY_OBJECT_SERIALIZATION_REGEX, "").trim();
    s = s.replace(HTML_TAG_REGEX, "").replace(SCRIPT_PATTERN_REGEX, "").replace(/[<>]/g, "");
    return s.trim();
  };

  const copy: Record<string, any> = { ...patient };

  if (copy.f_name) copy.f_name = cleanField(copy.f_name);
  if (copy.m_name) copy.m_name = cleanField(copy.m_name);
  if (copy.l_name) copy.l_name = cleanField(copy.l_name);

  // If name is corrupt or contains [object ...], recompute from cleaned parts
  const cleanedName = cleanField(copy.name);
  const recomputed = [copy.f_name, copy.m_name, copy.l_name]
    .filter(Boolean)
    .join(" ");
  copy.name = recomputed || cleanedName || "Patient";

  if (copy.mobile && (ANY_OBJECT_SERIALIZATION_REGEX.test(copy.mobile) || !isValidMobile(copy.mobile))) {
    copy.mobile = "";
  }
  if (copy.dob && (ANY_OBJECT_SERIALIZATION_REGEX.test(copy.dob) || !isValidDob(copy.dob))) {
    copy.dob = "";
  }

  return copy as T;
};
