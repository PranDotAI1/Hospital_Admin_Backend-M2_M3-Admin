import crypto from "crypto";
import { Request, Response } from "express";
import { Types } from "mongoose";
import { DoctorModel } from "../../models/Doctor";
import { UserModel } from "../../models/User";
import { ScanShareVisitModel, ScanShareVisitStatus } from "../../models/ScanShareVisit";
import {
  hashPassword,
  generateUniqueAlphaNumericId,
  successResponse,
  errorResponse,
  successListResponse,
  buildPaginationMeta,
} from "../../utils/common";
import {
  STATUS_CODE,
  ROLE,
  DOCTOR_STATUS,
  DOCTOR_CURRENT_STATUS,
  DOCTOR_INVITE_EXPIRY_MINUTES,
  DEFAULT_AVAILABLE_SLOTS,
} from "../../utils/constant";
import { sendDoctorInviteEmail } from "../../services/email.service";

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateInviteToken = (): string =>
  crypto.randomBytes(32).toString("hex");

const isValidInviteTokenFormat = (token: string): boolean =>
  typeof token === "string" && /^[a-f0-9]{64}$/i.test(token.trim());

const isValidObjectId = (id: string): boolean =>
  typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);

const getParamId = (req: Request): string =>
  Array.isArray(req.params.id) ? req.params.id[0] ?? "" : req.params.id ?? "";

const getTodayStartEnd = (): { start: Date; end: Date } => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

export const createDoctor = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;

    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const phone = String(body.phone || "").trim();
    const specialization = String(body.specialization || "").trim();
    const department = body.department;
    const licenseNumber = String(body.licenseNumber || "").trim();
    const experience = body.experience != null ? Number(body.experience) : null;
    const qualification = String(body.qualification || "").trim();
    const consultationFee =
      body.consultationFee != null ? Number(body.consultationFee) : null;
    const availableSlots =
      Array.isArray(body.availableSlots) && body.availableSlots.length > 0
        ? (body.availableSlots as any[])
        : [...DEFAULT_AVAILABLE_SLOTS];

    const gender = body.gender != null ? String(body.gender).trim() : undefined;
    const age = body.age != null ? Number(body.age) : undefined;
    const status = (body.status as string) || DOCTOR_STATUS.ACTIVE;
    const accessLevel = (body.accessLevel as string) || "FULL";
    const hospital_id = body.hospital_id;
    const primarySpecializationId = body.primarySpecializationId;

    if (!firstName || !lastName) {
      return errorResponse(
        res,
        "firstName and lastName are required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (!email) {
      return errorResponse(res, "email is required", STATUS_CODE.BAD_REQUEST);
    }
    if (!phone) {
      return errorResponse(res, "phone is required", STATUS_CODE.BAD_REQUEST);
    }
    if (!specialization) {
      return errorResponse(
        res,
        "specialization is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (!department || !isValidObjectId(String(department))) {
      return errorResponse(
        res,
        "Valid department is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (!licenseNumber) {
      return errorResponse(
        res,
        "licenseNumber is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (experience === null || experience < 0) {
      return errorResponse(
        res,
        "Valid experience (years) is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (!qualification) {
      return errorResponse(
        res,
        "qualification is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (consultationFee === null || consultationFee < 0) {
      return errorResponse(
        res,
        "Valid consultationFee is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const existingByEmail = await DoctorModel.findOne({ email }).select("_id");
    if (existingByEmail) {
      return errorResponse(
        res,
        "Doctor with this email already exists",
        STATUS_CODE.CONFLICT
      );
    }
    const existingByLicense = await DoctorModel.findOne({
      licenseNumber,
    }).select("_id");
    if (existingByLicense) {
      return errorResponse(
        res,
        "Doctor with this license number already exists",
        STATUS_CODE.CONFLICT
      );
    }

    const plainToken = generateInviteToken();
    const hashedToken = hashToken(plainToken);
    const inviteTokenExpires = new Date(
      Date.now() + DOCTOR_INVITE_EXPIRY_MINUTES * 60 * 1000
    );

    const doc = await DoctorModel.create({
      firstName,
      lastName,
      email,
      phone,
      specialization,
      department: new Types.ObjectId(String(department)),
      licenseNumber,
      experience,
      qualification,
      consultationFee,
      availableSlots,
      isActive: true,
      gender,
      age,
      primarySpecializationId:
        primarySpecializationId &&
        isValidObjectId(String(primarySpecializationId))
          ? new Types.ObjectId(String(primarySpecializationId))
          : undefined,
      additionalSpecializationIds: Array.isArray(
        body.additionalSpecializationIds
      )
        ? (body.additionalSpecializationIds as string[])
            .filter(isValidObjectId)
            .map((id) => new Types.ObjectId(id))
        : [],
      hospital_id:
        hospital_id && isValidObjectId(String(hospital_id))
          ? new Types.ObjectId(String(hospital_id))
          : undefined,
      status: Object.values(DOCTOR_STATUS).includes(status as any)
        ? status
        : DOCTOR_STATUS.ACTIVE,
      currentStatus: DOCTOR_CURRENT_STATUS.OFF_DUTY,
      inviteToken: hashedToken,
      inviteTokenExpires,
      inviteSentAt: new Date(),
      accessLevel: ["FULL", "LIMITED", "VIEW_ONLY"].includes(accessLevel)
        ? accessLevel
        : "FULL",
      permissions: body.permissions || undefined,
      created_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
    });

    // Send invite email
    sendDoctorInviteEmail({
      to: email,
      doctorName: `${firstName} ${lastName}`,
      inviteToken: plainToken,
      expiryMinutes: Math.floor(DOCTOR_INVITE_EXPIRY_MINUTES / 60),
    }).catch((err) => console.error("Doctor invite email failed:", err));

    return successResponse(
      res,
      { id: doc._id },
      "Doctor created. Invite email sent.",
      STATUS_CODE.CREATED
    );
  } catch (error: any) {
    console.error("createDoctor error:", error);
    return errorResponse(
      res,
      error.message || "Failed to create doctor",
      STATUS_CODE.ERROR
    );
  }
};

export const listDoctors = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(String(req.query.limit)) || 20)
    );
    const department = req.query.department as string | undefined;
    const specialization = req.query.specialization as string | undefined;
    const status = req.query.status as string | undefined;
    const currentStatus = req.query.currentStatus as string | undefined;
    const accessLevel = req.query.accessLevel as string | undefined;
    const search = (req.query.search as string)?.trim();
    const isActive = req.query.isActive as string | undefined;

    const match: Record<string, unknown> = {};

    if (isActive === "true") match.isActive = true;
    else if (isActive === "false") match.isActive = false;

    if (department && isValidObjectId(department)) {
      match.department = new Types.ObjectId(department);
    }
    if (specialization) {
      match.specialization = { $regex: specialization, $options: "i" };
    }
    if (status && Object.values(DOCTOR_STATUS).includes(status as any)) {
      match.status = status;
    }
    if (
      currentStatus &&
      Object.values(DOCTOR_CURRENT_STATUS).includes(currentStatus as any)
    ) {
      match.currentStatus = currentStatus;
    }
    if (accessLevel && ["FULL", "LIMITED", "VIEW_ONLY"].includes(accessLevel)) {
      match.accessLevel = accessLevel;
    }

    if (search) {
      match.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { licenseNumber: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;
    const { start: todayStart, end: todayEnd } = getTodayStartEnd();

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: {
          from: "departments",
          localField: "department",
          foreignField: "_id",
          as: "departmentInfo",
        },
      },
      {
        $unwind: { path: "$departmentInfo", preserveNullAndEmptyArrays: true },
      },
      {
        $lookup: {
          from: "scan_share_visits",
          let: { docId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$doctorId", "$$docId"] },
                visitDate: { $gte: todayStart, $lte: todayEnd },
                visitStatus: {
                  $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.COMPLETED],
                },
              },
            },
            { $count: "count" },
          ],
          as: "appointmentsToday",
        },
      },
      {
        $addFields: {
          appointmentsToday: {
            $ifNull: [{ $arrayElemAt: ["$appointmentsToday.count", 0] }, 0],
          },
          fullName: { $concat: ["$firstName", " ", "$lastName"] },
          departmentName: "$departmentInfo.name",
        },
      },
      { $sort: { firstName: 1, lastName: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          inviteToken: 0,
          inviteTokenExpires: 0,
          inviteSentAt: 0,
          departmentInfo: 0,
          __v: 0,
        },
      },
    ];

    const [list, total] = await Promise.all([
      DoctorModel.aggregate(pipeline),
      DoctorModel.countDocuments(match),
    ]);

    res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: list,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    });
    return;
  } catch (error: any) {
    console.error("listDoctors error:", error);
    return errorResponse(
      res,
      error.message || "Failed to list doctors",
      STATUS_CODE.ERROR
    );
  }
};

export const getDoctor = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    let doctor = await DoctorModel.findById(id)
      .select("-inviteToken -inviteTokenExpires -inviteSentAt")
      .populate("department", "name description")
      .populate("hospital_id", "name")
      .lean();

    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const { start: todayStart, end: todayEnd } = getTodayStartEnd();
    const appointmentsToday = await ScanShareVisitModel.countDocuments({
      doctorId: new Types.ObjectId(id),
      visitDate: { $gte: todayStart, $lte: todayEnd },
      visitStatus: { $in: [ScanShareVisitStatus.REGISTERED, ScanShareVisitStatus.COMPLETED] },
    });

    const availableSlots =
      doctor.availableSlots && doctor.availableSlots.length > 0
        ? doctor.availableSlots
        : [...DEFAULT_AVAILABLE_SLOTS];

    const fullName = `${doctor.firstName} ${doctor.lastName}`.trim();

    return successResponse(res, {
      ...doctor,
      fullName,
      availableSlots,
      appointmentsToday,
    });
  } catch (error: any) {
    console.error("getDoctor error:", error);
    return errorResponse(
      res,
      error.message || "Failed to get doctor",
      STATUS_CODE.ERROR
    );
  }
};

export const updateDoctor = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    const allowedFields = [
      "firstName",
      "lastName",
      "phone",
      "specialization",
      "department",
      "licenseNumber",
      "experience",
      "qualification",
      "consultationFee",
      "availableSlots",
      "gender",
      "age",
      "profileImage",
      "primarySpecializationId",
      "additionalSpecializationIds",
      "hospital_id",
      "assignedHospitalUnitIds",
      "status",
      "accessLevel",
      "permissions",
      "timeZone",
    ];

    for (const key of allowedFields) {
      if (body[key] === undefined) continue;

      if (
        key === "department" ||
        key === "primarySpecializationId" ||
        key === "hospital_id"
      ) {
        if (body[key] && isValidObjectId(String(body[key]))) {
          update[key] = new Types.ObjectId(String(body[key]));
        }
        continue;
      }
      if (key === "additionalSpecializationIds" && Array.isArray(body[key])) {
        update[key] = (body[key] as string[])
          .filter(isValidObjectId)
          .map((x) => new Types.ObjectId(x));
        continue;
      }
      if (key === "assignedHospitalUnitIds" && Array.isArray(body[key])) {
        update[key] = (body[key] as string[])
          .filter(isValidObjectId)
          .map((x) => new Types.ObjectId(x));
        continue;
      }
      if (
        key === "status" &&
        Object.values(DOCTOR_STATUS).includes(body[key] as any)
      ) {
        update[key] = body[key];
        continue;
      }
      if (key === "experience") {
        const val = Number(body[key]);
        if (Number.isNaN(val) || val < 0) {
          return errorResponse(
            res,
            "Experience must be a valid number (e.g. 3 or 4.5)",
            STATUS_CODE.BAD_REQUEST
          );
        }
        update[key] = val;
        continue;
      }
      update[key] = body[key];
    }

    update.updated_by =
      (req as any).user?.id || (req as any).user?._id?.toString?.();

    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      const existing = await DoctorModel.findOne({
        email,
        _id: { $ne: new Types.ObjectId(id) },
      });
      if (existing) {
        return errorResponse(
          res,
          "Another doctor with this email exists",
          STATUS_CODE.CONFLICT
        );
      }
      update.email = email;
    }

    const doc = await DoctorModel.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).select("-inviteToken -inviteTokenExpires -inviteSentAt");

    if (!doc) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    return successResponse(res, { id: doc._id }, "Doctor updated successfully");
  } catch (error: any) {
    console.error("updateDoctor error:", error);
    return errorResponse(
      res,
      error.message || "Failed to update doctor",
      STATUS_CODE.ERROR
    );
  }
};

export const updateDoctorStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    const status = (req.body?.status as string)?.toUpperCase?.();

    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (!status || !Object.values(DOCTOR_STATUS).includes(status as any)) {
      return errorResponse(
        res,
        "status must be ACTIVE, ON_LEAVE, or RETIRED",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const doc = await DoctorModel.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          updated_by:
            (req as any).user?.id || (req as any).user?._id?.toString?.(),
        },
      },
      { new: true }
    ).select("_id status");

    if (!doc) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }
    return successResponse(
      res,
      { id: doc._id, status: doc.status },
      "Status updated"
    );
  } catch (error: any) {
    console.error("updateDoctorStatus error:", error);
    return errorResponse(
      res,
      error.message || "Failed to update status",
      STATUS_CODE.ERROR
    );
  }
};

export const updateDoctorCurrentStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    const currentStatus = (req.body?.currentStatus as string)?.toUpperCase?.();
    const currentVisitId = req.body?.currentVisitId;

    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }
    if (
      !currentStatus ||
      !Object.values(DOCTOR_CURRENT_STATUS).includes(currentStatus as any)
    ) {
      return errorResponse(
        res,
        "currentStatus must be one of: AVAILABLE, CONSULTING, ON_BREAK, LEAVE, OFF_DUTY, NOT_AVAILABLE",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const set: Record<string, unknown> = {
      currentStatus,
      currentStatusUpdatedAt: new Date(),
      updated_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
    };

    if (
      currentStatus === "CONSULTING" &&
      currentVisitId &&
      isValidObjectId(String(currentVisitId))
    ) {
      set.currentVisitId = new Types.ObjectId(String(currentVisitId));
    } else {
      set.currentVisitId = null;
    }

    const doc = await DoctorModel.findByIdAndUpdate(
      id,
      { $set: set },
      { new: true }
    ).select("_id currentStatus currentStatusUpdatedAt currentVisitId");

    if (!doc) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }
    return successResponse(
      res,
      { id: doc._id, currentStatus: doc.currentStatus },
      "Current status updated"
    );
  } catch (error: any) {
    console.error("updateDoctorCurrentStatus error:", error);
    return errorResponse(
      res,
      error.message || "Failed to update current status",
      STATUS_CODE.ERROR
    );
  }
};

export const setPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  const genericInvalidMessage =
    "Invalid or expired link. If you have already set your password, please log in.";

  try {
    const { token, password } = req.body as {
      token?: string;
      password?: string;
    };

    if (!token || typeof token !== "string") {
      return errorResponse(res, genericInvalidMessage, STATUS_CODE.BAD_REQUEST);
    }

    const trimmedToken = token.trim();
    if (!isValidInviteTokenFormat(trimmedToken)) {
      return errorResponse(res, genericInvalidMessage, STATUS_CODE.BAD_REQUEST);
    }

    if (!password || String(password).length < 8) {
      return errorResponse(
        res,
        "Password must be at least 8 characters",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const hashedToken = hashToken(trimmedToken);
    const doctor = await DoctorModel.findOne({
      inviteToken: hashedToken,
      inviteTokenExpires: { $gt: new Date() },
    }).select("_id email firstName lastName");

    if (!doctor) {
      return errorResponse(res, genericInvalidMessage, STATUS_CODE.BAD_REQUEST);
    }

    const existingUser = await UserModel.findOne({
      email: doctor.email,
    }).select("_id");
    if (existingUser) {
      return errorResponse(res, genericInvalidMessage, STATUS_CODE.BAD_REQUEST);
    }

    const hashedPassword = await hashPassword(String(password));
    await UserModel.create({
      name: `${doctor.firstName} ${doctor.lastName}`,
      email: doctor.email,
      password: hashedPassword,
      role_id: ROLE.DOCTOR,
      doctorId: doctor._id,
      unique_id: generateUniqueAlphaNumericId(),
      is_active: true,
      status: 1,
    });

    await DoctorModel.findByIdAndUpdate(doctor._id, {
      $unset: { inviteToken: "", inviteTokenExpires: "", inviteSentAt: "" },
    });

    return successResponse(res, null, "Password set. You can now log in.");
  } catch (error: any) {
    console.error("setPassword error:", error?.message ?? error);
    return errorResponse(
      res,
      "Unable to complete request. Please try again.",
      STATUS_CODE.ERROR
    );
  }
};

export const resendInvite = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const doctor = await DoctorModel.findById(id).select(
      "+inviteToken +inviteTokenExpires email firstName lastName"
    );
    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const existingUser = await UserModel.findOne({
      email: doctor.email,
    }).select("_id");
    if (existingUser) {
      return errorResponse(
        res,
        "User already exists for this doctor. No invite needed.",
        STATUS_CODE.CONFLICT
      );
    }

    const plainToken = generateInviteToken();
    const hashedToken = hashToken(plainToken);
    const inviteTokenExpires = new Date(
      Date.now() + DOCTOR_INVITE_EXPIRY_MINUTES * 60 * 1000
    );

    await DoctorModel.findByIdAndUpdate(id, {
      inviteToken: hashedToken,
      inviteTokenExpires,
      inviteSentAt: new Date(),
    });

    await sendDoctorInviteEmail({
      to: doctor.email,
      doctorName: `${doctor.firstName} ${doctor.lastName}`,
      inviteToken: plainToken,
      expiryMinutes: Math.floor(DOCTOR_INVITE_EXPIRY_MINUTES / 60),
    });

    return successResponse(res, null, "Invite email sent again.");
  } catch (error: any) {
    console.error("resendInvite error:", error);
    return errorResponse(
      res,
      error.message || "Failed to resend invite",
      STATUS_CODE.ERROR
    );
  }
};

export const getAvailableSlots = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const doctor = await DoctorModel.findById(id)
      .select("availableSlots timeZone")
      .lean();

    if (!doctor) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const availableSlots =
      doctor.availableSlots && doctor.availableSlots.length > 0
        ? doctor.availableSlots
        : [...DEFAULT_AVAILABLE_SLOTS];

    return successResponse(res, {
      availableSlots,
      timeZone: doctor.timeZone || "Asia/Kolkata",
    });
  } catch (error: any) {
    console.error("getAvailableSlots error:", error);
    return errorResponse(
      res,
      error.message || "Failed to get available slots",
      STATUS_CODE.ERROR
    );
  }
};

export const updateAvailableSlots = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const id = getParamId(req);
    const { availableSlots, timeZone } = req.body as {
      availableSlots?: any[];
      timeZone?: string;
    };

    if (!id || !isValidObjectId(id)) {
      return errorResponse(
        res,
        "Valid doctor id is required",
        STATUS_CODE.BAD_REQUEST
      );
    }

    const update: Record<string, unknown> = {
      updated_by: (req as any).user?.id || (req as any).user?._id?.toString?.(),
    };

    if (Array.isArray(availableSlots)) {
      update.availableSlots = availableSlots;
    }
    if (timeZone != null) {
      update.timeZone = String(timeZone).trim() || "Asia/Kolkata";
    }

    const doc = await DoctorModel.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true }
    ).select("availableSlots timeZone");

    if (!doc) {
      return errorResponse(res, "Doctor not found", STATUS_CODE.NOT_FOUND);
    }

    const resultSlots =
      doc.availableSlots && doc.availableSlots.length > 0
        ? doc.availableSlots
        : [...DEFAULT_AVAILABLE_SLOTS];

    return successResponse(
      res,
      { availableSlots: resultSlots, timeZone: doc.timeZone || "Asia/Kolkata" },
      "Available slots updated"
    );
  } catch (error: any) {
    console.error("updateAvailableSlots error:", error);
    return errorResponse(
      res,
      error.message || "Failed to update available slots",
      STATUS_CODE.ERROR
    );
  }
};
