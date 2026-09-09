import { STATUS_CODE } from "../utils/constant";
import { apiResponse } from "../utils/common";
import { DepartmentModel } from "../models/Department";


export const departmentList = async (req: any, res: any) => {
    try {
        let { page, limit = 30 } = req.query;

        let offset = page > 0 ? (page - 1) * limit : 0;
        let departments = await DepartmentModel.aggregate([
            { $skip: offset },
            {
                $lookup: {
                    from: "departmentPatients",
                    localField: "_id",
                    foreignField: "department_id",
                    as: "patient_count"
                }

            },
            {
                $addFields: {
                    patient_count: { $size: "$patient_count" }
                }
            },
            { $limit: limit },
            { $sort: { createdAt: -1 } }
        ]).exec();

        return apiResponse(res, {
            departments: departments,
            total: await DepartmentModel.countDocuments(),
            page: parseInt(page),
            limit: parseInt(limit)
        }, STATUS_CODE.SUCCESS);
    }
    catch (error: any) {
        console.error("[DEPARTMENT_LIST_ERROR]", error?.message || error);
        res.status(STATUS_CODE.ERROR).json({
            message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message
        });
    }

}

export const addDepartment = async (req: any, res: any) => {
    try {
        // req.body is now validated by addDepartmentSchema middleware.
        const { name, description, status } = req.body;
        let departmentxists = await DepartmentModel.findOne({ name, is_active: true });
        if (departmentxists) {
            return apiResponse(res, "Department already exists", STATUS_CODE.ERROR);
        }
        const createPayload: Record<string, any> = { name };
        if (description !== undefined) createPayload.description = description;
        if (status !== undefined) createPayload.status = status;
        let response = await DepartmentModel.create(createPayload);
        return apiResponse(res, { id: response?._id }, STATUS_CODE.SUCCESS, "Department has been suceesfully added");
    }
    catch (error: any) {
        console.error("[ADD_DEPARTMENT_ERROR]", error?.message || error);
        if (error.code === 11000 || error.code === STATUS_CODE.VALIDATION_ERROR) {
            res.status(STATUS_CODE.ERROR).json({ message: "Department already exists" });
        } else {
            res.status(500).json({
                message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message
            });
        }
    }

}

export const updateDepartment = async (req: any, res: any) => {
    try {
        // req.body is now validated by updateDepartmentSchema middleware.
        const { name, description, status } = req.body;
        let { id } = req.params;
        if (!id) {
            return apiResponse(res, "Department ID is required", STATUS_CODE.ERROR);
        }
        const updatePayload: Record<string, any> = {};
        if (name !== undefined) updatePayload.name = name;
        if (description !== undefined) updatePayload.description = description;
        if (status !== undefined) updatePayload.status = status;
        if (Object.keys(updatePayload).length === 0) {
            return apiResponse(res, "No valid fields to update", STATUS_CODE.ERROR);
        }
        await DepartmentModel.updateOne({ _id: id }, updatePayload);
        return apiResponse(res, { id: id }, STATUS_CODE.SUCCESS, "Department has been suceesfully updated");
    }
    catch (error: any) {
        console.error("[UPDATE_DEPARTMENT_ERROR]", error?.message || error);
        if (error.code === 11000 || error.code === STATUS_CODE.VALIDATION_ERROR) {
            res.status(STATUS_CODE.ERROR).json({ message: "Department already exists" });
        } else {
            res.status(500).json({
                message: process.env.NODE_ENV === "production" ? "Internal server error" : error.message
            });
        }
    }

}