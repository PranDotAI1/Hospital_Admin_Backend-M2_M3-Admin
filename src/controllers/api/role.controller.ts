import { apiResponse } from "../../utils/common";
import { STATUS_CODE } from "../../utils/constant";
import {
  ROLE_PERMISSIONS,
  ROLE_METADATA,
  ALL_PERMISSIONS,
} from "../../utils/permissions";

/** GET /roles — list all roles with their metadata and permissions directly from code */
export const listing = async (_req: any, res: any) => {
  try {
    const roles = Object.entries(ROLE_METADATA).map(([roleIdStr, meta]) => {
      const roleId = Number(roleIdStr);
      const permissions = ROLE_PERMISSIONS[roleId] || [];
      return {
        role_id: roleId,
        name: meta.name,
        description: meta.description,
        permissions,
        total_permissions: permissions.length,
        status: true,
      };
    });
    return apiResponse(res, roles, STATUS_CODE.SUCCESS, "Roles fetched successfully");
  } catch (error: any) {
    console.error("[ROLE_LIST_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({ message: "Failed to fetch roles" });
  }
};

/** GET /roles/:roleId or GET /roles/:roleId/permissions — get details and permissions for a role */
export const getPermissionsForRole = async (req: any, res: any) => {
  try {
    const roleId = parseInt(req.params.roleId);
    if (isNaN(roleId)) {
      return apiResponse(res, "Invalid role ID", STATUS_CODE.BAD_REQUEST);
    }

    const permissions = ROLE_PERMISSIONS[roleId];
    if (!permissions) {
      return apiResponse(res, "Role not found", STATUS_CODE.NOT_FOUND);
    }

    const meta = ROLE_METADATA[roleId] || { name: "Unknown", description: "" };

    return apiResponse(
      res,
      {
        role_id: roleId,
        name: meta.name,
        description: meta.description,
        permissions,
        total_permissions: permissions.length,
      },
      STATUS_CODE.SUCCESS,
      "Role permissions fetched",
    );
  } catch (error: any) {
    console.error("[ROLE_PERMISSIONS_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({ message: "Failed to fetch role permissions" });
  }
};

/** GET /permissions — list all available permissions in the system */
export const getAllPermissions = async (_req: any, res: any) => {
  try {
    return apiResponse(
      res,
      {
        permissions: ALL_PERMISSIONS,
        total: ALL_PERMISSIONS.length,
      },
      STATUS_CODE.SUCCESS,
      "All permissions fetched",
    );
  } catch (error: any) {
    console.error("[ALL_PERMISSIONS_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({ message: "Failed to fetch permissions" });
  }
};