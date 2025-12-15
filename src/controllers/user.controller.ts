import { HealthRecordModel } from "../models/HealthRecord";
import { NotifiyResponseModel } from "../models/NotifiyResponse";
import { UserModel } from "../models/User";
import { apiResponse, comparePassword, hashPassword } from "../utils/common";
import { ROLE, STATUS_CODE } from "../utils/constant";


export const userListing = async (req: any, res: any) => {
    try {
        let { page, limit = 2, role_id = ROLE.STAFF } = req.query;

        let offset = page > 0 ? (page - 1) * limit : 0;

        let userList = await UserModel.find({ role_id: role_id }).skip(offset).limit(limit).sort({ _id: -1 }).lean();

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
        let userExists = await UserModel.findOne({ email: input.email });
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

export const userNewAdd = async (req: any, res: any) => {
    try {
        let input = req.body;
        input.password = await hashPassword(input.password); // Set a default password or generate one
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

export const updatePassword = async (req: any, res: any) => {
    try {
        let input = req.body;
        let { id } = req.params;
        if (!id) {
            return apiResponse(res, "user ID is required", STATUS_CODE.ERROR);
        }
        let userDetails:any = await UserModel.findById(id);
        const hashedNewPassword = await hashPassword(input.password);

        if(userDetails?.previous_passwords){
            for(let prevPassword of userDetails.previous_passwords){
                 const isMatch = await comparePassword(input.password, prevPassword);
                 if(isMatch){
                    return apiResponse(res, "You cannot reuse your last 3 passwords", STATUS_CODE.ERROR);
                 }
            }
            // Add current password to previous_passwords
            userDetails.previous_passwords.push(userDetails.password);
            // Keep only the last 3 passwords
            if(userDetails.previous_passwords.length >= 3){
                userDetails.previous_passwords = userDetails.previous_passwords.slice(-3);
            }
        } else {
            userDetails.previous_passwords = [...userDetails.previous_passwords,hashedNewPassword];
        }
        // Update the user's password and previous_passwords
        await UserModel.updateOne({ _id: id }, { password: hashedNewPassword, previous_passwords: userDetails.previous_passwords });
        return apiResponse(res, { id: id }, STATUS_CODE.SUCCESS, "Password has been suceesfully updated");
    }
    catch (error: any) {
        if (error.code === 11000) {
            res.status(STATUS_CODE.ERROR).json({ error: error.message, message: "User already exists" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }

}

export const abhauserListing = async (req: any, res: any) => {
    try {
        let { page, limit = 10 } = req.query;

        let offset = page > 0 ? (page - 1) * limit : 0;

        let userList: any = await HealthRecordModel.find().skip(offset).limit(limit).sort({ _id: -1 }).lean();
        // console.log("userList before filter", userList);
        userList.data = userList?.data?.filter((item: any) => item?.version_m3 != undefined);
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

export const userNotifyResponse = async (req: any, res: any) => {
    try {

        let notifyDetails = await NotifiyResponseModel.find({ health_record_id: req.params.id });

        return apiResponse(res, notifyDetails, STATUS_CODE.SUCCESS);
    }
    catch (error: any) {
        res.status(500).json({ error: error.message });
    }

}