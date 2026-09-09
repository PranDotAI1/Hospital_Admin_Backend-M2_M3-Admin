import {
  isCommonPassword,
  hasSequentialSequence,
  hasRepeatedCharacters,
} from "./password.blacklist";

/**
 * Enterprise Password Policy Validator (OWASP ASVS & NIST SP 800-63B compliant)
 *
 * Controls Enforced:
 * 1. Minimum 12 characters (recommended 14+), maximum 128 characters
 * 2. At least 1 uppercase letter (A-Z)
 * 3. At least 1 lowercase letter (a-z)
 * 4. At least 1 numerical digit (0-9)
 * 5. At least 1 special character (!@#$%^&*()_+-=[]{};':"|,.<>/?~)
 * 6. Breached / dictionary / guessable password blacklist defense
 * 7. Keyboard & numeric sequential walk defense (e.g. 1234, abcd, qwerty)
 * 8. Excessive character repetition defense (e.g. aaaa, 1111)
 * 9. Contextual identity defense (prevents passwords containing parts of user's name, email, or mobile)
 */

export interface UserPasswordContext {
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  mobile?: string;
}

export interface PasswordValidationResult {
  valid: boolean;
  message?: string;
}

export const validatePasswordStrength = (
  password: string,
  userContext?: UserPasswordContext,
): PasswordValidationResult => {
  if (!password || typeof password !== "string") {
    return { valid: false, message: "Password is required" };
  }

  // 1. Length validation (Min 12, Max 128)
  if (password.length < 12) {
    return {
      valid: false,
      message:
        "Password must be at least 12 characters in length (14+ recommended for high security)",
    };
  }

  if (password.length > 128) {
    return {
      valid: false,
      message: "Password must not exceed 128 characters",
    };
  }

  // 2. Character diversity checks
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
      message: "Password must contain at least one numeric digit (0-9)",
    };
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return {
      valid: false,
      message:
        "Password must contain at least one special character (!@#$%^&*()_+-=[]{};':\"|,.<>/?~)",
    };
  }

  // 3. Breached & common dictionary blacklist check
  if (isCommonPassword(password)) {
    return {
      valid: false,
      message:
        "Password is too common, easily guessable, or appears in known breach databases. Please choose a unique passphrase.",
    };
  }

  // 4. Sequential runs check (e.g. 1234, abcd, qwerty)
  if (hasSequentialSequence(password, 4)) {
    return {
      valid: false,
      message:
        "Password must not contain sequential numbers or keyboard patterns (e.g. 1234, abcd, qwerty)",
    };
  }

  // 5. Repeated character runs check (e.g. aaaa, 1111)
  if (hasRepeatedCharacters(password, 4)) {
    return {
      valid: false,
      message:
        "Password must not contain 4 or more repeated consecutive characters (e.g. aaaa, 1111)",
    };
  }

  // 6. Contextual identity defense
  if (userContext) {
    const lowerPwd = password.toLowerCase();
    const forbiddenTokens: string[] = [];

    // Email local part (e.g. "harshith.reddy" from "harshith.reddy@gmail.com")
    if (userContext.email) {
      const emailLocal = userContext.email.split("@")[0]?.toLowerCase();
      if (emailLocal && emailLocal.length >= 3) {
        forbiddenTokens.push(emailLocal);
        // Also split by common delimiters
        const parts = emailLocal.split(/[._+-]/).filter((p) => p.length >= 3);
        forbiddenTokens.push(...parts);
      }
    }

    // Full name and components
    const nameStrings = [
      userContext.name,
      userContext.firstName,
      userContext.lastName,
    ].filter(Boolean) as string[];

    for (const nameStr of nameStrings) {
      const words = nameStr
        .toLowerCase()
        .split(/[\s._-]+/)
        .filter((w) => w.length >= 3);
      forbiddenTokens.push(...words);
    }

    // Username
    if (userContext.username && userContext.username.length >= 3) {
      forbiddenTokens.push(userContext.username.toLowerCase());
    }

    // Check forbidden tokens
    for (const token of forbiddenTokens) {
      if (lowerPwd.includes(token)) {
        return {
          valid: false,
          message:
            "Password must not contain parts of your name, email address, or username",
        };
      }
    }

    // Mobile number check
    if (userContext.mobile) {
      const cleanMobile = userContext.mobile.replace(/\D/g, "");
      if (cleanMobile.length >= 6) {
        // Check full mobile and last 6+ digits
        if (
          lowerPwd.includes(cleanMobile) ||
          lowerPwd.includes(cleanMobile.slice(-6))
        ) {
          return {
            valid: false,
            message: "Password must not contain your phone number",
          };
        }
      }
    }
  }

  return { valid: true };
};
