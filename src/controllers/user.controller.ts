import { HealthRecordModel } from "../models/HealthRecord";
import { NotifiyResponseModel } from "../models/NotifiyResponse";
import { UserModel } from "../models/User";
import { DoctorModel } from "../models/Doctor";
import {
  apiResponse,
  comparePassword,
  generateUniqueAlphaNumericId,
  hashPassword,
} from "../utils/common";
import { validatePasswordStrength } from "../utils/password.validator";
import { ROLE, STATUS_CODE } from "../utils/constant";
import { Types } from "mongoose";

export const userListing = async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const department_id = req.query.department_id;
    let hospital_id = req.query.hospital_id;
    const search = req.query.search;

    let role_id =
      req.query.role_id !== undefined ? Number(req.query.role_id) : ROLE.STAFF;
    if (isNaN(role_id)) role_id = ROLE.STAFF;

    const offset = (page - 1) * limit;

    const match: any = { role_id };

    // Enforce hospital scoping for non-superadmin callers (IDOR prevention)
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    if (!isSuperAdmin && req.user?.hospital_id) {
      match.hospital_id = new Types.ObjectId(req.user.hospital_id);
    } else if (hospital_id) {
      if (Types.ObjectId.isValid(hospital_id)) {
        match.hospital_id = new Types.ObjectId(hospital_id);
      } else {
        match.hospital_id = hospital_id;
      }
    }
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: "departments",
          localField: "department_id",
          foreignField: "_id",
          as: "department",
        },
      },
      { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital_id",
          foreignField: "_id",
          as: "hospital",
        },
      },
      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
      { $project: { password: 0, previous_passwords: 0 } },
    ];

    const [userList, total] = await Promise.all([
      UserModel.aggregate(pipeline).sort({ _id: -1 }).skip(offset).limit(limit),
      UserModel.countDocuments(match),
    ]);

    return apiResponse(
      res,
      {
        users: userList,
        total,
        page,
        limit,
      },
      STATUS_CODE.SUCCESS,
      "Users retrieved successfully",
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const userAdd = async (req: any, res: any) => {
  try {
    let input = req.body;
    let userExists = await UserModel.findOne({ email: input.email });
    if (userExists) {
      return apiResponse(res, "User already exists", STATUS_CODE.ERROR);
    }
    input.unique_id = generateUniqueAlphaNumericId();

    // Enforce password strength
    if (input.password) {
      const pwdValidation = validatePasswordStrength(input.password);
      if (!pwdValidation.valid) {
        return apiResponse(res, pwdValidation.message, STATUS_CODE.BAD_REQUEST);
      }
      input.password = await hashPassword(input.password);
    }

    // IDOR / Multi-tenant: non-superadmin users can only create users in their own hospital
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    if (!isSuperAdmin && req.user?.hospital_id) {
      input.hospital_id = req.user.hospital_id;
    }

    let response = await UserModel.create(input);
    return apiResponse(
      res,
      { id: response?._id },
      STATUS_CODE.SUCCESS,
      "User has been successfully added",
    );
  } catch (error: any) {
    console.error("[USER_ADD_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "User with this email or unique identifier already exists" });
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

export const userNewAdd = async (req: any, res: any) => {
  try {
    let input = req.body;
    let userExists = await UserModel.findOne({ email: input.email });
    if (userExists) {
      return apiResponse(res, "User already exists", STATUS_CODE.ERROR);
    }
    input.unique_id = generateUniqueAlphaNumericId();

    // Enforce password strength
    if (input.password) {
      const pwdValidation = validatePasswordStrength(input.password);
      if (!pwdValidation.valid) {
        return apiResponse(res, pwdValidation.message, STATUS_CODE.BAD_REQUEST);
      }
      input.password = await hashPassword(input.password);
    }

    // IDOR / Multi-tenant: non-superadmin users can only create users in their own hospital
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    if (!isSuperAdmin && req.user?.hospital_id) {
      input.hospital_id = req.user.hospital_id;
    }

    let response = await UserModel.create(input);
    return apiResponse(
      res,
      { id: response?._id },
      STATUS_CODE.SUCCESS,
      "User has been successfully added",
    );
  } catch (error: any) {
    console.error("[USER_NEW_ADD_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "User with this email or unique identifier already exists" });
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

export const userUpdate = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id || !Types.ObjectId.isValid(id)) {
      return apiResponse(res, "Valid user ID is required", STATUS_CODE.BAD_REQUEST);
    }

    const targetUser = await UserModel.findById(id);
    if (!targetUser) {
      return apiResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    // IDOR / Multi-tenant authorization check
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    if (!isSuperAdmin) {
      if (
        req.user?.hospital_id &&
        targetUser.hospital_id &&
        targetUser.hospital_id.toString() !== req.user.hospital_id.toString()
      ) {
        return apiResponse(
          res,
          "Forbidden: You can only update users within your hospital",
          STATUS_CODE.FORBIDDEN,
        );
      }
      // Non-superadmins cannot modify hospital assignment or elevate privileges
      delete input.hospital_id;
      delete input.is_super_admin;
      if (input.role_id === ROLE.SUPER_ADMIN) {
        delete input.role_id;
      }
    }

    const ALLOWED_UPDATE_FIELDS = [
      "name",
      "f_name",
      "m_name",
      "l_name",
      "firstName",
      "middleName",
      "lastName",
      "mobile",
      "contact",
      "email",
      "age",
      "gender",
      "shift",
      "department_id",
      "hospital_id",
      "status",
      "is_active",
      "address",
      "aadhaar",
      "reg_no",
      "pan",
      "specialize",
    ];
    const sanitizedInput: Record<string, any> = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
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

    await UserModel.updateOne({ _id: id }, sanitizedInput);
    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "User has been successfully updated",
    );
  } catch (error: any) {
    console.error("[USER_UPDATE_ERROR]", error?.message || error);
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ message: "User with this email or identifier already exists" });
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

export const updatePassword = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id || !Types.ObjectId.isValid(id)) {
      return apiResponse(res, "Valid user ID is required", STATUS_CODE.BAD_REQUEST);
    }

    if (!input.password) {
      return apiResponse(res, "New password is required", STATUS_CODE.BAD_REQUEST);
    }

    // Enforce strict password complexity
    const strengthCheck = validatePasswordStrength(input.password);
    if (!strengthCheck.valid) {
      return apiResponse(res, strengthCheck.message, STATUS_CODE.BAD_REQUEST);
    }

    let userDetails: any = await UserModel.findById(id);
    if (!userDetails) {
      return apiResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    const isSelf =
      req.user?.id?.toString() === id.toString() ||
      req.user?._id?.toString() === id.toString();
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    const isHospitalAdmin = req.user?.role_id === ROLE.HOSPITAL_ADMIN;

    // Authorization verification
    if (!isSelf && !isSuperAdmin) {
      if (isHospitalAdmin) {
        // Hospital admin can only reset passwords for users in their hospital
        if (
          !req.user?.hospital_id ||
          !userDetails.hospital_id ||
          req.user.hospital_id.toString() !== userDetails.hospital_id.toString()
        ) {
          return apiResponse(
            res,
            "Forbidden: You cannot reset password for a user from another hospital",
            STATUS_CODE.FORBIDDEN,
          );
        }
      } else {
        return apiResponse(
          res,
          "Forbidden: You can only update your own password",
          STATUS_CODE.FORBIDDEN,
        );
      }
    }

    // If self-updating, verify current password
    if (isSelf && !isSuperAdmin) {
      if (!input.currentPassword) {
        return apiResponse(
          res,
          "Current password is required to update your password",
          STATUS_CODE.BAD_REQUEST,
        );
      }
      const isCurrentPasswordCorrect = await comparePassword(
        input.currentPassword,
        userDetails.password,
      );
      if (!isCurrentPasswordCorrect) {
        return apiResponse(
          res,
          "Current password does not match",
          STATUS_CODE.BAD_REQUEST,
        );
      }
    }

    // Check password history (cannot reuse last 3 passwords or current password)
    const previousPasswords: string[] = Array.isArray(
      userDetails.previous_passwords,
    )
      ? userDetails.previous_passwords
      : [];

    for (let prevPassword of previousPasswords) {
      const isMatch = await comparePassword(input.password, prevPassword);
      if (isMatch) {
        return apiResponse(
          res,
          "You cannot reuse your last 3 passwords",
          STATUS_CODE.BAD_REQUEST,
        );
      }
    }

    if (
      userDetails.password &&
      (await comparePassword(input.password, userDetails.password))
    ) {
      return apiResponse(
        res,
        "New password cannot be the same as your current password",
        STATUS_CODE.BAD_REQUEST,
      );
    }

    const hashedNewPassword = await hashPassword(input.password);
    const updatedHistory = [
      ...previousPasswords,
      userDetails.password,
    ]
      .filter(Boolean)
      .slice(-3);

    // Update user's password and previous_passwords
    await UserModel.updateOne(
      { _id: id },
      {
        password: hashedNewPassword,
        previous_passwords: updatedHistory,
      },
    );

    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "Password has been successfully updated",
    );
  } catch (error: any) {
    console.error("[UPDATE_PASSWORD_ERROR]", error?.message || error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Failed to update password"
          : error.message,
    });
  }
};

export const abhauserListing = async (req: any, res: any) => {
  try {
    let { page, limit = 10 } = req.query;

    let offset = page > 0 ? (page - 1) * limit : 0;

    let userList: any = await HealthRecordModel.find()
      .skip(offset)
      .limit(limit)
      .sort({ _id: -1 })
      .lean();

    userList.data = userList?.data?.filter(
      (item: any) => item?.version_m3 != undefined,
    );
    return apiResponse(
      res,
      {
        data: userList,
        total: await UserModel.countDocuments(),
        page: parseInt(page),
        limit: parseInt(limit),
      },
      STATUS_CODE.SUCCESS,
    );
  } catch (error: any) {
    console.error("[ABHA_USER_LISTING_ERROR]", error?.message || error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error.message,
    });
  }
};

export const userNotifyResponse = async (req: any, res: any) => {
  try {
    let notifyDetails = await NotifiyResponseModel.find({
      health_record_id: req.params.id,
    });

    return apiResponse(res, notifyDetails, STATUS_CODE.SUCCESS);
  } catch (error: any) {
    console.error("[USER_NOTIFY_ERROR]", error?.message || error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error.message,
    });
  }
};

export const userProfile = async (req: any, res: any) => {
  const profile = req.user;
  if (!profile?.email) {
    return apiResponse(res, null, STATUS_CODE.UNAUTHORIZED);
  }
  const users = await UserModel.aggregate([
    { $match: { email: profile.email } },
    {
      $lookup: {
        from: "departments",
        localField: "department_id",
        foreignField: "_id",
        as: "department",
      },
    },
    { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "hospitals",
        localField: "hospital_id",
        foreignField: "_id",
        as: "hospital",
      },
    },
    { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
    { $project: { password: 0, previous_passwords: 0 } },
  ]);
  const user = users && users.length ? users[0] : null;
  return apiResponse(res, user, STATUS_CODE.SUCCESS);
};

export const updateStatus = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id || !Types.ObjectId.isValid(id)) {
      return apiResponse(res, "Valid user ID is required", STATUS_CODE.BAD_REQUEST);
    }

    const targetUser = await UserModel.findById(id);
    if (!targetUser) {
      return apiResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    // IDOR / Multi-tenant authorization check
    const isSuperAdmin =
      req.user?.is_super_admin || req.user?.role_id === ROLE.SUPER_ADMIN;
    if (!isSuperAdmin) {
      if (
        req.user?.hospital_id &&
        targetUser.hospital_id &&
        targetUser.hospital_id.toString() !== req.user.hospital_id.toString()
      ) {
        return apiResponse(
          res,
          "Forbidden: You can only update users within your hospital",
          STATUS_CODE.FORBIDDEN,
        );
      }
    }

    await UserModel.updateOne({ _id: id }, { status: input.status });
    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "Status has been successfully updated",
    );
  } catch (error: any) {
    console.error("[UPDATE_STATUS_ERROR]", error?.message || error);
    res.status(500).json({
      message:
        process.env.NODE_ENV === "production"
          ? "Internal server error"
          : error.message,
    });
  }
};

export const doctorListing = async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 100);
    const offset = (page - 1) * limit;

    const match: any = { isActive: true };
    const deptId = req.query.department_id;
    const search = req.query.search;

    if (deptId) {
      if (Types.ObjectId.isValid(deptId as string)) {
        match.department = new Types.ObjectId(deptId as string);
      } else {
        match.department = deptId;
      }
    }

    if (search) {
      match.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    const doctors = await DoctorModel.find(match)
      .populate("department")
      .sort({ firstName: 1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const total = await DoctorModel.countDocuments(match);

    return apiResponse(
      res,
      {
        doctors: doctors,
        total,
        page,
        limit,
      },
      STATUS_CODE.SUCCESS,
      "Doctors retrieved successfully from independent collection",
    );
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
