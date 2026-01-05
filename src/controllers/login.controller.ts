import { STATUS_CODE } from "../utils/constant";
import { UserModel } from "../models/User";
import { comparePassword, hashPassword, apiResponse, generateToken, decodeToken, expiredToken } from "../utils/common";
import { USER_ENUM } from "../utils/constant";
import { MSG } from "../utils/msgs";

export const login = async (req: any, res: any) => {
    try {
        let input = req.body;
        const user: any = await UserModel.findOne({ email: input.email, status: USER_ENUM.ACTIVE });
        if (!user) {
            return apiResponse(res, MSG.INVALID_EMAIL_PASSWORD, STATUS_CODE.UNAUTHORIZED)
        }
        const isMatch = await comparePassword(input.password, user.password);
        if (!isMatch) {
            return apiResponse(res, MSG.INVALID_EMAIL_PASSWORD, STATUS_CODE.UNAUTHORIZED);
        }
        const accessToken = generateToken(user?.toObject());

        const responsePayload = {
            id: user.id,
            email: user.email,
            name: user.name,
            access_token: accessToken,
        };
        return apiResponse(res, responsePayload, STATUS_CODE.SUCCESS);
    }
    catch (error: any) {
        res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }

}


export const logout = async (req: any, res: any) => {
    const token = req.headers['authorization'];
    expiredToken(token);
    return apiResponse(res, {}, STATUS_CODE.SUCCESS, MSG.TOKEN_EXPIRED_MSG)
}

