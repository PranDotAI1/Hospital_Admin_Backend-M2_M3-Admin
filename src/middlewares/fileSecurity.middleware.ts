import { NextFunction, Request, Response } from "express";
import multer from "multer";
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_COUNT,
  MAX_FILE_SIZE_BYTES,
  validateAndProcessFile,
  ValidatedFileResult,
} from "../utils/fileSecurity";

// ─── MULTER CONFIGURATION ───────────────────────────────────────────────────────

const memoryStorage = multer.memoryStorage();

export const secureMulter = multer({
  storage: memoryStorage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: MAX_FILE_COUNT,
  },
  fileFilter: (_req, file, cb) => {
    // Initial coarse-grained filter on file extension and declared MIME type
    const lowerName = file.originalname.toLowerCase();
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext),
    );

    if (!hasValidExt) {
      return cb(
        new Error(
          `Invalid file extension. Only ${ALLOWED_EXTENSIONS.join(", ")} files are permitted.`,
        ),
      );
    }

    if (
      file.mimetype &&
      !ALLOWED_MIME_TYPES.includes(file.mimetype as any) &&
      file.mimetype !== "application/octet-stream"
    ) {
      return cb(
        new Error(
          `Invalid MIME type '${file.mimetype}'. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
        ),
      );
    }

    cb(null, true);
  },
});

// ─── MULTER ERROR HANDLER MIDDLEWARE ───────────────────────────────────────────

export function handleMulterErrors(
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        status: "error",
        message: `File size exceeds the configured maximum limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        code: "FILE_TOO_LARGE",
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        status: "error",
        message: `Too many files. Maximum allowed files per request is ${MAX_FILE_COUNT}.`,
        code: "TOO_MANY_FILES",
      });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        status: "error",
        message: `Unexpected file field received in upload: ${err.field || "unknown"}.`,
        code: "UNEXPECTED_FIELD",
      });
    }

    return res.status(400).json({
      status: "error",
      message: `File upload error: ${err.message}`,
      code: err.code,
    });
  }

  // Handle custom fileFilter errors
  if (err.message && err.message.includes("Invalid file extension")) {
    return res.status(400).json({
      status: "error",
      message: err.message,
      code: "INVALID_FILE_TYPE",
    });
  }

  return next(err);
}

// ─── MAGIC BYTES & CONTENT SCAN MIDDLEWARE ─────────────────────────────────────

export interface RequestWithSecureFiles extends Request {
  secureFiles?: ValidatedFileResult[];
}

/**
 * Validates actual binary content (magic bytes, malware heuristics, randomized storage)
 * on all files received via Multer in req.files.
 */
export function fileSecurityScanMiddleware(
  req: RequestWithSecureFiles,
  res: Response,
  next: NextFunction,
) {
  const rawFiles = (req.files as Express.Multer.File[]) || [];
  if (!rawFiles || rawFiles.length === 0) {
    req.secureFiles = [];
    return next();
  }

  const processedFiles: ValidatedFileResult[] = [];

  for (const file of rawFiles) {
    const validation = validateAndProcessFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (!validation.isValid) {
      return res.status(400).json({
        status: "error",
        message: `File upload rejected for "${file.originalname}": ${validation.error}`,
        code: "SECURITY_VALIDATION_FAILED",
      });
    }

    processedFiles.push(validation);
  }

  req.secureFiles = processedFiles;
  next();
}

/**
 * Combined pipeline middleware for handling multipart file uploads securely:
 * 1. Multer processes multipart/form-data into memory buffers with size/count limits.
 * 2. Catches any Multer limits/filter errors and returns 400 Bad Request.
 * 3. Scans magic bytes, sanitizes filenames, scans for malicious payloads, and writes to secure storage.
 */
export function secureUploadMiddleware(fieldName: string = "files") {
  const uploadHandler = secureMulter.any(); // Accept any field name or array of files

  return (req: Request, res: Response, next: NextFunction) => {
    uploadHandler(req, res, (err: any) => {
      if (err) {
        return handleMulterErrors(err, req, res, next);
      }
      fileSecurityScanMiddleware(req as RequestWithSecureFiles, res, next);
    });
  };
}
