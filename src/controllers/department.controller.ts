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
        res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }

}

export const addDepartment = async (req: any, res: any) => {
    try {
        let input = req.body;
        let departmentxists = await DepartmentModel.findOne({ name: input.name, is_active: true });
        if (departmentxists) {
            return apiResponse(res, "Department already exists", STATUS_CODE.ERROR);
        }
        let response = await DepartmentModel.create(input);
        return apiResponse(res, { id: response?._id }, STATUS_CODE.SUCCESS, "Department has been suceesfully added");
    }
    catch (error: any) {
        if (error.code === STATUS_CODE.VALIDATION_ERROR) {
            res.status(STATUS_CODE.ERROR).json({ error: error.message, message: "Department already exists" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }

}

export const updateDepartment = async (req: any, res: any) => {
    try {
        let input = req.body;
        let { id } = req.params;
        if (!id) {
            return apiResponse(res, "Department ID is required", STATUS_CODE.ERROR);
        }
        await DepartmentModel.updateOne({ _id: id }, input);
        return apiResponse(res, { id: id }, STATUS_CODE.SUCCESS, "Department has been suceesfully updated");
    }
    catch (error: any) {
        if (error.code === STATUS_CODE.VALIDATION_ERROR) {
            res.status(STATUS_CODE.ERROR).json({ error: error.message, message: "Department already exists" });
        } else {
            res.status(500).json({ error: error.message });
        }
    }

}