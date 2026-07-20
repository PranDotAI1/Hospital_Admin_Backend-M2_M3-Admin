import { Response, NextFunction } from "express";
import { DoctorModel } from "../models/Doctor";
import { NurseModel } from "../models/Nurse";
import { UserModel } from "../models/User";
import { ROLE, STATUS_CODE } from "../utils/constant";
import { ROLE_MODULES } from "../utils/permissions.constants";

export const requirePermission = (module: string, action: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const authUser = req.user;

      if (!authUser) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          status: "error",
          message: "Authentication required",
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      // Fetch the full User document to check is_super_admin flag
      const user = await UserModel.findById(authUser.id || authUser._id).lean();
      if (!user) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({
          status: "error",
          message: "User not found in database",
          code: STATUS_CODE.UNAUTHORIZED,
        });
      }

      // Super Admin bypass: If is_super_admin is true, they can do anything
      if (user.is_super_admin) {
        return next();
      }

      // Otherwise, we must check their specific role's permission matrix.
      const roleId = user.role_id || ROLE.STAFF;
      let rawPerms: any = null;

      // 1. Fetch the permissions matrix from the correct collection
      if (roleId === ROLE.DOCTOR) {
        let doctor = req.doctor || null;
        if (!doctor) {
          if (user.doctorId) {
            doctor = await DoctorModel.findById(user.doctorId).lean();
          } else if (user.email) {
            doctor = await DoctorModel.findOne({ email: user.email }).lean();
          }
        }
        if (!doctor) {
          return res.status(STATUS_CODE.FORBIDDEN).json({
            status: "error",
            message: "Doctor profile not found",
            code: STATUS_CODE.FORBIDDEN,
          });
        }
        req.doctor = doctor; // cache it
        rawPerms = doctor.permissions;

      } else if (roleId === ROLE.NURSE) {
        let nurse = req.nurse || null;
        if (!nurse) {
          if (user.nurseId) {
            nurse = await NurseModel.findById(user.nurseId).lean();
          } else if (user.email) {
            nurse = await NurseModel.findOne({ email: user.email }).lean();
          }
        }
        if (!nurse) {
          return res.status(STATUS_CODE.FORBIDDEN).json({
            status: "error",
            message: "Nurse profile not found",
            code: STATUS_CODE.FORBIDDEN,
          });
        }
        req.nurse = nurse; // cache it
        rawPerms = nurse.permissions;

      } else {
        // Admin, Receptionist, IT, Security, etc.
        rawPerms = user.permissions;
      }

      // 2. Validate that the requested module is even allowed for this role
      const allowedModules = ROLE_MODULES[roleId] || [];
      if (!allowedModules.includes(module)) {
         return res.status(STATUS_CODE.FORBIDDEN).json({
          status: "error",
          message: `Forbidden: The '${module}' module is not available for role ID ${roleId}`,
          code: STATUS_CODE.FORBIDDEN,
        });
      }

      // 3. Evaluate the matrix
      let hasPermission = false;
      if (rawPerms) {
        const modulePerms = rawPerms instanceof Map ? rawPerms.get(module) : rawPerms[module];
        if (modulePerms && modulePerms[action] === true) {
          hasPermission = true;
        }
      }

      if (hasPermission) {
        return next();
      }

      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: `Forbidden: You do not have '${action}' permission for '${module}'`,
        code: STATUS_CODE.FORBIDDEN,
      });

    } catch (error) {
      console.error("requirePermission error:", error);
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Internal server error during permission check",
        code: STATUS_CODE.ERROR,
      });
    }
  };
};
