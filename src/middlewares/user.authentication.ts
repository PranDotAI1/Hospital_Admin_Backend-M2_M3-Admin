import { verifyToken } from "../utils/common";
import { STATUS_CODE } from "../utils/constant";
import { MSG } from "../utils/msgs";

export const checkToken = (req: any, res: any, next: any) => {
    let token = req.headers['authorization'];
    if (!verifyToken(token)) {
        return res.status(STATUS_CODE.UNAUTHORIZED).json({ "message": MSG.TOKEN_EXPIRED, "code": STATUS_CODE.UNAUTHORIZED })
    }
    return next();
}