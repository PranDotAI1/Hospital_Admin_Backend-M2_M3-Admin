import { Request, Response } from "express";
import { Types } from "mongoose";
import { PatientModel } from "../../models/Patient";
import { HealthRecordModel } from "../../models/HealthRecord";
import {
  STATUS_CODE,
  generateUID,
  facilityId,
  facilityName,
  clientParams,
  baseHeaders,
} from "../../utils/constant";
import axios from "axios";

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
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, maxLength);
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

    const abhaNumber = sanitizeString(body.abhaNumber || body.ABHANumber, 20);
    const abhaAddress = sanitizeString(
      body.abhaAddress || body.abhaaddress,
      100,
    );

    if (abhaNumber) {
      const existingPatient = await PatientModel.findOne({
        ABHANumber: abhaNumber,
      });
      if (existingPatient) {
        return res.status(STATUS_CODE.ERROR).json({
          status: "error",
          message: "A patient with this ABHA number already exists",
          existingUhid: existingPatient.uhid,
        });
      }
    }

    const m_name = sanitizeString(body.m_name || body.middleName, 100);
    const l_name = sanitizeString(body.l_name || body.lastName, 100);
    const fullName = [f_name, m_name, l_name].filter(Boolean).join(" ");

    const address = sanitizeString(body.address, 500);
    const pincode = sanitizeString(body.pincode, 10);
    const state = sanitizeString(body.state, 50);
    const district = sanitizeString(body.district, 50);

    let patientRecord = await PatientModel.findOne({
      mobile: mobile,
      f_name: { $regex: new RegExp("^" + f_name + "$", "i") },
    });

    let isNewPatient = false;

    if (patientRecord) {
      const updateData: any = {};
      if (address) updateData.address = address;
      if (pincode) updateData.pincode = pincode;
      if (state) updateData.state = state;
      if (district) updateData.district = district;

      if (body.allergies)
        updateData.allergies = sanitizeString(body.allergies, 500);
      if (body.existingMedicalConditions)
        updateData.existingMedicalConditions = sanitizeString(
          body.existingMedicalConditions,
          500,
        );
      if (body.ongoingMedications)
        updateData.ongoingMedications = sanitizeString(
          body.ongoingMedications,
          500,
        );

      if (abhaNumber && !patientRecord.ABHANumber) {
        updateData.ABHANumber = abhaNumber;
        updateData.abhaaddress = abhaAddress;
        updateData.abhaLinkedAt = new Date();
      }

      patientRecord = await PatientModel.findByIdAndUpdate(
        patientRecord._id,
        { $set: updateData },
        { new: true },
      );
    } else {
      isNewPatient = true;

      const uhid = await generateUHID();

      patientRecord = await PatientModel.create({
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
        ABHANumber: abhaNumber || undefined,
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
    }

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
      $push: { visits: visitInfo },
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

    return res
      .status(isNewPatient ? STATUS_CODE.CREATED : STATUS_CODE.SUCCESS)
      .json({
        status: "success",
        message: isNewPatient
          ? "Patient registered successfully"
          : "Patient already exists, record updated",
        data: {
          uhid: patientRecord.uhid,
          _id: patientRecord._id,
          name: patientRecord.name,
          mobile: patientRecord.mobile,
          abhaLinked: !!patientRecord.ABHANumber,
          visit: visitInfo,
          existingRecord: !isNewPatient,
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
    let healthRecordId = null;

    try {
      const headers = baseHeaders();
      const sessionResponse = await axios.post(
        `${process.env.ABHA_URL}/sessions`,
        clientParams,
        { headers },
      );

      if (sessionResponse.data.accessToken) {
        const token = sessionResponse.data.accessToken;

        const tokenHeaders = {
          "Content-Type": "application/json",
          "REQUEST-ID": generateUID(),
          TIMESTAMP: new Date().toISOString(),
          "X-HIP-ID": facilityId,
          "X-CM-ID": "sbx",
          Authorization: `Bearer ${token}`,
        };

        const tokenPayload = {
          abhaNumber: abhaNumber,
          abhaAddress: abhaAddress,
          name: name || patient.name,
        };

        const tokenResponse = await axios.post(
          `${process.env.ABHA_URL1}/token/generate-token`,
          tokenPayload,
          { headers: tokenHeaders },
        );

        if (tokenResponse.status === 200 || tokenResponse.status === 202) {
          const healthRecord = await HealthRecordModel.create({
            facility_id: facilityId,
            facility_name: facilityName,
            hidn_number: abhaNumber,
            hid_address: abhaAddress,
            patient_name: name || patient.name,
            abha_details: { abhaNumber, abhaAddress },
            version_m2: { access_token: token },
          });

          healthRecordId = healthRecord._id;
          abdmLinked = true;
        }
      }
    } catch (abdmError: any) {
      console.error(
        "ABDM linking error (non-blocking):",
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

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: abdmLinked
        ? "ABHA linked successfully with ABDM integration"
        : "ABHA linked locally (ABDM integration pending)",
      data: {
        uhid: updatedPatient?.uhid,
        abhaNumber: updatedPatient?.ABHANumber,
        abhaAddress: updatedPatient?.abhaaddress,
        abhaLinkedAt: updatedPatient?.abhaLinkedAt,
        healthRecordId,
        abdmLinked,
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

      if (profileDetails.abhaAddress)
        updateData.abhaaddress = profileDetails.abhaAddress;
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

      await PatientModel.findByIdAndDelete(sourcePatient._id);
    }

    const updatedTarget = await PatientModel.findByIdAndUpdate(
      targetPatient._id,
      updateData,
      { new: true },
    );

    return res.status(STATUS_CODE.SUCCESS).json({
      status: "success",
      message: message,
      data: updatedTarget,
      mergedFrom: sourcePatient?._id,
    });
  } catch (error: any) {
    console.error("Merge Patient error:", error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      message: error.message || "Failed to merge patient records",
    });
  }
};
