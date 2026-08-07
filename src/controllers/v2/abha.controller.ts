import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import {
  GET_URL,
  STATUS_CODE,
  baseHeaders,
  bridgeId,
  clientParams,
  facilityId,
  facilityName,
  generateUID,
} from "../../utils/constant";
import { MSG } from "../../utils/msgs";

export const userV2Onboard = async (req: any, res: any) => {
  try {
    let headers = baseHeaders();
    let random32String = headers["REQUEST-ID"];
    const response = await axios.post(
      `${process.env.ABHA_URL}/sessions`,
      clientParams,
      {
        headers: headers,
      },
    );
    if (response.data.accessToken) {
      await checkBridgeUrl(
        response.data.accessToken,
        GET_URL,
        req,
        res,
        random32String,
      );
      return;
    } else {
      return res
        .status(response.status)
        .json({
          status: response.status,
          error: MSG.API_ERROR + response.data,
          step: 1,
        });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }
  }
};

export const checkBridgeUrl = async (
  token: string,
  url: string,
  req: any,
  res: any,
  random32String: any,
) => {
  try {
    const headers = baseHeaders();

    const response = await axios.get(
      `${process.env.ABHA_URL}/bridge-services`,
      {
        headers: {...headers, Authorization: "Bearer " + token},
      },
    );
    if (response?.data?.bridge?.url != url) {
      await setBridgeUrl(token, url, req, res, random32String);
      return;
    } else if (response.status == STATUS_CODE.SUCCESS) {
      await tokenGeneration(req, res, token);
      return;
    } else {
      await setBridgeUrl(token, url, req, res, random32String);
      return;
      //return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response.data, step: 2 });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error33: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error1: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error2: error.message });
    }
  }
};

export const setBridgeUrl = async (
  token: string,
  url: string,
  req: any,
  res: any,
  random32String: string,
) => {
  try {
    let headers = {
      "Content-Type": "application/json",
      "REQUEST-ID": random32String,
      TIMESTAMP: new Date().toISOString(),
      "X-CM-ID": "sbx",
      Authorization: "Bearer " + token,
    };
    const response = await axios.patch(
      `${process.env.ABHA_URL}/bridge/url`,
      { url: GET_URL },
      {
        headers: headers,
      },
    );
    if (
      response.status == STATUS_CODE.ACCEPTED ||
      response.status == STATUS_CODE.SUCCESS
    ) {
      await registrationService(token, req, res, url);
      return;
    } else {
      return res
        .status(response.status)
        .json({
          status: response.status,
          error: MSG.API_ERROR + response.data,
          step: 2,
        });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }
  }
};

export const registrationService = async (
  token: string,
  req: any,
  res: any,
  url: any,
) => {
  try {
    let headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    };
    const response: any = await axios.post(
      `${process.env.REGISTRATION_URL}/MutipleHRPAddUpdateServices`,
      {
        facilityId: facilityId, //req.body.facilityId,
        facilityName: facilityName, //req.body.facilityName,
        HRP: [
          {
            bridgeId: bridgeId,
            hipName: facilityName, //req.body.facilityName,
            type: "HIP",
            active: true,
          },
        ],
      },
      {
        headers: headers,
      },
    );
    if (
      response.status == STATUS_CODE.ACCEPTED ||
      response.status == STATUS_CODE.SUCCESS
    ) {
      //return res.status(STATUS_CODE.SUCCESS).json({ "success": token });
      await tokenGeneration(req, res, token);
      return;
      //return res.status(STATUS_CODE.SUCCESS).json({ error: response.data, accessToken: token, url: url });
    } else {
      return res
        .status(response.status)
        .json({ status: response.status, error: MSG.API_ERROR, step: 2 });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }
  }
};

export const tokenGeneration = async (req: any, res: any, token: any) => {
  try {
    let request = req.body;
    let random32String = generateUID();
    let headers = {
      "Content-Type": "application/json",
      "REQUEST-ID": random32String,
      TIMESTAMP: new Date().toISOString(),
      "X-HIP-ID": facilityId,
      "X-CM-ID": "sbx",
      Authorization: "Bearer " + token, //req.headers['authorization']
    };
    const response = await axios.post(
      `${process.env.ABHA_URL1}/token/generate-token`,
      request,
      {
        headers: headers,
      },
    );
    const baseUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    if (
      response.status == STATUS_CODE.ACCEPTED ||
      response.status == STATUS_CODE.SUCCESS
    ) {
      await HealthRecordModel.create({
        facility_id: facilityId,
        facility_name: facilityName,
        hidn_number: request.abhaNumber,
        hid_address: request.abhaAddress,
        patient_name: request.name,
        abha_details: request,
        version_m2: { access_token: token },
        prescription: request.prescription,
        hiType: request.hiType,
      });
      return res
        .status(response.status)
        .json({ status: response.status, message: MSG.DATA_PROCESSING });
    } else {
      return res
        .status(response.status)
        .json({ status: response.status, error: MSG.API_ERROR + response });
    }
  } catch (error: any) {
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data });
    } else if (error.request) {
      return res
        .status(STATUS_CODE.SERVER_STOP)
        .json({ error: MSG.SERVICE_UNAVAILABLE });
    } else {
      return res.status(STATUS_CODE.ERROR).json({ error: error.message });
    }
  }
};
