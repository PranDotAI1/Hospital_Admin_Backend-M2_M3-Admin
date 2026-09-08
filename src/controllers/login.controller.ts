import { STATUS_CODE } from "../utils/constant";
import { UserModel } from "../models/User";
import {
  comparePassword,
  apiResponse,
  generateToken,
  expiredToken,
} from "../utils/common";
import { USER_ENUM } from "../utils/constant";
import { MSG } from "../utils/msgs";

export const login = async (req: any, res: any) => {
  try {
    let input = req.body;
    const user: any = await UserModel.findOne({
      email: input.email,
      status: USER_ENUM.ACTIVE,
    });
    if (!user) {
      return apiResponse(
        res,
        MSG.INVALID_EMAIL_PASSWORD,
        STATUS_CODE.UNAUTHORIZED,
      );
    }
    const isMatch = await comparePassword(input.password, user.password);
    if (!isMatch) {
      return apiResponse(
        res,
        MSG.INVALID_EMAIL_PASSWORD,
        STATUS_CODE.UNAUTHORIZED,
      );
    }
    const tokenPayload = {
      id: user.id || user._id,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
    };
    const accessToken = generateToken(tokenPayload);

    const responsePayload = {
      id: user.id || user._id,
      email: user.email,
      name: user.name,
      role_id: user.role_id,
      hospital_id: user.hospital_id,
      access_token: accessToken,
    };
    return apiResponse(res, responsePayload, STATUS_CODE.SUCCESS);
  } catch (error: any) {
    console.error("[LOGIN_ERROR]", error?.message || error);
    res
      .status(STATUS_CODE.ERROR)
      .json({
        status: "error",
        message:
          process.env.NODE_ENV === "production"
            ? "An error occurred during authentication"
            : error.message,
      });
  }
};

export const logout = async (req: any, res: any) => {
  try {
    const token = req.headers["authorization"];
    if (token) {
      await expiredToken(token);
    }
    return apiResponse(res, {}, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
  } catch (error: any) {
    console.error("[LOGOUT_ERROR]", error?.message || error);
    return apiResponse(res, {}, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
  }
};
