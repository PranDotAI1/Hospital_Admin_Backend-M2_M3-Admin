import { Request, Response } from "express";
import { Types } from "mongoose";
import { PatientModel } from "../../models/Patient";
import { ScanShareVisitModel } from "../../models/ScanShareVisit";
import { STATUS_CODE } from "../../utils/constant";
import { CareContextService } from "../../services/carecontext.service";
import { CareContextModel } from "../../models/CareContext";

const generateUHID = async (): Promise<string> => {
  const today = new Date();
  const datePrefix = today.toISOString().slice(2, 10).replace(/-/g, "");

  const lastPatient = await PatientModel.findOne({
    uhid: { $regex: `^${datePrefix}` },
  }).sort({ uhid: -1 });

  let sequence = 1;
  if (lastPatient && lastPatient.uhid) {
    const lastSeq = parseInt(lastPatient.uhid.slice(6), 10);
    sequence = lastSeq + 1;
  }

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

const normalizeAbha = (value: string | undefined): string => {
  if (!value || typeof value !== "string") return "";
  return value.replace(/-/g, "").trim();
};

const formatAbhaForStorage = (
  value: string | undefined,
): string | undefined => {
  if (!value || typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "").trim();
  if (digits.length !== 14) return value.trim();
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}-${digits.slice(10, 14)}`;
};

const normalizeNameForMatch = (name: string | undefined): string => {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
};

export const registerPatient = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    console.log("Register Payload Keys:", Object.keys(body));

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

    console.log("Register ABHA extracted:", {
      abhaNumber: abhaNumber || "(empty)",
      abhaAddress: abhaAddress || "(empty)",
      abhaNumberFormatted: abhaNumberFormatted || "(empty)",
      bodyKeys: Object.keys(body).filter((k: string) => /abha|ABHA/.test(k)),
    });

    const m_name = sanitizeString(body.m_name || body.middleName, 100);
    const l_name = sanitizeString(body.l_name || body.lastName, 100);
    const fullName = [f_name, m_name, l_name].filter(Boolean).join(" ");

    const address = sanitizeString(body.address, 500);
    const pincode = sanitizeString(body.pincode, 10);
    const state = sanitizeString(body.state, 50);
    const district = sanitizeString(body.district, 50);

    const hasAbha = !!(abhaNumber || abhaAddress);

    const abhaMatchConditions: any[] = [];
    if (abhaNumber) {
      const requestAbhaNorm = normalizeAbha(abhaNumber);
      abhaMatchConditions.push(
        { ABHANumber: abhaNumber },
        { ABHANumber: requestAbhaNorm },
      );
      if (abhaNumberFormatted && abhaNumberFormatted !== abhaNumber) {
        abhaMatchConditions.push({ ABHANumber: abhaNumberFormatted });
      }
    }
    if (abhaAddress) {
      abhaMatchConditions.push({ abhaaddress: abhaAddress });
    }

    let existingWithAbha: any = null;
    if (abhaMatchConditions.length > 0) {
      existingWithAbha = await PatientModel.findOne({
        $or: abhaMatchConditions,
      });
    }

    // 2) If ABHA already belongs to a patient, just add a new visit there
    //    (do NOT create a duplicate, do NOT block with an error).
    if (hasAbha && existingWithAbha) {
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
        visitInfo.doctorId = new Types.ObjectId(body.consultingDoctorId);
      }
      if (body.departmentId && Types.ObjectId.isValid(body.departmentId)) {
        visitInfo.departmentId = new Types.ObjectId(body.departmentId);
      }

      const updatePayload: any = {
        $push: {
          visits: { $each: [visitInfo], $position: 0 },
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
        existingWithAbha._id,
        updatePayload,
        { new: true },
      );

      if (!updatedPatient) {
        throw new Error("Failed to update existing ABHA patient");
      }

      let careContextCreated = false;
      try {
        const careContext = await CareContextService.createCareContextForVisit(
          updatedPatient._id,
          visitId,
          ["OPConsultation"],
        );
        if (careContext) {
          careContextCreated = true;
          console.log(
            "CareContext created for existing ABHA patient visit:",
            careContext.careContextReference,
          );
        }
      } catch (ccError) {
        console.error(
          "CareContext creation error (ABHA existing patient, non-blocking):",
          ccError,
        );
      }

      return res.status(STATUS_CODE.CREATED).json({
        status: "success",
        message: "Existing patient found by ABHA; visit added",
        data: {
          uhid: updatedPatient.uhid,
          _id: updatedPatient._id,
          name: updatedPatient.name,
          mobile: updatedPatient.mobile,
          abhaLinked: !!(
            updatedPatient.ABHANumber || updatedPatient.abhaaddress
          ),
          visit: visitInfo,
          careContextCreated,
        },
      });
    }

    // 3) Payload with NO ABHA: check mobile + name. If matches existing record,
    //    add new visit to that record (merge). Else create new.
    if (!hasAbha && mobile) {
      const candidatesSameMobile = await PatientModel.find({ mobile }).lean();
      const payloadNameNorm = normalizeNameForMatch(fullName);
      const existingByMobileAndName = candidatesSameMobile.find((p: any) => {
        const dbNameNorm = normalizeNameForMatch(
          p.name || [p.f_name, p.m_name, p.l_name].filter(Boolean).join(" "),
        );
        return dbNameNorm && payloadNameNorm && dbNameNorm === payloadNameNorm;
      });

      if (existingByMobileAndName) {
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
          visitInfo.doctorId = new Types.ObjectId(body.consultingDoctorId);
        }
        if (body.departmentId && Types.ObjectId.isValid(body.departmentId)) {
          visitInfo.departmentId = new Types.ObjectId(body.departmentId);
        }

        const updatePayload: any = {
          $push: {
            visits: { $each: [visitInfo], $position: 0 },
          },
          $inc: { totalVisits: 1 },
          $set: { lastVisitDate: visitDate },
        };

        if (consultingDoctor) {
          updatePayload.$set.lastVisitedDoctor = consultingDoctor;
        }

        const updatedPatient = await PatientModel.findByIdAndUpdate(
          existingByMobileAndName._id,
          updatePayload,
          { new: true },
        );

        if (!updatedPatient) {
          throw new Error("Failed to add visit to existing patient");
        }

        let careContextCreated = false;
        try {
          const careContext =
            await CareContextService.createCareContextForVisit(
              updatedPatient._id,
              visitId,
              ["OPConsultation"],
            );
          if (careContext) {
            careContextCreated = true;
            console.log(
              "CareContext created for existing patient (no ABHA) visit:",
              careContext.careContextReference,
            );
          }
        } catch (ccError) {
          console.error("CareContext creation error (non-blocking):", ccError);
        }

        return res.status(STATUS_CODE.CREATED).json({
          status: "success",
          message: "Existing patient found by mobile and name; visit added",
          data: {
            uhid: updatedPatient.uhid,
            _id: updatedPatient._id,
            name: updatedPatient.name,
            mobile: updatedPatient.mobile,
            abhaLinked: !!(
              updatedPatient.ABHANumber || updatedPatient.abhaaddress
            ),
            visit: visitInfo,
            careContextCreated,
          },
        });
      }
    }

    // 4) No suitable existing patient – create a new one
    const uhid = await generateUHID();

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
      totalVisits: 0,
      visits: [],
    });

    if (!patientRecord) {
      throw new Error("Failed to create or retrieve patient record");
    }

    let visitInfo: any = null;
    const consultingDoctor = sanitizeString(body.consultingDoctor, 100);
    const department = sanitizeString(body.department, 100);

    console.log("Visit Creation: Triggered (Unconditional)", {
      consultingDoctor,
      department,
    });
    const visitDate = new Date();
    const visitId = new Types.ObjectId();

    visitInfo = {
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
      visitInfo.doctorId = new Types.ObjectId(body.consultingDoctorId);
    }
    if (body.departmentId && Types.ObjectId.isValid(body.departmentId)) {
      visitInfo.departmentId = new Types.ObjectId(body.departmentId);
    }

    console.log("Visit Info:", visitInfo);

    const updateQuery: any = {
      $push: {
        visits: { $each: [visitInfo], $position: 0 },
      },
      $inc: { totalVisits: 1 },
      $set: { lastVisitDate: visitDate },
    };

    if (consultingDoctor) {
      updateQuery.$set.lastVisitedDoctor = consultingDoctor;
    }

    const updateResult = await PatientModel.findByIdAndUpdate(
      patientRecord._id,
      updateQuery,
      { new: true },
    );

    console.log(
      "Visit Update Result (counts):",
      updateResult?.visits?.length,
      "Total:",
      updateResult?.totalVisits,
    );

    let careContextCreated = false;
    if (visitInfo?.visitId) {
      try {
        const careContext = await CareContextService.createCareContextForVisit(
          patientRecord._id,
          visitInfo.visitId,
          ["OPConsultation"],
        );
        if (careContext) {
          careContextCreated = true;
          console.log(
            "CareContext created for visit:",
            careContext.careContextReference,
          );
        }
      } catch (ccError) {
        console.error("CareContext creation error (non-blocking):", ccError);
      }
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
        careContextCreated,
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

    let patient = await PatientModel.findOne({ uhid: id });
    if (!patient) {
      patient = await PatientModel.findById(id);
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

    const existingAbhaPatient = await PatientModel.findOne({
      ABHANumber: abhaNumber,
    });
    if (existingAbhaPatient) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "This ABHA number is already linked to another patient",
        existingUhid: existingAbhaPatient.uhid,
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
        retroactiveResult =
          await CareContextService.createCareContextsForExistingVisits(
            updatedPatient._id,
            abhaAddress,
            true,
          );
        console.log(
          `linkAbha: Created ${retroactiveResult.created} CareContexts for existing visits`,
        );
      } catch (retroErr: any) {
        console.error(
          "linkAbha: Retroactive CareContext creation error (non-blocking):",
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
        retroactiveCareContexts: {
          created: retroactiveResult.created,
          linked: retroactiveResult.linked,
          errors:
            retroactiveResult.errors.length > 0
              ? retroactiveResult.errors
              : undefined,
        },
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

export const getPatient = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    let patient = await PatientModel.findOne({ uhid: id }).lean();
    if (!patient) {
      patient = await PatientModel.findById(id).lean();
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
    const patients = await PatientModel.find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const data = patients.map((p: any) => {
      const visits = Array.isArray(p.visits)
        ? [...p.visits].sort((a: any, b: any) => {
            const da = a.visitDate ? new Date(a.visitDate).getTime() : 0;
            const db = b.visitDate ? new Date(b.visitDate).getTime() : 0;
            return db - da;
          })
        : [];

      return {
        ...p,
        visits,
      };
    });

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      success: true,
      data: { patients: data, total: patients.length },
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

    const query: any = {};

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

export const mergeAbhaPatient = async (req: Request, res: Response) => {
  try {
    const { uhid, id, abhaNumber, profileDetails } = req.body;

    if ((!uhid && !id) || !abhaNumber) {
      return res.status(STATUS_CODE.ERROR).json({
        status: "error",
        message: "Target identifier (uhid or id) and abhaNumber are required",
      });
    }

    let targetPatient;
    if (uhid) {
      targetPatient = await PatientModel.findOne({ uhid });
    }
    if (!targetPatient && id) {
      targetPatient = await PatientModel.findById(id);
    }

    if (!targetPatient) {
      return res.status(STATUS_CODE.NOT_FOUND).json({
        status: "error",
        message: "Target patient not found",
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

    console.log(
      "Searching Duplicate Source with criteria:",
      JSON.stringify(searchCriteria),
    );

    const sourcePatient = await PatientModel.findOne({
      $or: searchCriteria,
    });

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
      if (abhaAddr) updateData.abhaaddress = abhaAddr;
      if (profileDetails.profilePhoto)
        updateData.profilePhoto = profileDetails.profilePhoto;
    }

    let message = "Patient ABHA linked successfully";

    console.log("Merge Debug (Before if):", {
      targetId: targetPatient?._id,
      sourceId: sourcePatient?._id,
    });

    if (
      sourcePatient &&
      sourcePatient._id.toString() !== targetPatient._id.toString()
    ) {
      console.log("Merge Debug: ENTERING MERGE BLOCK - Duplicate found");
      message = "Linked ABHA successfully";

      const safeConcat = (
        targetVal: string | undefined,
        sourceVal: string | undefined,
      ) => {
        if (!targetVal) return sourceVal;
        if (!sourceVal) return targetVal;
        if (targetVal.includes(sourceVal)) return targetVal;
        return `${targetVal}, ${sourceVal}`;
      };

      if (sourcePatient.allergies) {
        updateData.allergies = safeConcat(
          targetPatient.allergies,
          sourcePatient.allergies,
        );
      }
      if (sourcePatient.existingMedicalConditions) {
        updateData.existingMedicalConditions = safeConcat(
          targetPatient.existingMedicalConditions,
          sourcePatient.existingMedicalConditions,
        );
      }
      if (sourcePatient.ongoingMedications) {
        updateData.ongoingMedications = safeConcat(
          targetPatient.ongoingMedications,
          sourcePatient.ongoingMedications,
        );
      }

      const mergeField = (field: keyof typeof sourcePatient) => {
        if (
          [
            "allergies",
            "existingMedicalConditions",
            "ongoingMedications",
          ].includes(field)
        )
          return;

        if (sourcePatient[field] && !updateData[field]) {
          updateData[field] = sourcePatient[field];
        }
      };

      mergeField("f_name");
      mergeField("l_name");
      mergeField("mobile");
      mergeField("dob");
      mergeField("gender");
      mergeField("address");
      mergeField("pincode");
      mergeField("aadhaarNumber");
      mergeField("email");
      mergeField("bloodGroup");
      mergeField("emergencyContact");
      mergeField("lastVisitedDoctor");

      if (sourcePatient.abhaaddress && !updateData.abhaaddress)
        updateData.abhaaddress = sourcePatient.abhaaddress;

      if (sourcePatient.abdmLinkToken?.token) {
        updateData.abdmLinkToken = sourcePatient.abdmLinkToken;
      } else if (targetPatient.abdmLinkToken?.token) {
        updateData.abdmLinkToken = targetPatient.abdmLinkToken;
      }

      if (sourcePatient.insurance && sourcePatient.insurance.length > 0) {
        updateData.$addToSet = {
          ...(updateData.$addToSet || {}),
          insurance: { $each: sourcePatient.insurance },
        };
      }

      if (sourcePatient.visits && sourcePatient.visits.length > 0) {
        updateData.$addToSet = {
          ...(updateData.$addToSet || {}),
          visits: { $each: sourcePatient.visits },
        };
      }

      const reassigned = await CareContextModel.updateMany(
        { patientId: sourcePatient._id },
        { $set: { patientId: targetPatient._id } },
      );
      if (reassigned.modifiedCount > 0) {
        console.log(
          "mergeAbhaPatient: Reassigned",
          reassigned.modifiedCount,
          "care context(s) from source patient to target",
        );
      }

      await PatientModel.findByIdAndDelete(sourcePatient._id);
    }

    const updatedTarget = await PatientModel.findByIdAndUpdate(
      targetPatient._id,
      updateData,
      { new: true },
    );

    let careContextsCreated = 0;
    if (updatedTarget?.abhaaddress) {
      try {
        const visitIds = new Set<string>();
        for (const v of updatedTarget.visits || []) {
          if (v?.visitId) visitIds.add(String(v.visitId));
        }
        const scanShareVisits = await ScanShareVisitModel.find(
          { patientId: updatedTarget._id },
          { _id: 1 },
        )
          .lean()
          .exec();
        for (const v of scanShareVisits) {
          if (v?._id) visitIds.add(String(v._id));
        }
        for (const visitIdStr of visitIds) {
          const cc = await CareContextService.createCareContextForVisit(
            updatedTarget._id,
            visitIdStr,
            ["OPConsultation"],
          );
          if (cc) careContextsCreated++;
        }
        if (careContextsCreated > 0) {
          console.log(
            "mergeAbhaPatient: Created",
            careContextsCreated,
            "care context(s) for patient",
            updatedTarget.uhid || updatedTarget._id,
          );
        } else if (visitIds.size > 0) {
          console.log(
            "mergeAbhaPatient: No new care contexts (already exist?) for",
            visitIds.size,
            "visit(s), patient",
            updatedTarget.uhid || updatedTarget._id,
          );
        }
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
    });
  } catch (error: any) {
    console.error("Merge Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to merge patient records",
    });
  }
};
