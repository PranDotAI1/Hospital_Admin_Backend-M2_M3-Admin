import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { PatientModel, IPatientVisitRef } from "../../models/Patient";
import { ScanShareVisitModel } from "../../models/ScanShareVisit";

import { STATUS_CODE } from "../../utils/constant";
import { CareContextService } from "../../services/carecontext.service";
import { CareContextModel, CareContextStatus } from "../../models/CareContext";
import { VisitPrescriptionModel } from "../../models/VisitPrescription";
import { VisitSoapNotesModel } from "../../models/VisitSoapNotes";
import { VisitLabReportModel } from "../../models/VisitLabReport";
import { VisitDischargeSummaryModel } from "../../models/VisitDischargeSummary";
import { VisitAssessmentModel } from "../../models/VisitAssessment";
import { UHIDCounterModel } from "../../models/UHIDCounter";

import { DepartmentModel } from "../../models/Department";
import { DoctorModel } from "../../models/Doctor";
import { normalizeAbha, formatAbhaForStorage } from "../../utils/common";

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

const isValidMobile = (mobile: string): boolean => {
  return /^[6-9]\d{9}$/.test(mobile);
};

const sanitizeString = (
  value: unknown,
  maxLength: number = 500,
): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const str = typeof value === "string" ? value : String(value);
  return str.trim().slice(0, maxLength);
};

const normalizeNameForMatch = (name: string | undefined): string => {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
};

const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const registerPatient = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const f_name = sanitizeString(body.f_name || body.firstName, 100);
    const mobile = sanitizeString(body.mobile, 15);

    let dob = sanitizeString(body.dob, 20);
    const age = sanitizeString(body.age, 3);

    if (!f_name) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "First name (f_name) is required",
      });
    }

    if (!mobile || !isValidMobile(mobile)) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message:
          "Valid mobile number is required (10 digits starting with 6-9)",
      });
    }

    const abhaNumber = sanitizeString(
      body.abhaNumber || body.ABHANumber || body.abha_number,
      20,
    );
    const abhaAddress = sanitizeString(
      body.abhaAddress ||
        body.abhaaddress ||
        body.abha_id ||
        body.abhaId ||
        body.abha_address,
      100,
    );

    const abhaNumberFormatted = abhaNumber
      ? formatAbhaForStorage(abhaNumber)
      : undefined;
    const m_name = sanitizeString(body.m_name || body.middleName, 100);
    const l_name = sanitizeString(body.l_name || body.lastName, 100);
    const fullName = [f_name, m_name, l_name].filter(Boolean).join(" ");

    const address = sanitizeString(body.address, 500);
    const pincode = sanitizeString(body.pincode, 10);
    const state = sanitizeString(body.state, 50);
    const district = sanitizeString(body.district, 50);

    // 2) If ABHA address matches an existing patient, add a visit to that patient
    //    (only match on abhaAddress, NOT abhaNumber — one person can have multiple ABHA addresses)
    let existingWithAbhaAddress: any = null;
    if (abhaAddress) {
      existingWithAbhaAddress = await PatientModel.findOne({
        abhaaddress: abhaAddress,
        isMerged: { $ne: true },
        status: { $ne: "merged" },
      });
    }

    // Safety: if we found a match by ABHA address, also verify the ABHA numbers match
    //         (compare normalized forms: XX-XXXX-XXXX-XXXX ↔ XXXXXXXXXXXXXX)
    if (
      existingWithAbhaAddress &&
      abhaNumber &&
      existingWithAbhaAddress.ABHANumber
    ) {
      const payloadAbhaNorm = normalizeAbha(abhaNumber);
      const existingAbhaNorm = normalizeAbha(
        existingWithAbhaAddress.ABHANumber,
      );
      if (
        payloadAbhaNorm &&
        existingAbhaNorm &&
        payloadAbhaNorm !== existingAbhaNorm
      ) {
        console.warn(
          `registerPatient: ABHA address match but ABHA number mismatch! ` +
            `Payload=${abhaNumber} vs Existing=${existingWithAbhaAddress.ABHANumber}. Skipping merge.`,
        );
        existingWithAbhaAddress = null; // Don't merge — create new patient instead
      }
    }

    if (abhaAddress && existingWithAbhaAddress) {
      const consultingDoctor = sanitizeString(body.consultingDoctor, 100);
      const dept = sanitizeString(body.department, 100);
      const visitDate = new Date();
      const visitId = new Types.ObjectId();

      const visitInfo: any = {
        visitId,
        visitDate,
        visitStatus: "REGISTERED",
        department: dept,
        doctorName: consultingDoctor,
      };

      if (
        body.consultingDoctorId &&
        Types.ObjectId.isValid(body.consultingDoctorId)
      ) {
        const docId = new Types.ObjectId(body.consultingDoctorId);
        const doc = await DoctorModel.findById(docId).lean();
        if (doc) {
          visitInfo.doctorId = docId;
          visitInfo.doctorName =
            `${doc.firstName || ""} ${doc.lastName || ""}`.trim();
        }
      }
      if (body.departmentId && Types.ObjectId.isValid(body.departmentId)) {
        const deptId = new Types.ObjectId(body.departmentId);
        const deptDoc = await DepartmentModel.findById(deptId).lean();
        if (deptDoc) {
          visitInfo.departmentId = deptId;
          visitInfo.department = deptDoc.name;
        }
      }

      const updatePayload: any = {
        $push: {
          visits: { $each: [visitInfo], $sort: { visitDate: -1 } },
        },
        $inc: { totalVisits: 1 },
        $set: {
          lastVisitDate: visitDate,
        },
      };

      if (consultingDoctor) {
        updatePayload.$set.lastVisitedDoctor = consultingDoctor;
      }

      const updatedPatient = await PatientModel.findByIdAndUpdate(
        existingWithAbhaAddress._id,
        updatePayload,
        { new: true },
      );

      if (!updatedPatient) {
        throw new Error("Failed to update existing ABHA patient");
      }

      return res.status(STATUS_CODE.CREATED).json({
        status: "success",
        message: "Existing patient found by ABHA address; visit added",
        data: {
          uhid: updatedPatient.uhid,
          _id: updatedPatient._id,
          name: updatedPatient.name,
          mobile: updatedPatient.mobile,
          abhaLinked: !!(
            updatedPatient.ABHANumber || updatedPatient.abhaaddress
          ),
          visit: visitInfo,
        },
      });
    }

    // 3) No ABHA address match — always create a new patient
    //    (mobile+name auto-merge has been removed; frontend uses check-existing API instead)
    const uhid = await generateUHID();

    const consultingDoctor = sanitizeString(body.consultingDoctor, 100);
    const department = sanitizeString(body.department, 100);
    const visitDate = new Date();
    const visitId = new Types.ObjectId();

    const visitInfo: any = {
      visitId,
      visitDate,
      visitStatus: "REGISTERED",
      department,
      doctorName: consultingDoctor,
    };

    if (
      body.consultingDoctorId &&
      Types.ObjectId.isValid(body.consultingDoctorId)
    ) {
      const docId = new Types.ObjectId(body.consultingDoctorId);
      const doc = await DoctorModel.findById(docId).lean();
      if (doc) {
        visitInfo.doctorId = docId;
        visitInfo.doctorName =
          `${doc.firstName || ""} ${doc.lastName || ""}`.trim();
      }
    }
    if (body.departmentId && Types.ObjectId.isValid(body.departmentId)) {
      const deptId = new Types.ObjectId(body.departmentId);
      const deptDoc = await DepartmentModel.findById(deptId).lean();
      if (deptDoc) {
        visitInfo.departmentId = deptId;
        visitInfo.department = deptDoc.name;
      }
    }

    const patientRecord = await PatientModel.create({
      uhid,
      f_name,
      m_name,
      l_name,
      name: fullName,
      mobile,
      dob,
      age: age || undefined,
      gender: sanitizeString(body.gender, 10),
      address,
      pincode,
      email: sanitizeString(body.email, 100),
      bloodGroup: sanitizeString(body.bloodGroup, 5),
      emergencyContact: sanitizeString(body.emergencyContact, 15),
      aadhaarNumber: sanitizeString(body.aadhaarNumber, 12),
      ABHANumber: abhaNumberFormatted || abhaNumber || undefined,
      abhaaddress: abhaAddress || undefined,
      abhaLinkedAt: abhaNumber ? new Date() : undefined,
      allergies: sanitizeString(body.allergies, 500),
      existingMedicalConditions: sanitizeString(
        body.existingMedicalConditions,
        500,
      ),
      ongoingMedications: sanitizeString(body.ongoingMedications, 500),
      status: "active",
      totalVisits: 1,
      visits: [visitInfo],
      lastVisitDate: visitDate,
      lastVisitedDoctor: consultingDoctor || undefined,
    });

    if (!patientRecord) {
      throw new Error("Failed to create or retrieve patient record");
    }

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      message: "Patient registered successfully",
      data: {
        uhid: patientRecord.uhid,
        _id: patientRecord._id,
        name: patientRecord.name,
        mobile: patientRecord.mobile,
        abhaLinked: !!patientRecord.ABHANumber,
        visit: visitInfo,
      },
    });
  } catch (error: any) {
    console.error("Patient Registration error:", error);

    if (error.code === 11000) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Duplicate entry detected",
        details: error.keyValue,
      });
    }

    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to register patient",
    });
  }
};

export const linkAbha = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { abhaNumber, abhaAddress, name } = req.body;

    if (!abhaNumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "ABHA number is required",
      });
    }

    if (!abhaAddress) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "ABHA address is required",
      });
    }

    let patient = await PatientModel.findOne({
      uhid: id,
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    });
    if (!patient) {
      patient = await PatientModel.findOne({
        _id: id,
        isMerged: { $ne: true },
        status: { $ne: "merged" },
      });
    }

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (patient.ABHANumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Patient already has ABHA linked",
        existingAbhaNumber: patient.ABHANumber,
      });
    }

    let abdmLinked = false;
    let linkTokenRequested = false;

    try {
      const tokenRequested = await CareContextService.requestLinkToken({
        ...patient.toObject(),
        abhaaddress: abhaAddress,
        name: name || patient.name,
      } as any);

      if (tokenRequested) {
        linkTokenRequested = true;
        abdmLinked = true;
      }
    } catch (abdmError: any) {
      console.error(
        "ABDM link token request error (non-blocking):",
        abdmError.response?.data || abdmError.message,
      );
    }

    const updatedPatient = await PatientModel.findByIdAndUpdate(
      patient._id,
      {
        $set: {
          ABHANumber: abhaNumber,
          abhaaddress: abhaAddress,
          abhaLinkedAt: new Date(),
        },
      },
      { new: true },
    );

    let retroactiveResult = { created: 0, linked: 0, errors: [] as string[] };
    if (updatedPatient && abhaAddress) {
      try {
        const updatedCount =
          await CareContextService.bulkUpdateCareContextsForPatient(
            updatedPatient._id,
            abhaAddress,
          );
        retroactiveResult =
          await CareContextService.createCareContextsForExistingVisits(
            updatedPatient._id,
            abhaAddress,
            false, // Don't link here - we'll link all pending in background
          );
        const pid = updatedPatient._id;
        const abha = abhaAddress;
        setImmediate(async () => {
          try {
            const linkedCount =
              await CareContextService.linkPendingCareContexts(pid);
          } catch (bgErr: any) {
            console.error("linkAbha: Background linking error:", bgErr.message);
          }
        });
      } catch (retroErr: any) {
        console.error(
          "linkAbha: CareContext update error (non-blocking):",
          retroErr.message,
        );
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: abdmLinked
        ? "ABHA linked successfully, link token requested from ABDM"
        : "ABHA linked locally (ABDM link token request pending)",
      data: {
        uhid: updatedPatient?.uhid,
        abhaNumber: updatedPatient?.ABHANumber,
        abhaAddress: updatedPatient?.abhaaddress,
        abhaLinkedAt: updatedPatient?.abhaLinkedAt,
        linkTokenRequested,
        abdmLinked,
        note: "Care contexts are being linked to ABDM in the background",
      },
    });
  } catch (error: any) {
    console.error("Link ABHA error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to link ABHA",
    });
  }
};

export const sendDeepLinkSms = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patient = await PatientModel.findById(id);

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (!patient.mobile) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Patient does not have a mobile number",
      });
    }

    // This is specifically for patients WITHOUT an ABHA address who need to install the app
    if (patient.abhaaddress || patient.ABHANumber) {
      // Optional: We could allow it as a reminder, but the primary use case is "No ABHA"

    }

    const { SmsNotificationService } =
      await import("../../services/sms.notification.service");
    const success = await SmsNotificationService.sendSmsNotify2(patient.mobile);

    if (success) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: "Deep Link SMS (notify2) sent successfully",
      });
    } else {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Failed to send Deep Link SMS",
      });
    }
  } catch (error: any) {
    console.error("Send Deep Link SMS error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to send Deep Link SMS",
    });
  }
};

export const getPatient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    let patient = await PatientModel.findOne({ uhid: id }).lean();
    if (!patient) {
      patient = await PatientModel.findById(id).lean();
    }

    if (patient && ((patient as any).isMerged || patient.status === "merged")) {
      if ((patient as any).mergedToPatient) {
        patient = await PatientModel.findById(
          (patient as any).mergedToPatient,
        ).lean();
      }
    }

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: patient,
    });
  } catch (error: any) {
    console.error("Get Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch patient",
    });
  }
};

export const getAllPatients = async (req: Request, res: Response) => {
  try {
    // RC1: Pagination + compound index (isMerged, status, updatedAt)
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit as string, 10) || 50),
    );
    const skip = (page - 1) * limit;

    const filter = {
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    };

    // Parallel: count + fetch (independent queries, both use the compound index)
    const [patients, total] = await Promise.all([
      PatientModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PatientModel.countDocuments(filter),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      data: { patients, total },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      message: "Patients retrieved successfully",
    });
  } catch (error: any) {
    console.error("Get All Patients error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch all patients",
    });
  }
};

export const listPatients = async (req: Request, res: Response) => {
  try {
    const { mobile, abhaNumber, name, page = 1, limit = 20 } = req.query;

    const query: any = {
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    };

    if (mobile) {
      query.mobile = String(mobile);
    }

    if (abhaNumber) {
      query.ABHANumber = String(abhaNumber);
    }

    if (name) {
      query.name = { $regex: String(name), $options: "i" };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [patients, total] = await Promise.all([
      PatientModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PatientModel.countDocuments(query),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      data: patients,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error: any) {
    console.error("List Patients error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to fetch patients",
    });
  }
};

export const searchPatients = async (req: Request, res: Response) => {
  try {
    const { query, page = 1, limit = 20 } = req.query;

    const filter: any = {
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    };

    if (query && String(query).trim() !== "") {
      const searchVal = String(query).trim();
      const orConditions: any[] = [
        { name: { $regex: searchVal, $options: "i" } },
        { f_name: { $regex: searchVal, $options: "i" } },
        { l_name: { $regex: searchVal, $options: "i" } },
        { mobile: { $regex: searchVal, $options: "i" } },
        { uhid: { $regex: searchVal, $options: "i" } },
        { ABHANumber: { $regex: searchVal, $options: "i" } },
        { abhaaddress: { $regex: searchVal, $options: "i" } },
      ];

      if (mongoose.Types.ObjectId.isValid(searchVal)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(searchVal) });
      }

      filter.$or = orConditions;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [patients, total] = await Promise.all([
      PatientModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PatientModel.countDocuments(filter),
    ]);

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      data: { patients, total },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
      message: `${total} patients found`,
    });
  } catch (error: any) {
    console.error("Search Patients error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to search patients",
    });
  }
};

export const mergeAbhaPatient = async (req: Request, res: Response) => {
  let session: mongoose.ClientSession | undefined;
  try {
    const { uhid, id, abhaNumber, profileDetails } = req.body;

    if ((!uhid && !id) || !abhaNumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Target identifier (uhid or id) and abhaNumber are required",
      });
    }

    const cleanAbha = abhaNumber.replace(/-/g, "");
    const formattedAbha =
      cleanAbha.length === 14
        ? `${cleanAbha.slice(0, 2)}-${cleanAbha.slice(2, 6)}-${cleanAbha.slice(6, 10)}-${cleanAbha.slice(10, 14)}`
        : abhaNumber;

    const searchCriteria: any[] = [
      { ABHANumber: cleanAbha },
      { ABHANumber: formattedAbha },
    ];

    if (profileDetails?.abhaAddress) {
      searchCriteria.push({ abhaaddress: profileDetails.abhaAddress });
    }

    // RC5: Parallelize target + source lookups (independent queries)
    const [targetByUhid, targetById, sourcePatient] = await Promise.all([
      uhid ? PatientModel.findOne({ uhid }) : Promise.resolve(null),
      id ? PatientModel.findById(id) : Promise.resolve(null),
      PatientModel.findOne({ $or: searchCriteria }),
    ]);

    const targetPatient = targetByUhid || targetById;

    if (!targetPatient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Target patient not found",
      });
    }

    const updateData: any = {
      ABHANumber: formattedAbha,
      abhaLinkedAt: new Date(),
    };

    if (profileDetails) {
      if (profileDetails.firstName)
        updateData.f_name = profileDetails.firstName;
      if (profileDetails.middleName)
        updateData.m_name = profileDetails.middleName;
      if (profileDetails.lastName) updateData.l_name = profileDetails.lastName;

      if (profileDetails.name) {
        updateData.name = profileDetails.name;
        if (!profileDetails.firstName) {
          const parts = profileDetails.name.split(" ");
          if (parts.length > 0) updateData.f_name = parts[0];
          if (parts.length > 1) updateData.l_name = parts.slice(1).join(" ");
        }
      }

      if (
        profileDetails.dayOfBirth &&
        profileDetails.monthOfBirth &&
        profileDetails.yearOfBirth
      ) {
        const d = String(profileDetails.dayOfBirth).padStart(2, "0");
        const m = String(profileDetails.monthOfBirth).padStart(2, "0");
        const y = profileDetails.yearOfBirth;
        updateData.dob = `${y}-${m}-${d}`;
      } else if (profileDetails.dob) {
        updateData.dob = profileDetails.dob;
      }

      if (profileDetails.gender) updateData.gender = profileDetails.gender;
      if (profileDetails.mobile) updateData.mobile = profileDetails.mobile;

      if (profileDetails.address) updateData.address = profileDetails.address;
      if (profileDetails.pincode) updateData.pincode = profileDetails.pincode;

      const abhaAddr =
        profileDetails.abhaAddress ?? (profileDetails as any).abha_address;
      if (abhaAddr) {
        updateData.abhaaddress = abhaAddr;
      }
      if (profileDetails.profilePhoto)
        updateData.profilePhoto = profileDetails.profilePhoto;
    }

    let message = "Patient ABHA linked successfully";
    session = await mongoose.startSession();
    session.startTransaction();

    if (
      sourcePatient &&
      sourcePatient._id.toString() !== targetPatient._id.toString()
    ) {
      message = "Linked ABHA successfully (Merged into existing ABHA record)";

      const masterPatient = sourcePatient;
      const victimPatient = targetPatient;

      // Only clear the link token if master's ABHA address is actually changing
      if (
        updateData.abhaaddress &&
        masterPatient.abhaaddress &&
        updateData.abhaaddress !== masterPatient.abhaaddress
      ) {
        updateData.$unset = { ...(updateData.$unset || {}), abdmLinkToken: 1 };
      }

      const safeConcat = (
        masterVal: string | undefined,
        victimVal: string | undefined,
      ) => {
        if (!masterVal) return victimVal;
        if (!victimVal) return masterVal;
        if (masterVal.includes(victimVal)) return masterVal;
        return `${masterVal}, ${victimVal}`;
      };

      // 1. Prepare Update Data for MASTER
      // Merge Arrays/Strings from Victim -> Master
      if (victimPatient.allergies) {
        updateData.allergies = safeConcat(
          masterPatient.allergies,
          victimPatient.allergies,
        );
      }
      if (victimPatient.existingMedicalConditions) {
        updateData.existingMedicalConditions = safeConcat(
          masterPatient.existingMedicalConditions,
          victimPatient.existingMedicalConditions,
        );
      }
      if (victimPatient.ongoingMedications) {
        updateData.ongoingMedications = safeConcat(
          masterPatient.ongoingMedications,
          victimPatient.ongoingMedications,
        );
      }

      // Merge other fields from Victim if missing in Master
      const mergeField = (field: keyof typeof victimPatient) => {
        if (
          [
            "allergies",
            "existingMedicalConditions",
            "ongoingMedications",
          ].includes(field)
        )
          return;
        // Only if master is missing it AND we haven't already set it from profile (in updateData)
        if (
          victimPatient[field] &&
          !updateData[field] &&
          !masterPatient[field]
        ) {
          updateData[field] = victimPatient[field];
        }
      };

      mergeField("mobile");
      mergeField("email");
      mergeField("pincode");
      mergeField("address");
      mergeField("bloodGroup");
      mergeField("emergencyContact");
      mergeField("aadhaarNumber");

      // Append Lists
      if (victimPatient.insurance && victimPatient.insurance.length > 0) {
        updateData.$addToSet = {
          ...(updateData.$addToSet || {}),
          insurance: { $each: victimPatient.insurance },
        };
      }
      // CRITICAL: Move visits from Victim to Master (use $push with $sort to maintain order)
      if (victimPatient.visits && victimPatient.visits.length > 0) {
        if (!updateData.$push) updateData.$push = {};
        updateData.$push.visits = {
          $each: victimPatient.visits,
          $sort: { visitDate: -1 },
        };
      }

      // 2. Capture victim's care context IDs BEFORE reassignment
      const victimCareContextIds = await CareContextModel.find(
        { patientId: victimPatient._id },
        { _id: 1 },
      ).lean();
      const victimCcIds = victimCareContextIds.map((cc: any) => cc._id);

      // Reassign Foreign Keys: VICTIM -> MASTER (OPTIMIZED: Parallel updates)
      const collections = [
        CareContextModel,
        ScanShareVisitModel,
        VisitPrescriptionModel,
        VisitSoapNotesModel,
        VisitLabReportModel,
        VisitDischargeSummaryModel,
        VisitAssessmentModel,
      ];

      // Parallelize all updateMany operations - they're independent
      await Promise.all(
        collections.map((model) =>
          model
            .updateMany(
              { patientId: victimPatient._id },
              { $set: { patientId: masterPatient._id } },
            )
            .catch((err) => {
              console.error(
                `mergeAbhaPatient: Error updating ${model.modelName}:`,
                err.message,
              );
              // Don't throw - continue with other updates
            }),
        ),
      );

      // CRITICAL: Reset care context linking status ONLY for reassigned contexts
      // (ones that were moved from victim to master)
      // Reassigned care contexts might have been LINKED/FAILED for victim's ABHA,
      // so reset to PENDING so they can be linked to master's ABHA in background
      //
      // SAFETY: Only reset care contexts that:
      // 1. Now belong to master (patientId = masterPatient._id) - includes reassigned ones
      // 2. Don't have master's ABHA yet (reassigned ones won't have it)
      // 3. Are NOT already LINKED/NOTIFIED with master's ABHA (protect existing linked ones)
      //
      // We use updateData.abhaaddress (the ABHA that will be set on master) to check.
      // This ensures we DON'T reset care contexts that were already linked to master's ABHA.
      const masterAbhaAddress =
        updateData.abhaaddress || masterPatient.abhaaddress;
      if (masterAbhaAddress) {
        const resetResult = await CareContextModel.updateMany(
          {
            patientId: masterPatient._id,
            $and: [
              {
                $or: [
                  { abhaAddress: { $exists: false } },
                  { abhaAddress: { $ne: masterAbhaAddress } },
                ],
              },
              {
                linkingStatus: {
                  $nin: [CareContextStatus.LINKED, CareContextStatus.NOTIFIED],
                },
              },
            ],
          },
          {
            $set: {
              linkingStatus: CareContextStatus.PENDING,
              linkAttempts: 0,
            },
          },
        );
      }

      // RC5: Parallelize minor collection reassignments (independent writes)
      await Promise.all([
        import("../../models/ExternalHealthRecord")
          .then(({ ExternalHealthRecordModel }) =>
            ExternalHealthRecordModel.updateMany(
              { patientId: victimPatient._id },
              { $set: { patientId: masterPatient._id } },
            ),
          )
          .catch(() => {}),
        import("../../models/LinkOTP")
          .then(({ LinkOTPModel }) =>
            LinkOTPModel.updateMany(
              { patientId: victimPatient._id },
              { $set: { patientId: masterPatient._id } },
            ),
          )
          .catch(() => {}),
      ]);

      // 3. Mark VICTIM as Merged and clear unique abhaaddress so MASTER can take it
      await PatientModel.findByIdAndUpdate(victimPatient._id, {
        $set: {
          status: "merged",
          isMerged: true,
          mergedToPatient: masterPatient._id,
        },
        $unset: {
          abhaaddress: 1,
        },
      });

      // 3b. Clear target abhaaddress from ANY other patient still holding it
      //     (handles ghost/third-party holders missed by the $or lookup)
      if (updateData.abhaaddress) {
        await PatientModel.updateMany(
          {
            abhaaddress: updateData.abhaaddress,
            _id: { $ne: masterPatient._id },
          },
          { $unset: { abhaaddress: 1 } },
        );
      }

      // 4. Update MASTER with new data
      const updatedMaster = await PatientModel.findByIdAndUpdate(
        masterPatient._id,
        updateData,
        { new: true },
      );

      // Commit transaction BEFORE care context operations (care contexts are independent)
      await session.commitTransaction();
      session.endSession();
      session = undefined;

      // 5. Handle ONLY the victim's reassigned care contexts + create missing ones for victim's visits
      let careContextsCreated = 0;
      if (updatedMaster?.abhaaddress) {
        try {
          // STEP 1: Update abhaAddress ONLY on victim's reassigned care contexts
          if (victimCcIds.length > 0) {
            const updatedCount = await CareContextModel.updateMany(
              {
                _id: { $in: victimCcIds },
                linkingStatus: {
                  $nin: [CareContextStatus.LINKED, CareContextStatus.NOTIFIED],
                },
              },
              {
                $set: {
                  abhaAddress: updatedMaster.abhaaddress,
                  patientReference:
                    updatedMaster.uhid || updatedMaster._id.toString(),
                },
              },
            );
          }

          // STEP 2: Create missing care contexts for victim's visits that don't have one yet
          //         (victim's visits were pushed into master, so createCareContextsForExistingVisits
          //          will find visits without a care context and create them)
          const createResult =
            await CareContextService.createCareContextsForExistingVisits(
              updatedMaster._id,
              updatedMaster.abhaaddress,
              false,
            );
          careContextsCreated = createResult.created;
          // STEP 3: Link only the victim's reassigned PENDING care contexts + newly created ones
          //         Do NOT touch master's existing care contexts
          const pendingVictimCcs =
            victimCcIds.length > 0
              ? await CareContextModel.find({
                  _id: { $in: victimCcIds },
                  linkingStatus: CareContextStatus.PENDING,
                  linkAttempts: { $lt: 5 },
                }).lean()
              : [];

          // Also find any newly created care contexts (created just now, no linking yet)
          const newlyCreatedCcs =
            careContextsCreated > 0
              ? await CareContextModel.find({
                  patientId: updatedMaster._id,
                  linkingStatus: CareContextStatus.PENDING,
                  _id: { $nin: victimCcIds },
                  createdAt: { $gte: new Date(Date.now() - 60000) }, // created in last minute
                }).lean()
              : [];

          const ccsToLink = [...pendingVictimCcs, ...newlyCreatedCcs];
          if (ccsToLink.length > 0) {
            const ccIdsToLink = ccsToLink.map((cc: any) => cc._id);
            setImmediate(async () => {
              try {
                const { AbdmTokenService } =
                  await import("../../services/abdm.token.service");
                const abdmToken = await AbdmTokenService.getToken();
                let linked = 0;
                for (const ccId of ccIdsToLink) {
                  const success = await CareContextService.linkCareContext(
                    ccId,
                    abdmToken,
                  );
                  if (success) linked++;
                }
              } catch (bgErr: any) {
                console.error(
                  "mergeAbhaPatient: Background linking error:",
                  bgErr.message,
                );
              }
            });
          } else {
          }
        } catch (ccErr) {
          console.error("Merge: Care context creation error:", ccErr);
        }
      }

      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        message: message,
        data: updatedMaster, // Return MASTER (Old UHID)
        mergedFrom: victimPatient._id,
        careContextsCreated,
        note: "Care contexts are being linked to ABDM in the background",
      });
    }

    // If no merge needed, commit the empty transaction and close session
    await session.commitTransaction();
    session.endSession();
    session = undefined;

    // Only clear the link token if target's ABHA address is actually changing
    if (
      updateData.abhaaddress &&
      targetPatient.abhaaddress &&
      updateData.abhaaddress !== targetPatient.abhaaddress
    ) {
      updateData.$unset = { ...(updateData.$unset || {}), abdmLinkToken: 1 };
    }

    // Clear target abhaaddress from any other patient holding it
    if (updateData.abhaaddress) {
      await PatientModel.updateMany(
        {
          abhaaddress: updateData.abhaaddress,
          _id: { $ne: targetPatient._id },
        },
        { $unset: { abhaaddress: 1 } },
      );
    }

    const updatedTarget = await PatientModel.findByIdAndUpdate(
      targetPatient._id,
      updateData,
      { new: true },
    );

    // OPTIMIZED: Only update/link care contexts that aren't already linked
    let careContextsCreated = 0;
    if (updatedTarget?.abhaaddress) {
      try {
        // STEP 1: Update abhaAddress only on non-linked care contexts
        const updatedCount = await CareContextModel.updateMany(
          {
            patientId: updatedTarget._id,
            linkingStatus: {
              $nin: [CareContextStatus.LINKED, CareContextStatus.NOTIFIED],
            },
            $or: [
              { abhaAddress: { $exists: false } },
              { abhaAddress: { $ne: updatedTarget.abhaaddress } },
            ],
          },
          {
            $set: {
              abhaAddress: updatedTarget.abhaaddress,
              patientReference:
                updatedTarget.uhid || updatedTarget._id.toString(),
            },
          },
        );
        // STEP 2: Create missing care contexts WITHOUT linking
        const createResult =
          await CareContextService.createCareContextsForExistingVisits(
            updatedTarget._id,
            updatedTarget.abhaaddress,
            false,
          );
        careContextsCreated = createResult.created;
        // STEP 3: Link only PENDING care contexts in background
        const pid = updatedTarget._id;
        setImmediate(async () => {
          try {
            const linkedCount =
              await CareContextService.linkPendingCareContexts(pid);
          } catch (bgErr: any) {
            console.error(
              "mergeAbhaPatient: Background linking error:",
              bgErr.message,
            );
          }
        });
      } catch (ccErr) {
        console.error(
          "mergeAbhaPatient: Care context creation error (non-blocking):",
          ccErr,
        );
      }
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: message,
      data: updatedTarget,
      mergedFrom: sourcePatient?._id,
      careContextsCreated,
      note: "Care contexts are being linked to ABDM in the background",
    });
  } catch (error: any) {
    try {
      if (session?.inTransaction()) {
        await session.abortTransaction();
      }
      session?.endSession();
    } catch (e) {
      // Session already ended or invalid
    }
    console.error("Merge Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to merge patient records",
    });
  }
};

export const addVisit = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = req.body;

    let patient: any = await PatientModel.findOne({ uhid: id }).lean();
    if (!patient) {
      if (Types.ObjectId.isValid(id)) {
        patient = await PatientModel.findById(id).lean();
      }
    }

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (patient.isMerged || patient.status === "merged") {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Cannot add visit to a merged patient record",
      });
    }

    const visitType = sanitizeString(body.visitType, 100);
    const description = sanitizeString(body.description, 1000);

    let departmentId: Types.ObjectId | undefined;
    let departmentName: string | undefined;
    let doctorId: Types.ObjectId | undefined;
    let doctorName: string | undefined;

    // 1. Resolve Department
    const rawDept = body.departmentId || body.department;
    if (rawDept) {
      if (Types.ObjectId.isValid(rawDept)) {
        departmentId = new Types.ObjectId(rawDept);
        const deptDoc = await DepartmentModel.findById(departmentId).lean();
        departmentName = deptDoc?.name;
      } else {
        departmentName = sanitizeString(rawDept, 100);
      }
    }

    // 2. Resolve Doctor
    const rawDoc =
      body.doctorId ||
      body.doctorName ||
      body.consultingDoctorId ||
      body.consultingDoctor;
    if (rawDoc) {
      if (Types.ObjectId.isValid(rawDoc)) {
        doctorId = new Types.ObjectId(rawDoc);
        const doc = await DoctorModel.findById(doctorId).lean();
        doctorName = doc
          ? `${doc.firstName || ""} ${doc.lastName || ""}`.trim()
          : undefined;
      } else {
        doctorName = sanitizeString(rawDoc, 100);
      }
    }

    const visitDate = new Date();
    const visitId = new Types.ObjectId();

    const visitInfo: IPatientVisitRef = {
      visitId,
      visitDate,
      visitStatus: "REGISTERED",
      department: departmentName,
      departmentId: departmentId,
      doctorName: doctorName,
      doctorId: doctorId,
      visitType,
      description,
    };

    const updatePayload: any = {
      $push: {
        visits: { $each: [visitInfo], $sort: { visitDate: -1 } },
      },
      $inc: { totalVisits: 1 },
      $set: {
        lastVisitDate: visitDate,
      },
    };

    if (doctorName) {
      updatePayload.$set.lastVisitedDoctor = doctorName;
    }

    const updatedPatient = await PatientModel.findByIdAndUpdate(
      patient._id,
      updatePayload,
      { new: true },
    );

    if (!updatedPatient) {
      throw new Error("Failed to update patient with new visit");
    }

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      message: "Visit added successfully",
      data: {
        uhid: updatedPatient.uhid,
        _id: updatedPatient._id,
        name: updatedPatient.name,
        mobile: updatedPatient.mobile,
        visit: visitInfo,
        patientData: updatedPatient,
      },
    });
  } catch (error: any) {
    console.error("Add Visit error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to add visit",
    });
  }
};

export const checkAbhaNumber = async (req: Request, res: Response) => {
  try {
    const { abhaNumber, mobile } = req.body;

    if (!abhaNumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "abhaNumber is required",
      });
    }

    const normalizedAbha = normalizeAbha(abhaNumber);
    const formattedAbha = formatAbhaForStorage(abhaNumber);

    const patient = await PatientModel.findOne({
      $or: [
        { ABHANumber: abhaNumber },
        ...(normalizedAbha && normalizedAbha !== abhaNumber
          ? [{ ABHANumber: normalizedAbha }]
          : []),
        ...(formattedAbha && formattedAbha !== abhaNumber
          ? [{ ABHANumber: formattedAbha }]
          : []),
      ],
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    }).lean();

    if (!patient) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        exists: false,
        message: "ABHA number not found",
      });
    }

    if (mobile && patient.mobile !== mobile) {
      return res.status(STATUS_CODE.SUCCESS).json({
        status: "success",
        exists: true,
        mobile: patient.mobile,
        mobileMatch: false,
        message: "The mobile number is different",
      });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      exists: true,
      mobileMatch: mobile ? true : undefined,
      message: "ABHA number exists",
      data: {
        uhid: patient.uhid,
        _id: patient._id,
        name: patient.name,
        mobile: patient.mobile,
        abhaLinked: !!(patient.ABHANumber || patient.abhaaddress),
      },
    });
  } catch (error: any) {
    console.error("Check ABHA Number error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to check ABHA number",
    });
  }
};

export const checkExistingPatients = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const mobile = sanitizeString(body.mobile, 15);
    const abhaNumber = sanitizeString(
      body.abhaNumber || body.ABHANumber || body.abha_number,
      20,
    );
    const abhaAddress = sanitizeString(
      body.abhaAddress ||
        body.abhaaddress ||
        body.abha_id ||
        body.abhaId ||
        body.abha_address,
      100,
    );

    if (!mobile && !abhaNumber && !abhaAddress) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message:
          "At least one of mobile, abhaNumber, or abhaAddress is required",
      });
    }

    const orConditions: any[] = [];

    if (mobile) {
      orConditions.push({ mobile });
    }

    if (abhaNumber) {
      const rawNorm = normalizeAbha(abhaNumber);
      const formatted = formatAbhaForStorage(abhaNumber);
      orConditions.push({ ABHANumber: abhaNumber });
      if (rawNorm && rawNorm !== abhaNumber) {
        orConditions.push({ ABHANumber: rawNorm });
      }
      if (formatted && formatted !== abhaNumber && formatted !== rawNorm) {
        orConditions.push({ ABHANumber: formatted });
      }
    }

    if (abhaAddress) {
      orConditions.push({ abhaaddress: abhaAddress });
    }

    const existingPatients = await PatientModel.find({
      $or: orConditions,
      isMerged: { $ne: true },
      status: { $ne: "merged" },
    })
      .select(
        "_id uhid f_name m_name l_name name mobile ABHANumber abhaaddress gender dob age address pincode totalVisits lastVisitDate createdAt allergies existingMedicalConditions ongoingMedications email bloodGroup emergencyContact aadhaarNumber insurance",
      )
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: `${existingPatients.length} existing patient(s) found`,
      data: existingPatients,
    });
  } catch (error: any) {
    console.error("Check Existing Patients error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to check existing patients",
    });
  }
};

export const updatePatient = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = req.body;

    let patient: any = await PatientModel.findOne({ uhid: id });
    if (!patient) {
      if (Types.ObjectId.isValid(id)) {
        patient = await PatientModel.findById(id);
      }
    }

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (patient.isMerged || patient.status === "merged") {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Cannot update a merged patient record",
      });
    }

    // --- Build $set for patient profile updates ---
    const setFields: any = {};

    const f_name = sanitizeString(body.f_name || body.firstName, 100);
    const m_name = sanitizeString(body.m_name || body.middleName, 100);
    const l_name = sanitizeString(body.l_name || body.lastName, 100);
    if (f_name) setFields.f_name = f_name;
    if (m_name !== undefined) setFields.m_name = m_name;
    if (l_name !== undefined) setFields.l_name = l_name;

    // Recompute full name if any name part is provided
    if (f_name || m_name || l_name) {
      const newFName = f_name || patient.f_name;
      const newMName = m_name !== undefined ? m_name : patient.m_name;
      const newLName = l_name !== undefined ? l_name : patient.l_name;
      setFields.name = [newFName, newMName, newLName].filter(Boolean).join(" ");
    }

    const mobile = sanitizeString(body.mobile, 15);
    if (mobile) setFields.mobile = mobile;

    const dob = sanitizeString(body.dob, 20);
    if (dob) setFields.dob = dob;

    const age = sanitizeString(body.age, 3);
    if (age) setFields.age = age;

    const gender = sanitizeString(body.gender, 10);
    if (gender) setFields.gender = gender;

    const address = sanitizeString(body.address, 500);
    if (address) setFields.address = address;

    const pincode = sanitizeString(body.pincode, 10);
    if (pincode) setFields.pincode = pincode;

    const email = sanitizeString(body.email, 100);
    if (email) setFields.email = email;

    const bloodGroup = sanitizeString(body.bloodGroup, 5);
    if (bloodGroup) setFields.bloodGroup = bloodGroup;

    const emergencyContact = sanitizeString(body.emergencyContact, 15);
    if (emergencyContact) setFields.emergencyContact = emergencyContact;

    const aadhaarNumber = sanitizeString(body.aadhaarNumber, 12);
    if (aadhaarNumber) setFields.aadhaarNumber = aadhaarNumber;

    const allergies = sanitizeString(body.allergies, 500);
    if (allergies) setFields.allergies = allergies;

    const existingMedicalConditions = sanitizeString(
      body.existingMedicalConditions,
      500,
    );
    if (existingMedicalConditions)
      setFields.existingMedicalConditions = existingMedicalConditions;

    const ongoingMedications = sanitizeString(body.ongoingMedications, 500);
    if (ongoingMedications) setFields.ongoingMedications = ongoingMedications;

    const updatePayload: any = {
      $set: setFields,
    };

    // Handle insurance update if provided
    if (body.insurance && typeof body.insurance === "object") {
      const provider = sanitizeString(body.insurance.provider, 100);
      const policyNumber = sanitizeString(body.insurance.policyNumber, 50);
      if (provider || policyNumber) {
        updatePayload.$push = {
          insurance: {
            provider: provider || "",
            policyNumber: policyNumber || "",
            addedOn: new Date(),
          },
        };
      }
    }

    const updatedPatient = await PatientModel.findByIdAndUpdate(
      patient._id,
      updatePayload,
      { new: true },
    );

    if (!updatedPatient) {
      throw new Error("Failed to update patient");
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: "Patient profile updated successfully",
      data: {
        uhid: updatedPatient.uhid,
        _id: updatedPatient._id,
        name: updatedPatient.name,
        mobile: updatedPatient.mobile,
        abhaLinked: !!(updatedPatient.ABHANumber || updatedPatient.abhaaddress),
        patientData: updatedPatient,
      },
    });
  } catch (error: any) {
    console.error("Update Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to update patient",
    });
  }
};

export const updatePatientAndAddVisit = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = req.body;

    let patient: any = await PatientModel.findOne({ uhid: id });
    if (!patient) {
      if (Types.ObjectId.isValid(id)) {
        patient = await PatientModel.findById(id);
      }
    }

    if (!patient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Patient not found",
      });
    }

    if (patient.isMerged || patient.status === "merged") {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Cannot update a merged patient record",
      });
    }

    // --- Build $set for patient profile updates ---
    const setFields: any = {};

    const f_name = sanitizeString(body.f_name || body.firstName, 100);
    const m_name = sanitizeString(body.m_name || body.middleName, 100);
    const l_name = sanitizeString(body.l_name || body.lastName, 100);
    if (f_name) setFields.f_name = f_name;
    if (m_name !== undefined) setFields.m_name = m_name;
    if (l_name !== undefined) setFields.l_name = l_name;

    // Recompute full name if any name part is provided
    if (f_name || m_name || l_name) {
      const newFName = f_name || patient.f_name;
      const newMName = m_name !== undefined ? m_name : patient.m_name;
      const newLName = l_name !== undefined ? l_name : patient.l_name;
      setFields.name = [newFName, newMName, newLName].filter(Boolean).join(" ");
    }

    const mobile = sanitizeString(body.mobile, 15);
    if (mobile) setFields.mobile = mobile;

    const dob = sanitizeString(body.dob, 20);
    if (dob) setFields.dob = dob;

    const age = sanitizeString(body.age, 3);
    if (age) setFields.age = age;

    const gender = sanitizeString(body.gender, 10);
    if (gender) setFields.gender = gender;

    const address = sanitizeString(body.address, 500);
    if (address) setFields.address = address;

    const pincode = sanitizeString(body.pincode, 10);
    if (pincode) setFields.pincode = pincode;

    const email = sanitizeString(body.email, 100);
    if (email) setFields.email = email;

    const bloodGroup = sanitizeString(body.bloodGroup, 5);
    if (bloodGroup) setFields.bloodGroup = bloodGroup;

    const emergencyContact = sanitizeString(body.emergencyContact, 15);
    if (emergencyContact) setFields.emergencyContact = emergencyContact;

    const aadhaarNumber = sanitizeString(body.aadhaarNumber, 12);
    if (aadhaarNumber) setFields.aadhaarNumber = aadhaarNumber;

    const allergies = sanitizeString(body.allergies, 500);
    if (allergies) setFields.allergies = allergies;

    const existingMedicalConditions = sanitizeString(
      body.existingMedicalConditions,
      500,
    );
    if (existingMedicalConditions)
      setFields.existingMedicalConditions = existingMedicalConditions;

    const ongoingMedications = sanitizeString(body.ongoingMedications, 500);
    if (ongoingMedications) setFields.ongoingMedications = ongoingMedications;

    // --- Resolve department & doctor for the new visit ---
    let departmentId: Types.ObjectId | undefined;
    let departmentName: string | undefined;
    let doctorId: Types.ObjectId | undefined;
    let doctorName: string | undefined;

    const rawDept = body.departmentId || body.department;
    if (rawDept) {
      if (Types.ObjectId.isValid(rawDept)) {
        departmentId = new Types.ObjectId(rawDept);
        const deptDoc = await DepartmentModel.findById(departmentId).lean();
        departmentName = deptDoc?.name;
      } else {
        departmentName = sanitizeString(rawDept, 100);
      }
    }

    const rawDoc =
      body.doctorId ||
      body.doctorName ||
      body.consultingDoctorId ||
      body.consultingDoctor;
    if (rawDoc) {
      if (Types.ObjectId.isValid(rawDoc)) {
        doctorId = new Types.ObjectId(rawDoc);
        const doc = await DoctorModel.findById(doctorId).lean();
        doctorName = doc
          ? `${doc.firstName || ""} ${doc.lastName || ""}`.trim()
          : undefined;
      } else {
        doctorName = sanitizeString(rawDoc, 100);
      }
    }

    const consultationFee = body.consultationFee
      ? Number(body.consultationFee)
      : undefined;

    const visitDate = new Date();
    const visitId = new Types.ObjectId();

    const visitInfo: IPatientVisitRef = {
      visitId,
      visitDate,
      visitStatus: "REGISTERED",
      department: departmentName,
      departmentId,
      doctorName,
      doctorId,
      consultationFee:
        consultationFee !== undefined && !isNaN(consultationFee)
          ? consultationFee
          : undefined,
      visitType: sanitizeString(body.visitType, 100),
      description: sanitizeString(body.description, 1000),
    };

    // Set visit-related fields
    setFields.lastVisitDate = visitDate;
    if (doctorName) setFields.lastVisitedDoctor = doctorName;

    const updatePayload: any = {
      $set: setFields,
      $push: {
        visits: { $each: [visitInfo], $sort: { visitDate: -1 } },
      },
      $inc: { totalVisits: 1 },
    };

    // Handle insurance update if provided
    if (body.insurance && typeof body.insurance === "object") {
      const provider = sanitizeString(body.insurance.provider, 100);
      const policyNumber = sanitizeString(body.insurance.policyNumber, 50);
      if (provider || policyNumber) {
        updatePayload.$push.insurance = {
          provider: provider || "",
          policyNumber: policyNumber || "",
          addedOn: new Date(),
        };
      }
    }

    const updatedPatient = await PatientModel.findByIdAndUpdate(
      patient._id,
      updatePayload,
      { new: true },
    );

    if (!updatedPatient) {
      throw new Error("Failed to update patient and add visit");
    }

    return res.status(STATUS_CODE.CREATED).json({
      status: "success",
      message: "Patient updated and new visit created",
      data: {
        uhid: updatedPatient.uhid,
        _id: updatedPatient._id,
        name: updatedPatient.name,
        mobile: updatedPatient.mobile,
        abhaLinked: !!(updatedPatient.ABHANumber || updatedPatient.abhaaddress),
        visit: visitInfo,
        patientData: updatedPatient,
      },
    });
  } catch (error: any) {
    console.error("Update Patient and Add Visit error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to update patient and add visit",
    });
  }
};
