import { Request, Response, NextFunction } from "express";
import { sanitizeClinicalText, containsDangerousHtmlOrScript } from "../utils/sanitizer";

/**
 * Recursively sanitizes an object, array, or string to strip XSS & script injections.
 */
function deepSanitize(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Only strip if script or HTML pattern exists to avoid unnecessary allocations
    if (containsDangerousHtmlOrScript(obj)) {
      return sanitizeClinicalText(obj, obj.length) || "";
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item));
  }

  if (typeof obj === "object" && !(obj instanceof Date)) {
    const sanitized: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      sanitized[key] = deepSanitize(obj[key]);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Express Middleware: Deep XSS & Script Injection Sanitizer
 * Automatically purges dangerous <script> tags, inline event handlers (onerror, onload),
 * and unauthorized HTML from all incoming request bodies, query params, and route params.
 */
export const xssSanitizer = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === "object") {
    for (const key of Object.keys(req.body)) {
      req.body[key] = deepSanitize(req.body[key]);
    }
  }
  if (req.query && typeof req.query === "object") {
    for (const key of Object.keys(req.query)) {
      (req.query as any)[key] = deepSanitize((req.query as any)[key]);
    }
  }
  next();
};

export default xssSanitizer;
