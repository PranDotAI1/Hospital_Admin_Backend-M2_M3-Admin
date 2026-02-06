import { Request, Response } from "express";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  generateUID,
  GET_URL,
  GRANT_TYPE,
  facilityName,
} from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";
import axios from "axios";
import { ConsentRequestModel } from "../../models/ConsentRequest";
import { PatientModel } from "../../models/Patient";

const getUrls = {
  sessionToken: process.env.ABDM_BASE_URL + ENDPOINTS.GET_ABHA_SESSION,
  consentInit: process.env.ABDM_BASE_URL + ENDPOINTS.REQ_INIT,
};
const baseHeaders = () => ({
  "Content-Type": "application/json",
  "REQUEST-ID": generateUID(),
  TIMESTAMP: new Date().toISOString(),
  "X-CM-ID": "sbx",
});

const consentValues = {
  "identifier.type": "REG001",
  "identifier.value": "MH001",
  "identifier.system": GET_URL,
} as const;

const getIdentifier = () => {
  return {
    type: consentValues["identifier.type"],
    value: consentValues["identifier.value"],
    system: consentValues["identifier.system"],
  };
};

export const getSessionToken = async () => {
  try {
    const response = await axios.post(
      getUrls.sessionToken,
      {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        grantType: GRANT_TYPE,
      },
      {
        headers: baseHeaders(),
      },
    );
    return { data: response.data, token: response.data.accessToken };
  } catch (error) {
    console.log("Error getting session token", error);
    throw error;
  }
};

export const consentInitRequest = async (req: Request, res: Response) => {
  try {
    console.log("consent started");
    let body = req.body;

    console.log("received body", body);

    const params = {
      consent: {
        purpose: {
          text: "Care Management",
          code: "CAREMGT",
          refUri: GET_URL,
        },
        patient: {
          id: body.abha_id,
        },
        hiu: {
          id: body.facilityId,
        },
        hip: null,
        careContexts: null,
        requester: {
          name: "Dr Vb test",
          identifier: getIdentifier(),
        },
        hiTypes: body.hiTypes,
        permission: {
          accessMode: "VIEW",
          dateRange: {
            from: body.from,
            to: body.to,
          },
          dataEraseAt: body.dataEraseAt,
          frequency: {
            unit: "HOUR",
            value: 0,
            repeats: 0,
          },
        },
      },
    };

    console.log("final params", params);

    const token = (await getSessionToken())?.token;

    console.log("check token", token);

    let headers = {
      ...baseHeaders(),
      Authorization: "Bearer " + token,
    };

    console.log("checking headers consend", headers);

    const response = await axios.post(getUrls.consentInit, params, {
      headers: headers,
    });

    console.log("consent api response", response.data);
    console.log("consent api response status", response.status);

    if (response.status == 202 || response.status == 200) {
      let patientDetails: any = {};

      const cleanInput = body.abha_id.replace(/-/g, "");
      const formattedInput =
        cleanInput.length === 14
          ? `${cleanInput.slice(0, 2)}-${cleanInput.slice(2, 6)}-${cleanInput.slice(6, 10)}-${cleanInput.slice(10, 14)}`
          : body.abha_id;

      const searchCriteria: any[] = [
        { abhaaddress: body.abha_id },
        { uhid: body.abha_id },
        { ABHANumber: cleanInput },
        { ABHANumber: formattedInput },
      ];

      const localPatient = await PatientModel.findOne({
        $or: searchCriteria,
      });

      if (localPatient) {
        patientDetails = {
          patientName:
            localPatient.name ||
            `${localPatient.f_name} ${localPatient.l_name}`,
          abhaAddress: localPatient.abhaaddress,
          abhaNumber: localPatient.ABHANumber,
          gender: localPatient.gender,
          dob: localPatient.dob,
        };
      }

      const newConsentRequest = await ConsentRequestModel.create({
        requestId: headers["REQUEST-ID"],
        status: "INITIATED",
        patientAbhaId: body.abha_id,

        ...patientDetails,
        facilityName: facilityName,

        hiuId: params.consent.hiu.id,
        requester: params.consent.requester,
        purpose: params.consent.purpose,
        hiTypes: params.consent.hiTypes,
        permission: params.consent.permission,
      });

      console.log("Created Consent Request:", newConsentRequest);

      return res.status(response.status).json({
        status: "REQUESTED",
        statusCode: response.status,
        data: response.data,
      });
    } else {
      return res.status(response.status).json({
        statusCode: response.status,
        status: response.status,
        error: "error from abdm" + response.data,
      });
    }
  } catch (error: any) {
    console.log("consent error", error.response.data, error.message);
    if (error.response) {
      return res
        .status(error.response.status)
        .json({ error: error.response.data, details: error.message });
    } else if (error.request) {
      return res
        .status(503)
        .json({ error: "Service unavailable", details: error.message });
    } else {
      return res.status(500).json({ error: error.message, details: error });
    }
  }
};

export const getConsentRequests = async (req: Request, res: Response) => {
  try {
    const { limit = 25, skip = 0 } = req.query;

    const query: any = {};

    const requests = await ConsentRequestModel.find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await ConsentRequestModel.countDocuments(query);

    return res.status(200).json({
      status: "success",
      data: requests,
      total,
      page: { limit: Number(limit), skip: Number(skip) },
    });
  } catch (error: any) {
    console.error("Error fetching consent requests:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch requests", details: error.message });
  }
};
