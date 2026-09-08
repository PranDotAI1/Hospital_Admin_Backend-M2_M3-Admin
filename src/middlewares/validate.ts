import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { STATUS_CODE } from "../utils/constant";

export type ValidationType = "body" | "params" | "query";

export const formatZodError = (error: ZodError) => {
  const fieldErrors = error.flatten().fieldErrors;
  const formatted: Record<string, string> = {};

  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && Array.isArray(value) && value[0]) {
      formatted[key] = value[0];
    }
  }

  return formatted;
};

export const validate = (schema: ZodSchema, type: ValidationType = "body") => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const dataToValidate = req[type] ?? {};
      const result = schema.safeParse(dataToValidate);

      if (!result.success) {
        const errors = formatZodError(result.error);
        res.status(STATUS_CODE.BAD_REQUEST).json({
          success: false,
          message: "Validation failed",
          code: STATUS_CODE.BAD_REQUEST,
          errors,
        });
        return;
      }

      (req as any)[type] = result.data;
      next();
    } catch (error) {
      res.status(STATUS_CODE.ERROR).json({
        success: false,
        message: "Validation error occurred",
        code: STATUS_CODE.ERROR,
      });
    }
  };
};

export default validate;
