import { STATUS_CODE } from "../utils/constant";
import { apiResponse } from "../utils/common";
import { HospitalModel } from "../models/Hospital";

export const listing = async (req: any, res: any) => {
  try {
    let { page, limit = 2 } = req.query;

    let offset = page > 0 ? (page - 1) * limit : 0;

    let hospitals = await HospitalModel.find()
      .skip(offset)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    return apiResponse(
      res,
      {
        hospitals: hospitals,
        total: await HospitalModel.countDocuments(),
        page: parseInt(page),
        limit: parseInt(limit),
      },
      STATUS_CODE.SUCCESS,
    );
  } catch (error: any) {
    console.error("[HOSPITAL_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "Hospital with this name or identifier already exists" });
    } else {
      res.status(500).json({
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error.message,
      });
    }
  }
};

export const add = async (req: any, res: any) => {
  try {
    // req.body is now validated by addHospitalSchema middleware.
    const { name, add1, add2, city, state, pincode, country, is_active } = req.body;
    let hospitalExists = await HospitalModel.findOne({
      name,
      is_active: true,
    });
    if (hospitalExists) {
      return apiResponse(res, "Hospital already exists", STATUS_CODE.ERROR);
    }
    const createPayload: Record<string, any> = { name, add1, city, state, pincode };
    if (add2 !== undefined) createPayload.add2 = add2;
    if (country !== undefined) createPayload.country = country;
    if (is_active !== undefined) createPayload.is_active = is_active;
    let response = await HospitalModel.create(createPayload);
    return apiResponse(
      res,
      { id: response?._id },
      STATUS_CODE.SUCCESS,
      "Hospital has been suceesfully added",
    );
  } catch (error: any) {
    console.error("[HOSPITAL_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "Hospital with this name or identifier already exists" });
    } else {
      res.status(500).json({
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error.message,
      });
    }
  }
};

export const update = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id) {
      return apiResponse(res, "Hospital ID is required", STATUS_CODE.ERROR);
    }

    const ALLOWED_FIELDS = [
      "name",
      "address",
      "phone",
      "email",
      "is_active",
      "city",
      "state",
      "pincode",
    ];
    const sanitizedInput: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      if (input[key] !== undefined) {
        sanitizedInput[key] = input[key];
      }
    }

    if (Object.keys(sanitizedInput).length === 0) {
      return apiResponse(
        res,
        "No valid fields to update",
        STATUS_CODE.BAD_REQUEST,
      );
    }

    await HospitalModel.updateOne({ _id: id }, sanitizedInput);
    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "Hospital has been successfully updated",
    );
  } catch (error: any) {
    console.error("[HOSPITAL_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "Hospital with this name or identifier already exists" });
    } else {
      res.status(500).json({
        message:
          process.env.NODE_ENV === "production"
            ? "Internal server error"
            : error.message,
      });
    }
  }
};
