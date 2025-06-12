import { UserModel } from "../models/User";
import { apiResponse } from "../utils/common";
import { ROLE, STATUS_CODE } from "../utils/constant";


export const userListing = async (req: any, res: any) => {
    try {
        let { page, limit = 2,role_id=ROLE.STAFF } = req.query;

        let offset = page > 0 ? (page - 1) * limit : 0;

        let userList = await UserModel.find({role_id:role_id}).skip(offset).limit(limit).sort({ _id: -1 }).lean();

        return apiResponse(res, {
            data: userList,
            total: await UserModel.countDocuments(),
            page: parseInt(page),
            limit: parseInt(limit)
        }, STATUS_CODE.SUCCESS);
    }
    catch (error: any) {
         res.status(500).json({ error: error.message });
    }

}

export const userAdd = async (req: any, res: any) => {
    try {
        let input = req.body;
        let userExists = await UserModel.findOne({ email: input.email});
        if (userExists) {
            return apiResponse(res, "User already exists", STATUS_CODE.ERROR);
        }
        let response = await UserModel.create(input);
        return apiResponse(res, { id: response?._id }, STATUS_CODE.SUCCESS, "User has been suceesfully added");
    }
    catch (error: any) {
        if (error.code === 11000) {
            res.status(STATUS_CODE.ERROR).json({ error: error.message, message: "User already exists" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }

}

export const userUpdate = async (req: any, res: any) => {
    try {
        let input = req.body;
        let { id } = req.params;
        if (!id) {
            return apiResponse(res, "user ID is required", STATUS_CODE.ERROR);
        }
        await UserModel.updateOne({ _id: id }, input);
        return apiResponse(res, { id: id }, STATUS_CODE.SUCCESS, "User has been suceesfully updated");
    }
    catch (error: any) {
        if (error.code === 11000) {
            res.status(STATUS_CODE.ERROR).json({ error: error.message, message: "User already exists" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }

}