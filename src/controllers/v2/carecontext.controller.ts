import axios from "axios";
import { PatientModel } from "../../models/Patient";
import { baseHeaders, STATUS_CODE } from "../../utils/constant";

export const generateLinkToken = async (req: any, res: any) => {
  try {
    const { abhaNumber, abhaAddress, name, gender, yearOfBirth } = req.body;

    const errs: any = {};

    if (!abhaNumber) {
      errs.abhaNumber = "ABHA Number is required";
    }
    if (!abhaAddress) {
      errs.abhaAddress = "ABHA Address is required";
    }
    if (!name) {
      errs.name = "Name is required";
    }
    if (!gender) {
      errs.gender = "Gender is required";
    }
    if (!yearOfBirth) {
      errs.yearOfBirth = "Year of Birth is required";
    }

    if (Object.keys(errs).length > 0) {
      return res
        .status(STATUS_CODE.ERROR)
        .json({ error: errs, message: "Validation Error", status: "error" });
    }

    const headers = baseHeaders(true);

    const patient = await PatientModel.findOne({ abhaAddress });

    if (patient.linkToken) {
      return res.status(STATUS_CODE.ERROR).json({
        error: "Patient already linked",
        message: "Patient already linked",
        status: "error",
      });
    }

    if (!patient) {
      return res.status(STATUS_CODE.ERROR).json({
        error: "Patient not found",
        message: "Patient not found",
        status: "error",
      });
    }

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/v3/token/generate-token`,
      {
        patientId: patient._id,
        abhaAddress: abhaAddress,
        name: name,
        gender: gender,
        yearOfBirth: yearOfBirth,
      },
      {
        headers: headers,
      },
    );
  } catch (error: any) {
    return res.status(STATUS_CODE.ERROR).json({
      error: error.message,
      message: "Internal Server Error",
      status: "error",
    });
  }
};
