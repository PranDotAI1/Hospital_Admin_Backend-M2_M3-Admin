import { Request, Response } from "express";
import { Types } from "mongoose";
import { STATUS_CODE, USER_ENUM, ROLE } from "../utils/constant";
import { UserModel } from "../models/User";
import { DoctorModel } from "../models/Doctor";
import {
  comparePassword,
  apiResponse,
  generateToken,
  expiredToken,
} from "../utils/common";
import { MSG } from "../utils/msgs";
import { LoginInput } from "../validations/auth.schema";
import { createSession, invalidateSession } from "../services/session.service";
import { extractClientIp } from "../services/geoip.service";
import { SignInMethod } from "../models/Session";

export const login = async (
  req: Request<unknown, unknown, LoginInput>,
  res: Response,
): Promise<Response> => {
  const { email, password } = req.body;

  try {
    const user = await UserModel.findOne({
      email,
      status: USER_ENUM.ACTIVE,
    }).select("_id email name password status role_id is_active doctorId");

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

    const userAgent = req.headers["user-agent"] || "unknown";
    const ip = extractClientIp(req);

    const sessionId = new Types.ObjectId();

    const accessToken = generateToken({
      sub: user._id.toString(),
      email: user.email,
      role: user.role_id,
      is_active: user.is_active,
      sessionId: sessionId.toString(),
    });

    const session = await createSession({
      _id: sessionId,
      userId: user._id.toString(),
      token: accessToken,
      userAgent,
      ip,
      signInMethod: SignInMethod.PASSWORD,
    });

    let permissions = null;
    let accessLevel = null;
    let rawPerms = null;

    if (user.role_id === ROLE.DOCTOR && user.doctorId) {
      const doctor = await DoctorModel.findById(user.doctorId).select("permissions accessLevel").lean();
      if (doctor) {
        accessLevel = (doctor as any).accessLevel || "LIMITED";
        rawPerms = doctor.permissions;
      }
    } else if (user.role_id === ROLE.NURSE && (user as any).nurseId) {
      // Need to import NurseModel above
      const NurseModel = require("../models/Nurse").NurseModel;
      const nurse = await NurseModel.findById((user as any).nurseId).select("permissions accessLevel").lean();
      if (nurse) {
        accessLevel = (nurse as any).accessLevel || "LIMITED";
        rawPerms = nurse.permissions;
      }
    } else {
      // Admins, Receptionist, etc.
      accessLevel = (user as any).accessLevel || "LIMITED";
      rawPerms = user.permissions;
    }

    if (rawPerms) {
      if (rawPerms instanceof Map) {
        const permsObj: Record<string, any> = {};
        rawPerms.forEach((value: any, key: string) => {
          permsObj[key] = value;
        });
        permissions = permsObj;
      } else {
        permissions = rawPerms;
      }
    }

    // Always bypass super admin for frontend logic if needed
    if (user.is_super_admin) {
      accessLevel = "FULL";
    }

    return apiResponse(
      res,
      {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role_id,
        is_super_admin: user.is_super_admin,
        accessToken,
        sessionId: session._id.toString(),
        permissions,
        accessLevel,
      },
      STATUS_CODE.SUCCESS,
    );
  } catch (error) {
    console.error("Login error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};

export const logout = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const sessionId = req.auth?.sessionId;

    if (sessionId) {
      await invalidateSession(sessionId, "user_logout");
    }

    return apiResponse(res, null, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG);
  } catch (error) {
    console.error("Logout error:", error);
    return apiResponse(res, null, STATUS_CODE.ERROR, MSG.SERVICE_UNAVAILABLE);
  }
};
