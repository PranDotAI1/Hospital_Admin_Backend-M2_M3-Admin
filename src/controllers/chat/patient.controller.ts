import { Request, Response } from "express";
import { PatientModel } from "../../models/Patient";
import { UHIDCounterModel } from "../../models/UHIDCounter";
import { STATUS_CODE } from "../../utils/constant";
import { escapeRegex } from "../../utils/sanitizer";

const generateUHID = async (): Promise<string> => {
  const today = new Date();
  const datePrefix = today.toISOString().slice(2, 10).replace(/-/g, "");

  const counter = await UHIDCounterModel.findOneAndUpdate(
    { _id: datePrefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );

  const sequence = counter.seq;
  if (sequence > 999999) {
    throw new Error("Daily UHID limit exceeded");
  }

  return `${datePrefix}${sequence.toString().padStart(6, "0")}`;
};

export const lookupPatient = async (req: Request, res: Response) => {
  try {
    const { mobile, uhid } = req.query;

    if (!mobile && !uhid) {
      return res.status(STATUS_CODE.BAD_REQUEST).json({
        status: "error",
        success: false,
        message: "Either mobile number or UHID is required for patient lookup",
      });
    }

    const orConditions: any[] = [];

    if (mobile) {
      const cleanMobile = String(mobile).replace(/\D/g, "").slice(-10);
      orConditions.push({ mobile: { $regex: cleanMobile } });
    }

    if (uhid) {
      const cleanUhid = escapeRegex(String(uhid).trim());
      orConditions.push({ uhid: { $regex: new RegExp(`^${cleanUhid}$`, "i") } });
    }

    const patient = await PatientModel.findOne({
      $or: orConditions,
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    })
      .select("_id uhid f_name m_name l_name name mobile gender dob age address email")
      .lean();

    if (!patient) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        success: true,
        found: false,
        message: "No existing patient profile found. Please register as a new patient.",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      found: true,
      message: "Patient profile located successfully",
      patient: {
        _id: patient._id,
        uhid: patient.uhid,
        firstName: patient.f_name,
        lastName: patient.l_name || "",
        fullName: patient.name || `${patient.f_name} ${patient.l_name || ""}`.trim(),
        mobile: patient.mobile,
        gender: patient.gender,
        dob: patient.dob,
        age: patient.age,
        address: patient.address,
        email: patient.email,
      },
    });
  } catch (error: any) {
    console.error("[CHAT_PATIENT_LOOKUP_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to lookup patient" : error.message,
    });
  }
};

export const registerPatient = async (req: Request, res: Response) => {
  try {
    const { f_name, l_name, mobile, gender, dob, age, address, email, pincode } = req.body;

    const cleanMobile = String(mobile).replace(/\D/g, "").slice(-10);
    const fullName = `${f_name.trim()} ${(l_name || "").trim()}`.trim();

    const existing = await PatientModel.findOne({
      mobile: cleanMobile,
      f_name: { $regex: new RegExp(`^${escapeRegex(f_name.trim())}$`, "i") },
      isMerged: { $ne: true },
    }).lean();

    if (existing) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        success: true,
        isExisting: true,
        message: "Patient already registered with this mobile and name",
        patient: {
          _id: existing._id,
          uhid: existing.uhid,
          fullName: existing.name || fullName,
          mobile: existing.mobile,
          gender: existing.gender,
          email: existing.email,
        },
      });
    }

    const uhid = await generateUHID();

    const newPatient = await PatientModel.create({
      uhid,
      f_name: f_name.trim(),
      l_name: (l_name || "").trim(),
      name: fullName,
      mobile: cleanMobile,
      gender: gender || "Other",
      dob: dob || undefined,
      age: age ? String(age) : undefined,
      address: address || undefined,
      pincode: pincode || undefined,
      email: email || undefined,
      status: "active",
      createdAt: new Date(),
    });

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      success: true,
      message: "Patient registered successfully",
      patient: {
        _id: newPatient._id,
        uhid: newPatient.uhid,
        fullName: newPatient.name,
        mobile: newPatient.mobile,
        gender: newPatient.gender,
        email: newPatient.email,
        createdAt: newPatient.createdAt,
      },
    });
  } catch (error: any) {
    console.error("[CHAT_PATIENT_REGISTER_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to register patient" : error.message,
    });
  }
};
