import { Request, Response } from "express";
import { Types } from "mongoose";
import { UserModel } from "../models/User";
import { DoctorModel } from "../models/Doctor";
import { NurseModel } from "../models/Nurse";
import { successResponse, errorResponse } from "../utils/common";
import { STATUS_CODE, ROLE } from "../utils/constant";
import {
  getDefaultPermissions,
  ROLE_MODULES,
  type DynamicPermissionsMap,
} from "../utils/permissions.constants";

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const getParamId = (req: Request): string =>
  Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";

export const getUserPermissions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid user id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const user = await UserModel.findById(id).lean();
    if (!user) {
      return errorResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    const roleId = user.role_id || ROLE.STAFF;
    const allowedModules = ROLE_MODULES[roleId] || ROLE_MODULES[ROLE.STAFF];
    const defaults = getDefaultPermissions(roleId);

    let rawPerms: any = null;
    let accessLevel = "LIMITED";

    // 1. Fetch from the correct model based on role
    if (roleId === ROLE.DOCTOR && user.doctorId) {
      const doc = await DoctorModel.findById(user.doctorId)
        .select("permissions accessLevel")
        .lean();
      if (doc) {
        rawPerms = doc.permissions;
        accessLevel = (doc as any).accessLevel || "LIMITED";
      }
    } else if (roleId === ROLE.NURSE && user.nurseId) {
      const nurse = await NurseModel.findById(user.nurseId)
        .select("permissions accessLevel")
        .lean();
      if (nurse) {
        rawPerms = nurse.permissions;
        accessLevel = (nurse as any).accessLevel || "LIMITED";
      }
    } else {
      // Admin, Receptionist, Accountant, etc. (Permissions stored on User directly)
      rawPerms = user.permissions;
      accessLevel = (user as any).accessLevel || "LIMITED";
    }

    // 2. Format and fill missing defaults
    let permissions: DynamicPermissionsMap = {};
    if (rawPerms) {
      if (rawPerms instanceof Map) {
        rawPerms.forEach((value: any, key: string) => {
          permissions[key] = value;
        });
      } else {
        permissions = { ...rawPerms };
      }
    }

    // Ensure all required modules are present
    for (const mod of allowedModules) {
      if (!permissions[mod]) {
        permissions[mod] = defaults[mod];
      }
    }

    // Remove any legacy modules that don't belong to this role
    for (const key of Object.keys(permissions)) {
      if (!allowedModules.includes(key)) {
        delete permissions[key];
      }
    }

    return successResponse(res, {
      userId: user._id,
      roleId,
      accessLevel,
      permissions,
    });
  } catch (error: any) {
    console.error("getUserPermissions error:", error);
    return errorResponse(
      res,
      error.message || "Failed to get permissions",
      STATUS_CODE.ERROR
    );
  }
};

export const updateUserPermissions = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid user id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const { permissions } = req.body as { permissions: DynamicPermissionsMap };
    
    const user = await UserModel.findById(id);
    if (!user) {
      return errorResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    const roleId = user.role_id || ROLE.STAFF;
    const allowedModules = ROLE_MODULES[roleId] || ROLE_MODULES[ROLE.STAFF];

    // Validate that incoming permissions only contain allowed modules for this role
    for (const key of Object.keys(permissions)) {
      if (!allowedModules.includes(key)) {
        return errorResponse(
          res,
          `Invalid module '${key}' for role ID ${roleId}`,
          STATUS_CODE.BAD_REQUEST
        );
      }
    }

    // Calculate accessLevel
    const allTrue = allowedModules.every((mod) => {
      const p = permissions[mod];
      return p && p.view && p.create && p.edit && p.delete;
    });
    const allViewOnly = allowedModules.every((mod) => {
      const p = permissions[mod];
      return p && p.view && !p.create && !p.edit && !p.delete;
    });

    let accessLevel: "FULL" | "LIMITED" | "VIEW_ONLY" = "LIMITED";
    if (allTrue) accessLevel = "FULL";
    else if (allViewOnly) accessLevel = "VIEW_ONLY";

    const updated_by = (req as any).user?.id || (req as any).user?._id?.toString?.();

    // 3. Save back to the correct model
    if (roleId === ROLE.DOCTOR && user.doctorId) {
      await DoctorModel.findByIdAndUpdate(user.doctorId, {
        $set: { permissions, accessLevel, updated_by },
      });
    } else if (roleId === ROLE.NURSE && user.nurseId) {
      await NurseModel.findByIdAndUpdate(user.nurseId, {
        $set: { permissions, accessLevel, updated_by },
      });
    } else {
      // Store on User directly
      await UserModel.findByIdAndUpdate(id, {
        $set: { permissions, accessLevel, updated_by },
      });
    }

    return successResponse(
      res,
      { userId: user._id, roleId, accessLevel, permissions },
      "Permissions updated successfully"
    );
  } catch (error: any) {
    console.error("updateUserPermissions error:", error);
    return errorResponse(
      res,
      error.message || "Failed to update permissions",
      STATUS_CODE.ERROR
    );
  }
};
