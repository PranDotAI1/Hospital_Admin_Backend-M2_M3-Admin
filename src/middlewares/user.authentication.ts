import { isTokenBlacklisted, verifyAccessToken } from "../utils/common";
import { STATUS_CODE, USER_ENUM, ROLE } from "../utils/constant";
import { MSG } from "../utils/msgs";
import { UserModel } from "../models/User";
import { validateSession } from "../services/session.service";

export const checkToken = async (req: any, res: any, next: any) => {
  try {
    // 1. Primary: Extract from HttpOnly cookie (cookie-based session)
    // 2. Fallback: Extract from Authorization header (Bearer <token>)
    let token: string | undefined =
      req.cookies?.access_token ||
      req.cookies?.token ||
      req.headers["authorization"];

    if (!token) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: "Authentication required (missing session cookie or authorization header)", code: STATUS_CODE.UNAUTHORIZED });
    }

    // Check if token was revoked/blacklisted
    const isRevoked = await isTokenBlacklisted(token);
    if (isRevoked) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: MSG.TOKEN_EXPIRED, code: STATUS_CODE.UNAUTHORIZED });
    }

    // Verify JWT cryptographic signature & expiry
    const decoded: any = verifyAccessToken(token);
    if (!decoded || (!decoded.id && !decoded._id)) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: MSG.TOKEN_EXPIRED, code: STATUS_CODE.UNAUTHORIZED });
    }

    // ─── CRITICAL: Server-Side Session Validation ───
    if (decoded.sessionId) {
      const session = await validateSession(decoded.sessionId);
      if (!session || !session.isValid) {
        return res
          .status(STATUS_CODE.UNAUTHORIZED)
          .json({
            message: "Session has expired or was revoked. Please log in again.",
            code: STATUS_CODE.UNAUTHORIZED,
            sessionRevoked: true,
          });
      }
      req.sessionId = decoded.sessionId;
    }

    // Validate active user in database
    const userId = decoded.id || decoded._id;
    const user = await UserModel.findById(userId).lean();
    if (!user) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: "User account not found or has been deleted", code: STATUS_CODE.UNAUTHORIZED });
    }

    // Verify user account status
    if (user.status !== USER_ENUM.ACTIVE || user.is_active === false) {
      return res
        .status(STATUS_CODE.UNAUTHORIZED)
        .json({ message: "User account is inactive or disabled", code: STATUS_CODE.UNAUTHORIZED });
    }

    // Attach comprehensive user context to request
    req.user = {
      _id: user._id,
      id: user._id.toString(),
      email: user.email,
      name: user.name || `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      role_id: user.role_id,
      hospital_id: user.hospital_id,
      department_id: user.department_id,
      is_super_admin: user.is_super_admin || user.role_id === ROLE.SUPER_ADMIN,
      permissions: user.permissions,
    };
    req.token = token;

    return next();
  } catch (error: any) {
    console.error("[AUTH_MIDDLEWARE_ERROR]", error?.message || error);
    return res
      .status(STATUS_CODE.UNAUTHORIZED)
      .json({ message: MSG.TOKEN_EXPIRED, code: STATUS_CODE.UNAUTHORIZED });
  }
};

// Export auth as alias of checkToken for standard conventions
export const auth = checkToken;

export const requireRole = (...allowedRoles: number[]) => {
  return (req: any, res: any, next: any) => {
    const userRoleId = req.user?.role_id;
    if (userRoleId === undefined || !allowedRoles.includes(userRoleId)) {
      return res.status(STATUS_CODE.FORBIDDEN).json({
        status: "error",
        message: "Forbidden: You do not have permission to perform this action",
        code: STATUS_CODE.FORBIDDEN,
      });
    }
    return next();
  };
};
