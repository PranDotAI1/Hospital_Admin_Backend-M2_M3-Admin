import { Request, Response } from "express";
import { STATUS_CODE, USER_ENUM } from "../utils/constant";
import { UserModel } from "../models/User";
import {
  comparePassword,
  apiResponse,
  generateToken,
  expiredToken,
} from "../utils/common";
import { MSG } from "../utils/msgs";
import { LoginInput } from "../validations/auth.schema";

export const login = async (
  req: Request<unknown, unknown, LoginInput>,
  res: Response,
): Promise<Response> => {
  const { email, password } = req.body;

  try {
    const user = await UserModel.findOne({
      email,
      status: USER_ENUM.ACTIVE,
    }).select("_id email name password status role_id is_active");

    if (!user || !user.password) {
      return apiResponse(
        res,
        {
          error: "Invalid email or password",
        },
        STATUS_CODE.UNAUTHORIZED,
        MSG.INVALID_EMAIL_PASSWORD,
      );
    }

    const isPasswordValid = await comparePassword(password, user.password);

    if (
      !isPasswordValid ||
      user.status !== USER_ENUM.ACTIVE ||
      !user.is_active
    ) {
      return apiResponse(
        res,
        { error: "Invalid email or password" },
        STATUS_CODE.UNAUTHORIZED,
        MSG.INVALID_EMAIL_PASSWORD,
      );
    }

    const accessToken = generateToken({
      sub: user._id.toString(),
      email: user.email,
      role: user.role_id,
      is_active: user.is_active,
    });

    return apiResponse(
      res,
      {
        id: user._id,
        email: user.email,
        name: user.name,
        accessToken,
      },
      STATUS_CODE.SUCCESS,
    );
  } catch {
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};

export const logout = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (token) {
    expiredToken(token);
  }

  return apiResponse(res, null, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
};
