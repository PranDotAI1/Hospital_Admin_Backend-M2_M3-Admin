/**
 * Password Policy Validator (CERT-In / OWASP compliant)
 *
 * Requirements:
 * - Minimum 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 lowercase letter (a-z)
 * - At least 1 numerical digit (0-9)
 * - At least 1 special character (!@#$%^&*()_+-=[]{};':"|,.<>/?~)
 */
export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export const validatePasswordStrength = (password: string): PasswordValidationResult => {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required" };
  }

  if (password.length < 8) {
    return {
      valid: false,
      message: "Password must be at least 8 characters in length",
    };
  }

  if (password.length > 128) {
    return {
      valid: false,
      message: "Password must not exceed 128 characters",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one uppercase letter (A-Z)",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one lowercase letter (a-z)",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      message: "Password must contain at least one digit (0-9)",
    };
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return {
      valid: false,
      message:
        "Password must contain at least one special character (!@#$%^&*()_+-=[]{};':\"|,.<>/?~)",
    };
  }

  return { valid: true };
};
