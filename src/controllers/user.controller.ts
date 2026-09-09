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
import { ROLE, STATUS_CODE, USER_ENUM } from "../utils/constant";
import { Types } from "mongoose";
import { escapeRegex } from "../utils/sanitizer";
import { revokeAllUserSessions } from "../services/session.service";

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
      const escapedSearch = escapeRegex(String(search));
      match.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { email: { $regex: escapedSearch, $options: "i" } },
        { phone: { $regex: escapedSearch, $options: "i" } },
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
    // req.body is now validated by addUserSchema middleware.
    // Extract only the validated fields — never pass raw req.body to MongoDB.
    const validated = req.body;
    const input: Record<string, any> = {
      name: validated.name,
      f_name: validated.f_name,
      m_name: validated.m_name,
      l_name: validated.l_name,
      firstName: validated.firstName,
      middleName: validated.middleName,
      lastName: validated.lastName,
      email: validated.email,
      mobile: validated.mobile,
      contact: validated.contact,
      role_id: validated.role_id,
      department_id: validated.department_id,
      hospital_id: validated.hospital_id,
      age: validated.age,
      gender: validated.gender,
      shift: validated.shift,
      aadhaar: validated.aadhaar,
      reg_no: validated.reg_no,
      pan: validated.pan,
      specialize: validated.specialize,
      status: validated.status,
    };
    // Remove undefined keys
    Object.keys(input).forEach(key => input[key] === undefined && delete input[key]);

    let userExists = await UserModel.findOne({ email: input.email });
    if (userExists) {
      return apiResponse(res, "User already exists", STATUS_CODE.ERROR);
    }
    input.unique_id = generateUniqueAlphaNumericId();

    // Enforce password strength
    if (validated.password) {
      const pwdValidation = validatePasswordStrength(validated.password, {
        email: validated.email,
        name:
          validated.name ||
          `${validated.f_name || validated.firstName || ""} ${validated.l_name || validated.lastName || ""}`.trim(),
        mobile: validated.mobile,
      });
      if (!pwdValidation.valid) {
        return apiResponse(res, pwdValidation.message, STATUS_CODE.BAD_REQUEST);
      }
      input.password = await hashPassword(validated.password);
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
    // req.body is now validated by addUserSchema middleware.
    const validated = req.body;
    const input: Record<string, any> = {
      name: validated.name,
      f_name: validated.f_name,
      m_name: validated.m_name,
      l_name: validated.l_name,
      firstName: validated.firstName,
      middleName: validated.middleName,
      lastName: validated.lastName,
      email: validated.email,
      mobile: validated.mobile,
      contact: validated.contact,
      role_id: validated.role_id,
      department_id: validated.department_id,
      hospital_id: validated.hospital_id,
      age: validated.age,
      gender: validated.gender,
      shift: validated.shift,
      aadhaar: validated.aadhaar,
      reg_no: validated.reg_no,
      pan: validated.pan,
      specialize: validated.specialize,
      status: validated.status,
    };
    Object.keys(input).forEach(key => input[key] === undefined && delete input[key]);

    let userExists = await UserModel.findOne({ email: input.email });
    if (userExists) {
      return apiResponse(res, "User already exists", STATUS_CODE.ERROR);
    }
    input.unique_id = generateUniqueAlphaNumericId();

    // Enforce password strength
    if (validated.password) {
      const pwdValidation = validatePasswordStrength(validated.password, {
        email: validated.email,
        name:
          validated.name ||
          `${validated.f_name || validated.firstName || ""} ${validated.l_name || validated.lastName || ""}`.trim(),
        mobile: validated.mobile,
      });
      if (!pwdValidation.valid) {
        return apiResponse(res, pwdValidation.message, STATUS_CODE.BAD_REQUEST);
      }
      input.password = await hashPassword(validated.password);
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

    // If user account is deactivated, revoke all active sessions immediately
    if (
      (sanitizedInput.status !== undefined &&
        sanitizedInput.status !== USER_ENUM.ACTIVE) ||
      sanitizedInput.is_active === false
    ) {
      await revokeAllUserSessions(id);
    }
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

    let userDetails: any = await UserModel.findById(id);
    if (!userDetails) {
      return apiResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    // Enforce strict password complexity and contextual identity checks
    const strengthCheck = validatePasswordStrength(input.password, {
      email: userDetails.email,
      name:
        userDetails.name ||
        `${userDetails.f_name || userDetails.firstName || ""} ${userDetails.l_name || userDetails.lastName || ""}`.trim(),
      mobile: userDetails.mobile,
    });
    if (!strengthCheck.valid) {
      return apiResponse(res, strengthCheck.message, STATUS_CODE.BAD_REQUEST);
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

    // Check password history (cannot reuse last 5 passwords or current password)
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
          "You cannot reuse any of your last 5 passwords",
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
      .slice(-5);

    // Update user's password and previous_passwords
    await UserModel.updateOne(
      { _id: id },
      {
        password: hashedNewPassword,
        previous_passwords: updatedHistory,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
    );

    // Invalidate all active sessions across all devices for this user
    await revokeAllUserSessions(id);

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

/**
 * Helper to mask sensitive national identity strings (Aadhaar, PAN)
 */
const maskAadhaar = (aadhaar?: string): string | undefined => {
  if (!aadhaar) return undefined;
  const clean = aadhaar.replace(/\D/g, "");
  if (clean.length < 4) return "XXXX-XXXX-XXXX";
  return `XXXX-XXXX-${clean.slice(-4)}`;
};

const maskPan = (pan?: string): string | undefined => {
  if (!pan) return undefined;
  const trimmed = pan.trim();
  if (trimmed.length < 4) return "XXXXX-XXXX";
  return `XXXXX${trimmed.slice(-4)}`;
};

const getRoleName = (roleId?: number): string => {
  switch (roleId) {
    case ROLE.SUPER_ADMIN:
      return "SUPER_ADMIN";
    case ROLE.HOSPITAL_ADMIN:
      return "HOSPITAL_ADMIN";
    case ROLE.DOCTOR:
      return "DOCTOR";
    case ROLE.STAFF:
      return "STAFF";
    case ROLE.NURSE:
      return "NURSE";
    default:
      return "UNKNOWN";
  }
};

/**
 * GET /me, GET /profile, GET /auth/me
 * Production-grade User Profile endpoint with strict allowlist DTO projection.
 * Never leaks passwords, reset tokens, OTPs, or raw national identifiers.
 */
export const userProfile = async (req: any, res: any) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const userEmail = req.user?.email;

    if (!userId && !userEmail) {
      return apiResponse(res, null, STATUS_CODE.UNAUTHORIZED, "Unauthorized");
    }

    const matchQuery: any = userId
      ? { _id: new Types.ObjectId(userId.toString()) }
      : { email: userEmail.toLowerCase().trim() };

    const users = await UserModel.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "departments",
          localField: "department_id",
          foreignField: "_id",
          as: "department",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                department_id: 1,
                description: 1,
                status: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: "$department", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "hospitals",
          localField: "hospital_id",
          foreignField: "_id",
          as: "hospital",
          pipeline: [
            {
              $project: {
                _id: 1,
                name: 1,
                city: 1,
                state: 1,
                pincode: 1,
                country: 1,
                is_active: 1,
              },
            },
          ],
        },
      },
      { $unwind: { path: "$hospital", preserveNullAndEmptyArrays: true } },
    ]);

    const user = users && users.length ? users[0] : null;
    if (!user) {
      return apiResponse(res, null, STATUS_CODE.NOT_FOUND, "User profile not found");
    }

    // ─── STRICT PRODUCTION WHITELIST DTO ───
    // Guarantees zero sensitive data leakage (no passwords, reset tokens, OTPs, or internal credentials)
    const displayName =
      user.name ||
      `${user.firstName || user.f_name || ""} ${user.lastName || user.l_name || ""}`.trim() ||
      user.email;

    const safeProfile = {
      id: user._id.toString(),
      _id: user._id,
      email: user.email,
      name: displayName,
      firstName: user.firstName || user.f_name || "",
      middleName: user.middleName || user.m_name || "",
      lastName: user.lastName || user.l_name || "",
      f_name: user.f_name || user.firstName || "",
      l_name: user.l_name || user.lastName || "",
      role_id: user.role_id,
      role_name: getRoleName(user.role_id),
      is_super_admin: user.is_super_admin || user.role_id === ROLE.SUPER_ADMIN,
      status: user.status,
      is_active: user.is_active !== false,
      mobile: user.mobile || user.contact || "",
      contact: user.contact || user.mobile || "",
      gender: user.gender || "",
      age: user.age || undefined,
      shift: user.shift || "",
      unique_id: user.unique_id || "",

      // Professional / ABDM Healthcare Identity
      hprId: user.hprId || user.hprIdNumber || "",
      hprIdNumber: user.hprIdNumber || user.hprId || "",
      reg_no: user.reg_no || "",
      specialize: user.specialize || undefined,
      categories: user.categories || undefined,

      // Associated Organization & Department
      hospital_id: user.hospital_id || undefined,
      hospital: user.hospital || undefined,
      department_id: user.department_id || undefined,
      department: user.department || undefined,

      // Authorization & Permissions
      permissions: user.permissions || user.userPermissions || [],
      userPermissions: user.userPermissions || user.permissions || [],

      // Contact & Address
      address: user.address || undefined,

      // Masked PII (Protected under ABDM / DPDP Act / UIDAI Aadhaar Act)
      aadhaar_masked: maskAadhaar(user.aadhaar),
      pan_masked: maskPan(user.pan),

      // Current Session Context
      sessionId: req.sessionId || undefined,

      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return apiResponse(res, safeProfile, STATUS_CODE.SUCCESS, "User profile retrieved successfully");
  } catch (error: any) {
    console.error("[USER_PROFILE_ERROR]", error?.message || error);
    return res
      .status(STATUS_CODE.ERROR)
      .json({ message: "Failed to retrieve user profile", code: STATUS_CODE.ERROR });
  }
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
      const escapedSearch = escapeRegex(String(search));
      match.$or = [
        { firstName: { $regex: escapedSearch, $options: "i" } },
        { lastName: { $regex: escapedSearch, $options: "i" } },
        { specialization: { $regex: escapedSearch, $options: "i" } },
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
