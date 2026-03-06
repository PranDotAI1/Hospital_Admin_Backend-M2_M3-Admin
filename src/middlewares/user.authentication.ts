import { verifyToken } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { MSG } from "../utils/msgs";

export const checkToken = (req: any, res: any, next: any) => {
  let token = req.headers["authorization"];
  const decoded = verifyToken(token);
  if (!decoded) {
    return res
      .status(STATUS_CODE.UNAUTHORIZED)
      .json({ message: MSG.TOKEN_EXPIRED, code: STATUS_CODE.UNAUTHORIZED });
  }
  req.user = decoded;
  return next();
};

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
