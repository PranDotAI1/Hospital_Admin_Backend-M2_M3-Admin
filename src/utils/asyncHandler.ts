import { Request, Response, NextFunction } from "express";
import { ParamsDictionary } from "express-serve-static-core";
import { ParsedQs } from "qs";
import { STATUS_CODE } from "./constant";
import { MSG } from "./msgs";

type AsyncRequestHandler<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
> = (
  req: Request<P, ResBody, ReqBody, ReqQuery>,
  res: Response<ResBody>,
  next: NextFunction,
) => Promise<Response | void>;

export const asyncHandler = <
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
>(
  fn: AsyncRequestHandler<P, ResBody, ReqBody, ReqQuery>,
) => {
  return async (
    req: Request<P, ResBody, ReqBody, ReqQuery>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await fn(req, res as Response<ResBody>, next);
    } catch (error) {
      if (res.headersSent) {
        return next(error);
      }

      return void res.status(STATUS_CODE.ERROR).json({
        success: false,
        message: MSG.INTERNAL_SERVER_ERROR,
        code: STATUS_CODE.ERROR,
      });
    }
  };
};
