/**
 * ─── PERMISSION MIDDLEWARE ───
 *
 * Express middleware for granular permission-based access control.
 * Works alongside the existing `checkToken` auth middleware which
 * attaches `req.user` (including `permissions`).
 *
 * Usage in routes:
 *   router.post("/user/add", checkToken, requirePermission(PERMISSIONS.USERS_CREATE), userAdd);
 *   router.get("/patients", checkToken, requireAnyPermission(PERMISSIONS.PATIENTS_READ, PERMISSIONS.PATIENTS_SEARCH), listPatients);
 */

import { STATUS_CODE } from "../utils/constant";

/**
 * Require ALL listed permissions.
 * Checks against req.user.permissions with strict role boundaries.
 */
export const requirePermission = (...requiredPerms: string[]) => {
  return (req: any, res: any, next: any) => {
    const userPerms: string[] = req.user?.permissions || [];
    const hasAll = requiredPerms.every((p) => userPerms.includes(p));

    if (!hasAll) {
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: You do not have the required permissions to perform this action",
        code: STATUS_CODE.FORBIDDEN,
        required: requiredPerms,
      });
    }

    return next();
  };
};

/**
 * Require ANY ONE of the listed permissions.
 * Useful when multiple roles might reach the same endpoint via different
 * permission paths.
 */
export const requireAnyPermission = (...requiredPerms: string[]) => {
  return (req: any, res: any, next: any) => {
    const userPerms: string[] = req.user?.permissions || [];
    const hasAny = requiredPerms.some((p) => userPerms.includes(p));

    if (!hasAny) {
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: You do not have the required permissions to perform this action",
        code: STATUS_CODE.FORBIDDEN,
        required: requiredPerms,
      });
    }

    return next();
  };
};
