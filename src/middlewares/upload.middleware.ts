import multer from "multer";
import { Request } from "express";

const storage = multer.memoryStorage();

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
) => {
  const allowedMimeTypes = [
    "text/csv",
    "application/json",
    "application/vnd.ms-excel",
  ];

  const allowedExtensions = [".csv", ".json"];
  const fileExtension = file.originalname.toLowerCase().slice(-5);

  const isAllowedMime = allowedMimeTypes.includes(file.mimetype);
  const isAllowedExt = allowedExtensions.some((ext) =>
    fileExtension.endsWith(ext),
  );

  if (isAllowedMime || isAllowedExt) {
    callback(null, true);
  } else {
    callback(new Error("Only CSV and JSON files are allowed"));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

export const handleMulterError = (err: any): string => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return "File size exceeds the 5MB limit";
    }
    return `Upload error: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unknown upload error";
};
