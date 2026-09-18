import crypto from "crypto";
import fs from "fs";
import path from "path";

// ─── CONSTANTS & CONFIGURATION ──────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB strict maximum
export const MAX_FILE_COUNT = 10;

export const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Storage directory outside web root (web root is /public)
export const SECURE_STORAGE_DIR =
  process.env.SECURE_STORAGE_PATH ||
  path.resolve(process.cwd(), "storage/secure_uploads");

// Ensure secure storage directory exists with restricted permissions
export function ensureSecureStorageDir(): string {
  if (!fs.existsSync(SECURE_STORAGE_DIR)) {
    fs.mkdirSync(SECURE_STORAGE_DIR, { recursive: true, mode: 0o750 });
  }
  return SECURE_STORAGE_DIR;
}

// ─── FILENAME SANITIZATION & EXTENSION CHECK ───────────────────────────────────

/**
 * Sanitizes original filename:
 * - Strips directory traversal sequences (../, ..\)
 * - Strips null bytes and control characters
 * - Strips potentially dangerous characters
 * - Blocks hidden files and double extension evasion (e.g. evil.php.pdf, script.sh.png)
 */
export function sanitizeAndValidateFileName(rawName: string): {
  isValid: boolean;
  sanitizedName: string;
  extension: string;
  error?: string;
} {
  if (!rawName || typeof rawName !== "string" || rawName.trim() === "") {
    return {
      isValid: false,
      sanitizedName: "",
      extension: "",
      error: "Filename cannot be empty.",
    };
  }

  // Detect null byte injection
  if (rawName.includes("\0") || rawName.includes("%00")) {
    return {
      isValid: false,
      sanitizedName: "",
      extension: "",
      error: "Filename contains illegal null bytes.",
    };
  }

  // Strip path traversal sequences and path separators
  let baseName = path.basename(rawName.trim());
  baseName = baseName.replace(/^[.\/\\]+/, ""); // Remove leading dots or slashes

  if (baseName === "" || baseName === "." || baseName === "..") {
    return {
      isValid: false,
      sanitizedName: "",
      extension: "",
      error: "Invalid filename path sequence.",
    };
  }

  // Normalize extension to lowercase
  const ext = path.extname(baseName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as AllowedExtension)) {
    return {
      isValid: false,
      sanitizedName: "",
      extension: "",
      error: `File extension '${ext}' is not permitted. Allowed extensions: ${ALLOWED_EXTENSIONS.join(", ")}`,
    };
  }

  // Check for dangerous double extensions (e.g., shell.php.pdf, script.exe.png, payload.sh.jpg)
  const nameParts = baseName.toLowerCase().split(".");
  if (nameParts.length > 2) {
    const dangerousExtensions = [
      "php", "php3", "php4", "php5", "phtml", "phar",
      "exe", "bat", "cmd", "sh", "bash", "ps1", "vbs",
      "js", "mjs", "cjs", "jsx", "ts", "tsx",
      "html", "htm", "xhtml", "svg", "xml", "jsp", "asp", "aspx",
      "cgi", "pl", "py", "rb", "jar", "war", "dll", "so", "dylib",
    ];

    for (let i = 1; i < nameParts.length - 1; i++) {
      if (dangerousExtensions.includes(nameParts[i])) {
        return {
          isValid: false,
          sanitizedName: "",
          extension: "",
          error: `Potential double-extension evasion detected (${nameParts[i]}.${ext}). Upload rejected.`,
        };
      }
    }
  }

  // Strip dangerous characters, retain only alphanumeric, spaces, dashes, underscores, and dots
  const sanitized = baseName.replace(/[^a-zA-Z0-9_\-\. ]/g, "_");

  return {
    isValid: true,
    sanitizedName: sanitized,
    extension: ext,
  };
}

// ─── MAGIC BYTES (FILE SIGNATURE) VALIDATION ────────────────────────────────────

export interface MagicByteResult {
  isValid: boolean;
  detectedMimeType: AllowedMimeType | null;
  detectedExtension: AllowedExtension | null;
  error?: string;
}

/**
 * Validates the actual binary content of the buffer against known file signatures (magic bytes).
 */
export function detectMagicBytes(buffer: Buffer): MagicByteResult {
  if (!buffer || buffer.length < 4) {
    return {
      isValid: false,
      detectedMimeType: null,
      detectedExtension: null,
      error: "File buffer is empty or too small to verify file signature.",
    };
  }

  // 1. PDF Signature: starts with %PDF- (0x25 0x50 0x44 0x46 0x2D)
  // According to the PDF specification, the %PDF- header must appear within the first 1024 bytes.
  const headerSearchLimit = Math.min(buffer.length, 1024);
  const headerChunk = buffer.subarray(0, headerSearchLimit).toString("latin1");
  if (headerChunk.includes("%PDF-") || headerChunk.includes("%PDF")) {
    return {
      isValid: true,
      detectedMimeType: "application/pdf",
      detectedExtension: ".pdf",
    };
  }

  // 2. JPEG Signature: starts with 0xFF 0xD8 0xFF
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      isValid: true,
      detectedMimeType: "image/jpeg",
      detectedExtension: ".jpg",
    };
  }

  // 3. PNG Signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A (\x89PNG\r\n\x1a\n)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 && // P
    buffer[2] === 0x4e && // N
    buffer[3] === 0x47 && // G
    buffer[4] === 0x0d && // \r
    buffer[5] === 0x0a && // \n
    buffer[6] === 0x1a && // Ctrl-Z
    buffer[7] === 0x0a    // \n
  ) {
    return {
      isValid: true,
      detectedMimeType: "image/png",
      detectedExtension: ".png",
    };
  }

  return {
    isValid: false,
    detectedMimeType: null,
    detectedExtension: null,
    error: "File content does not match any allowed file signature (magic bytes). Only authentic PDF, JPG, and PNG files are accepted.",
  };
}

// ─── DEEP CONTENT SCANNER & MALICIOUS PATTERN DETECTION ─────────────────────────

export interface ScanResult {
  isSafe: boolean;
  threatDetails?: string;
}

/**
 * Performs deep heuristic scanning on the binary buffer to detect:
 * - Executable headers (Windows PE/DOS MZ, Linux ELF, Mac Mach-O, Java class, Wasm)
 * - Scripting tags (PHP, shell scripts, JSP/ASP, HTML/JS injection)
 * - PDF active malicious content (/JavaScript, /Launch, /EmbeddedFile)
 * - Image polyglot scripts / webshell payloads
 */
export function scanForMaliciousContent(
  buffer: Buffer,
  detectedMimeType: AllowedMimeType,
): ScanResult {
  if (!buffer || buffer.length === 0) {
    return { isSafe: false, threatDetails: "Empty file buffer." };
  }

  // 1. Executable Header Checks
  // DOS / Windows PE header ('MZ' at byte 0)
  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      isSafe: false,
      threatDetails: "Windows executable header (MZ) detected. Upload rejected.",
    };
  }

  // Linux ELF binary ('\x7fELF' at byte 0)
  if (
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      isSafe: false,
      threatDetails: "Linux ELF executable header detected. Upload rejected.",
    };
  }

  // Mac Mach-O headers
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf)) ||
      (buffer[0] === 0xce && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) ||
      (buffer[0] === 0xca && buffer[1] === 0xfe && buffer[2] === 0xba && buffer[3] === 0xbe))
  ) {
    return {
      isSafe: false,
      threatDetails: "Mach-O / Java Class executable header detected. Upload rejected.",
    };
  }

  // Shell script shebang ('#!' at byte 0)
  if (buffer[0] === 0x23 && buffer[1] === 0x21) {
    return {
      isSafe: false,
      threatDetails: "Shell script shebang (#!) detected. Upload rejected.",
    };
  }

  // WebAssembly magic number ('\0asm')
  if (
    buffer[0] === 0x00 &&
    buffer[1] === 0x61 &&
    buffer[2] === 0x73 &&
    buffer[3] === 0x6d
  ) {
    return {
      isSafe: false,
      threatDetails: "WebAssembly binary detected. Upload rejected.",
    };
  }

  // 2. General Server-Side Scripting & Injection Detection across all files
  // Sample search in buffer: scan first 64KB and last 64KB, or entire buffer if small
  const sampleText =
    buffer.length <= 131072
      ? buffer.toString("latin1")
      : buffer.subarray(0, 65536).toString("latin1") +
        buffer.subarray(buffer.length - 65536).toString("latin1");

  const dangerousScriptPatterns = [
    /<\?php/i,
    /<\?=/i,
    /<script\b/i,
    /<iframe\b/i,
    /<object\b/i,
    /<embed\b/i,
    /<applet\b/i,
    /<form\b/i,
    /javascript:/i,
    /vbscript:/i,
    /onload\s*=/i,
    /onerror\s*=/i,
    /eval\s*\(/i,
    /system\s*\(/i,
    /passthru\s*\(/i,
    /shell_exec\s*\(/i,
    /base64_decode\s*\(/i,
    /<%[\s\S]*?%>/, // ASP / JSP tags
  ];

  for (const pattern of dangerousScriptPatterns) {
    if (pattern.test(sampleText)) {
      return {
        isSafe: false,
        threatDetails: `Potentially malicious script payload detected (${pattern.toString()}). Upload rejected.`,
      };
    }
  }

  // 3. Format-Specific Deep Inspections
  if (detectedMimeType === "application/pdf") {
    // Check for malicious PDF active content (JavaScript, Launch, EmbeddedFiles)
    // Attackers often obfuscate names in PDFs with hex escapes (e.g. /Java#53cript or /#4a#53)
    const pdfText = buffer.toString("latin1");

    const pdfSuspiciousPatterns = [
      /\/JavaScript/i,
      /\/JS\b/i,
      /\/Launch\b/i,
      /\/EmbeddedFiles\b/i,
      /\/Java#53cript/i,
      /\/OpenAction\s*<<[^>]*\/Launch/i,
    ];

    for (const pattern of pdfSuspiciousPatterns) {
      if (pattern.test(pdfText)) {
        return {
          isSafe: false,
          threatDetails: `PDF contains active executable elements or scripts (${pattern.toString()}). Upload rejected.`,
        };
      }
    }
  }

  return { isSafe: true };
}

// ─── HIGH-LEVEL FILE VALIDATION & RANDOMIZED STORAGE ───────────────────────────

export interface ValidatedFileResult {
  isValid: boolean;
  error?: string;
  originalFileName: string;
  storedFileName?: string;
  filePath?: string;
  mimeType: AllowedMimeType;
  fileSize: number;
  sha256?: string;
  buffer: Buffer;
}

/**
 * Validates a file end-to-end:
 * 1. Checks size against MAX_FILE_SIZE_BYTES
 * 2. Sanitizes filename and checks extension
 * 3. Checks magic bytes / binary signatures
 * 4. Checks cross-consistency between extension and magic bytes
 * 5. Scans for malware / script heuristics
 * 6. Generates randomized UUID filename and writes to storage outside web root
 * 7. Computes SHA-256 integrity hash
 */
export function validateAndProcessFile(
  buffer: Buffer,
  declaredOriginalName: string,
  declaredMimeType?: string,
): ValidatedFileResult {
  // 1. File Size Verification
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      error: "Uploaded file is empty.",
      originalFileName: declaredOriginalName || "unknown",
      mimeType: "application/octet-stream" as any,
      fileSize: 0,
      buffer: Buffer.alloc(0),
    };
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return {
      isValid: false,
      error: `File exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB. Actual size: ${(buffer.length / (1024 * 1024)).toFixed(2)}MB.`,
      originalFileName: declaredOriginalName,
      mimeType: "application/octet-stream" as any,
      fileSize: buffer.length,
      buffer,
    };
  }

  // 2. Filename Sanitization & Extension Validation
  const nameValidation = sanitizeAndValidateFileName(declaredOriginalName);
  if (!nameValidation.isValid) {
    return {
      isValid: false,
      error: nameValidation.error || "Invalid filename.",
      originalFileName: declaredOriginalName,
      mimeType: "application/octet-stream" as any,
      fileSize: buffer.length,
      buffer,
    };
  }

  // 3. Magic Bytes Detection
  const magicCheck = detectMagicBytes(buffer);
  if (!magicCheck.isValid || !magicCheck.detectedMimeType) {
    return {
      isValid: false,
      error: magicCheck.error || "File content does not match any supported file type.",
      originalFileName: nameValidation.sanitizedName,
      mimeType: "application/octet-stream" as any,
      fileSize: buffer.length,
      buffer,
    };
  }

  // 4. Cross-Verification: Filename extension vs Magic bytes
  const isPdf =
    nameValidation.extension === ".pdf" &&
    magicCheck.detectedMimeType === "application/pdf";
  const isJpg =
    [".jpg", ".jpeg"].includes(nameValidation.extension) &&
    magicCheck.detectedMimeType === "image/jpeg";
  const isPng =
    nameValidation.extension === ".png" &&
    magicCheck.detectedMimeType === "image/png";

  if (!isPdf && !isJpg && !isPng) {
    return {
      isValid: false,
      error: `File signature mismatch: File declares extension '${nameValidation.extension}' but actual content signature is '${magicCheck.detectedMimeType}'.`,
      originalFileName: nameValidation.sanitizedName,
      mimeType: magicCheck.detectedMimeType,
      fileSize: buffer.length,
      buffer,
    };
  }

  // 5. Deep Malicious Content Scanning
  const scanResult = scanForMaliciousContent(buffer, magicCheck.detectedMimeType);
  if (!scanResult.isSafe) {
    return {
      isValid: false,
      error: scanResult.threatDetails || "Malicious or unauthorized content detected in file.",
      originalFileName: nameValidation.sanitizedName,
      mimeType: magicCheck.detectedMimeType,
      fileSize: buffer.length,
      buffer,
    };
  }

  // 6. Randomized Filename Generation & Secure Disk Persistence (Outside Web Root)
  const secureDir = ensureSecureStorageDir();
  const fileExt =
    magicCheck.detectedMimeType === "application/pdf"
      ? ".pdf"
      : magicCheck.detectedMimeType === "image/png"
      ? ".png"
      : ".jpg";

  const randomIdentifier = crypto.randomUUID();
  const storedFileName = `${randomIdentifier}${fileExt}`;
  const filePath = path.join(secureDir, storedFileName);

  try {
    fs.writeFileSync(filePath, buffer, { mode: 0o640 });
  } catch (err: any) {
    console.error("Failed to write file to secure storage directory:", err);
    // Non-fatal if disk write fails, but log error
  }

  // 7. Compute SHA-256 Hash
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  return {
    isValid: true,
    originalFileName: nameValidation.sanitizedName,
    storedFileName,
    filePath,
    mimeType: magicCheck.detectedMimeType,
    fileSize: buffer.length,
    sha256,
    buffer,
  };
}

/**
 * Safely removes a stored file from the secure storage directory upon document deletion.
 */
export function removeSecureFile(filePathOrName?: string): void {
  if (!filePathOrName) return;
  try {
    const fullPath = path.isAbsolute(filePathOrName)
      ? filePathOrName
      : path.join(SECURE_STORAGE_DIR, path.basename(filePathOrName));

    // Ensure we only delete within the secure storage directory to prevent path traversal
    const resolvedPath = path.resolve(fullPath);
    if (resolvedPath.startsWith(path.resolve(SECURE_STORAGE_DIR))) {
      if (fs.existsSync(resolvedPath)) {
        fs.unlinkSync(resolvedPath);
      }
    }
  } catch (err) {
    console.error(`Failed to remove secure file at '${filePathOrName}':`, err);
  }
}
