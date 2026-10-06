import { Request, Response } from "express";
import { DepartmentModel } from "../../models/Department";
import { STATUS_CODE } from "../../utils/constant";

export const getDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await DepartmentModel.find({ status: { $ne: false } })
      .select("_id department_id name description")
      .sort({ name: 1 })
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      message: "Departments retrieved successfully",
      count: departments.length,
      data: departments,
    });
  } catch (error: any) {
    console.error("[CHAT_DEPARTMENT_LIST_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to retrieve departments" : error.message,
    });
  }
};
