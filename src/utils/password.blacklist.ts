/**
 * Breached & Commonly Used Passwords Blacklist
 * Compiled from OWASP Top 10, SecLists, and NIST SP 800-63B guidelines.
 * Rejects common dictionary words, obvious medical/hospital defaults, and predictable sequences.
 */

// Normalized (lowercase) set of top breached, default, and guessable passwords
export const COMMON_PASSWORDS_SET = new Set<string>([
  "password",
  "password123",
  "password1234",
  "password12345",
  "p@ssword123",
  "p@ssword1234",
  "p@ssword!",
  "p@$$w0rd",
  "admin",
  "admin123",
  "admin1234",
  "admin12345",
  "admin@123",
  "admin@1234",
  "administrator",
  "administrator1",
  "welcome",
  "welcome1",
  "welcome123",
  "welcome@123",
  "welcome@1234",
  "hospital",
  "hospital123",
  "hospital@123",
  "hospital@1234",
  "doctor",
  "doctor123",
  "doctor@123",
  "medical",
  "medical123",
  "medical@123",
  "clinic123",
  "health123",
  "healthcare@123",
  "pranai@123",
  "pranai123",
  "qwerty",
  "qwerty123",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "12345678",
  "123456789",
  "1234567890",
  "123456789012",
  "0987654321",
  "letmein",
  "letmein123",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "master",
  "superman",
  "shadow",
  "michael",
  "jordan",
  "charlie",
  "trustno1",
  "starwars",
  "default",
  "default123",
  "changeme",
  "changeme123",
  "temporary",
  "temporary123",
  "secret",
  "secret123",
  "passcode",
  "passcode123",
  "testing123",
  "test1234",
  "user1234",
  "root1234",
  "system1234",
]);

/**
 * Checks if a password matches or contains an obvious common dictionary word
 */
export const isCommonPassword = (password: string): boolean => {
  const normalized = password.toLowerCase().trim();

  // 1. Direct match
  if (COMMON_PASSWORDS_SET.has(normalized)) {
    return true;
  }

  // 2. Base word match without trailing digits or special characters
  // e.g. "Welcome@2024!" -> "welcome"
  const stripped = normalized.replace(/[^a-z]/g, "");
  if (stripped.length >= 4 && COMMON_PASSWORDS_SET.has(stripped)) {
    // If the stripped base word is a common root and makes up most of the password
    if (stripped.length >= normalized.length * 0.5) {
      return true;
    }
  }

  return false;
};

/**
 * Detects obvious sequential keyboard walks or number runs:
 * e.g. "123456", "abcdef", "qwertyuiop"
 */
export const hasSequentialSequence = (password: string, minRun: number = 4): boolean => {
  const lower = password.toLowerCase();
  const sequences = [
    "01234567890",
    "98765432109",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
  ];

  for (const seq of sequences) {
    for (let i = 0; i <= seq.length - minRun; i++) {
      const sub = seq.substring(i, i + minRun);
      if (lower.includes(sub)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Detects excessive repeated characters:
 * e.g. "aaaaa", "11111", "!!!!!!"
 */
export const hasRepeatedCharacters = (password: string, maxRepeat: number = 4): boolean => {
  const regex = new RegExp(`(.)\\1{${maxRepeat - 1},}`);
  return regex.test(password);
};
