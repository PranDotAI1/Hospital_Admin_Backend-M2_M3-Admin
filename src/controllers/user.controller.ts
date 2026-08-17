import { HealthRecordModel } from "../models/HealthRecord";
import { NotifiyResponseModel } from "../models/NotifiyResponse";
import { UserModel } from "../models/User";
import { DoctorModel } from "../models/Doctor";
import { NurseModel } from "../models/Nurse";
import {
  apiResponse,
  comparePassword,
  generateUniqueAlphaNumericId,
  hashPassword,
} from "../utils/common";
import { ROLE, STATUS_CODE } from "../utils/constant";
import { Types } from "mongoose";

export const userListing = async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 10);
    const department_id = req.query.department_id;
    const hospital_id = req.query.hospital_id;
    const search = req.query.search;

    const match: any = {};
    if (req.query.role_id !== "all") {
      let role_id =
        req.query.role_id !== undefined ? Number(req.query.role_id) : ROLE.STAFF;
      if (isNaN(role_id)) role_id = ROLE.STAFF;
      match.role_id = role_id;
    }

    const offset = (page - 1) * limit;

    // Optional filters: department_id and hospital_id (if provided)
    if (department_id) {
      if (Types.ObjectId.isValid(department_id)) {
        match.department_id = new Types.ObjectId(department_id);
      } else {
        match.department_id = department_id;
      }
    }
    if (hospital_id) {
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
    // Hash password before saving
    if (input.password) {
      input.password = await hashPassword(input.password);
    }
    // If creating a Nurse, we also need to create the Nurse profile
    if (input.role_id === ROLE.NURSE) {
      const nurse = await NurseModel.create({
        firstName: input.firstName || input.f_name || input.name || "",
        lastName: input.lastName || input.l_name || "",
        email: input.email,
        phone: input.phone || input.mobile || input.contact || "",
        specialization: input.specialization || "General",
        department: input.department_id,
        licenseNumber: input.licenseNumber || undefined,
        experience: input.experience || undefined,
        qualification: input.qualification || "Nursing Degree",
        
        shift: input.shift || undefined,
        assignedDoctorId: input.assignedDoctorId || undefined,
        certifications: input.certifications || undefined,
        roleType: input.roleType || undefined,

        isActive: true,
        status: "ACTIVE",
        permissions: input.permissions,
        created_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
      });
      input.nurseId = nurse._id;
    }

    let response = await UserModel.create(input);
    return apiResponse(
      res,
      { id: response?._id },
      STATUS_CODE.SUCCESS,
      "User has been suceesfully added",
    );
  } catch (error: any) {
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ error: error.message, message: "User already exists" });
    } else {
      res.status(500).json({ error: error.message });
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
    input.password = await hashPassword(input.password); // Set a default password or generate one
    let response = await UserModel.create(input);
    return apiResponse(
      res,
      { id: response?._id },
      STATUS_CODE.SUCCESS,
      "User has been suceesfully added",
    );
  } catch (error: any) {
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ error: error.message, message: "User already exists" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

export const userUpdate = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id) {
      return apiResponse(res, "user ID is required", STATUS_CODE.ERROR);
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
      "permissions",
      "userPermissions",
      "is_super_admin",
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

    const user = await UserModel.findById(id);
    if (!user) {
      return apiResponse(res, "User not found", STATUS_CODE.NOT_FOUND);
    }

    await UserModel.updateOne({ _id: id }, sanitizedInput);

    // If updating a Nurse, sync relevant fields to NurseModel
    if (user.role_id === ROLE.NURSE && user.nurseId) {
      const nurseUpdate: any = {};
      if (input.firstName || input.f_name || input.name) nurseUpdate.firstName = input.firstName || input.f_name || input.name;
      if (input.lastName || input.l_name) nurseUpdate.lastName = input.lastName || input.l_name;
      if (input.email) nurseUpdate.email = input.email;
      if (input.phone || input.mobile || input.contact) nurseUpdate.phone = input.phone || input.mobile || input.contact;
      if (input.department_id) nurseUpdate.department = input.department_id;
      if (input.permissions) nurseUpdate.permissions = input.permissions;
      if (input.hospital_id) nurseUpdate.hospital_id = input.hospital_id;
      
      // New Nurse fields
      if (input.shift !== undefined) nurseUpdate.shift = input.shift;
      if (input.assignedDoctorId !== undefined) nurseUpdate.assignedDoctorId = input.assignedDoctorId;
      if (input.certifications !== undefined) nurseUpdate.certifications = input.certifications;
      if (input.roleType !== undefined) nurseUpdate.roleType = input.roleType;
      if (input.specialization !== undefined) nurseUpdate.specialization = input.specialization;
      if (input.licenseNumber !== undefined) nurseUpdate.licenseNumber = input.licenseNumber;
      if (input.experience !== undefined) nurseUpdate.experience = input.experience;
      if (input.qualification !== undefined) nurseUpdate.qualification = input.qualification;

      if (Object.keys(nurseUpdate).length > 0) {
        nurseUpdate.updated_by = (req as any).user?.id || (req as any).user?._id?.toString?.();
        await NurseModel.updateOne({ _id: user.nurseId }, { $set: nurseUpdate });
      }
    }

    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "User has been successfully updated",
    );
  } catch (error: any) {
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ error: error.message, message: "User already exists" });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

export const updatePassword = async (req: any, res: any) => {
  try {
    let input = req.body;
    let { id } = req.params;
    if (!id) {
      return apiResponse(res, "user ID is required", STATUS_CODE.ERROR);
    }
    let userDetails: any = await UserModel.findById(id);
    const hashedNewPassword = await hashPassword(input.password);

    if (userDetails?.previous_passwords) {
      for (let prevPassword of userDetails.previous_passwords) {
        const isMatch = await comparePassword(input.password, prevPassword);
        if (isMatch) {
          return apiResponse(
            res,
            "You cannot reuse your last 3 passwords",
            STATUS_CODE.ERROR,
          );
        }
      }
      // Add current password to previous_passwords
      userDetails.previous_passwords.push(userDetails.password);
      // Keep only the last 3 passwords
      if (userDetails.previous_passwords.length >= 3) {
        userDetails.previous_passwords =
          userDetails.previous_passwords.slice(-3);
      }
    } else {
      userDetails.previous_passwords = [
        ...userDetails.previous_passwords,
        hashedNewPassword,
      ];
    }
    // Update the user's password and previous_passwords
    await UserModel.updateOne(
      { _id: id },
      {
        password: hashedNewPassword,
        previous_passwords: userDetails.previous_passwords,
      },
    );
    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "Password has been suceesfully updated",
    );
  } catch (error: any) {
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ error: error.message, message: "User already exists" });
    } else {
      res.status(500).json({ error: error.message });
    }
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
    res.status(500).json({ error: error.message });
  }
};

export const userNotifyResponse = async (req: any, res: any) => {
  try {
    let notifyDetails = await NotifiyResponseModel.find({
      health_record_id: req.params.id,
    });

    return apiResponse(res, notifyDetails, STATUS_CODE.SUCCESS);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
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
    if (!id) {
      return apiResponse(res, "user ID is required", STATUS_CODE.ERROR);
    }
    // Update the user's status
    await UserModel.updateOne({ _id: id }, { status: input.status });
    return apiResponse(
      res,
      { id: id },
      STATUS_CODE.SUCCESS,
      "Status has been successfully updated",
    );
  } catch (error: any) {
    if (error.code === 11000) {
      res
        .status(STATUS_CODE.ERROR)
        .json({ error: error.message, message: "User already exists" });
    } else {
      res.status(500).json({ error: error.message });
    }
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
