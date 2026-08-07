import axios from "axios";
import { CLIENT_ID, CLIENT_SECRET, GET_URL, GRANT_TYPE, bridgeId, facilityId, facilityName, generateUID } from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";
import { ConsentService } from "../../services/consent.service";

export const userOnboardingByĂbha = async (req: any, res: any) => {
    try {
        const params = {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: GRANT_TYPE,
        };
        let random32String = generateUID();
        let headers = {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String,
            'TIMESTAMP': new Date().toISOString(),
            'X-CM-ID': 'sbx',
        } 
        let url = process.env.ABDM_BASE_URL + ENDPOINTS.GET_ABHA_SESSION.trim();
        const response = await axios.post(
            url,
            params,
            {
                headers: headers
            }
        );
        if (response.data.accessToken) {
            await checkBridgeUrl(response.data.accessToken, GET_URL, req, res, random32String);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(503).json({ error: 'Service unavailable' });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
};

export const checkBridgeUrl = async (token: string, brdgeurl: string, req: any, res: any, random32String: any) => {
    try {
        let random32String1 = generateUID();
        let headers = {
            "Content-Type": "application/json",
            "REQUEST-ID": random32String1,
            "TIMESTAMP": new Date().toISOString(),
            "X-CM-ID": "sbx",
            "Authorization": "Bearer " + token
        }

        let url = process.env.ABDM_BASE_URL + ENDPOINTS.GET_ABHA_BRIDGE_URL.trim();
        const response = await axios.get(
            url,
            {
                headers: headers
            }
        );
        if (response?.data?.bridge?.url != brdgeurl) {
          await setBridgeUrl(token, req, res, random32String);
          return;
        } else {
          await setBridgeUrl(token, req, res, random32String);
          return;
          //return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(503).json({ error: 'Service unavailable' });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}


export const setBridgeUrl = async (token: string, req: any, res: any, random32String: string) => {
    try {

        let url = process.env.ABDM_BASE_URL + ENDPOINTS.SET_BRIDGE_URL
        let headers = {
            "Content-Type": "application/json",
            "REQUEST-ID": generateUID(),
            "TIMESTAMP": new Date().toISOString(),
            "X-CM-ID": "sbx",
            "Authorization": "Bearer " + token
        }
        const response = await axios.patch(
            url,
            { url: GET_URL },
            {
                headers: headers
            }
        );
        if (response.status == 202 || response.status == 200) {
            await registrationService(token, req, res, url);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data, statusCode: error.response.status });
        } else if (error.request) {
            return res.status(error.response.status).json({ error: 'Service unavailable', statusCode: error.response.status });
        } else {
            return res.status(error.response.status).json({ error: error.message, statusCode: error.response.status });
        }
    }
}

export const registrationService = async (token: string, req: any, res: any, url: any) => {
    try {
        let headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        }
        const response: any = await axios.post(
            `${process.env.REGISTRATION_URL + ENDPOINTS.MULTIPLE_HRP}`,
            {
                "facilityId": facilityId,//req.body.facilityId,
                "facilityName": facilityName, //req.body.facilityName,
                "HRP": [
                    {
                        "bridgeId": bridgeId,
                        "hipName": facilityName,//req.body.facilityName,
                        "type": "HIP",
                        "active": true
                    }
                ]
            },
            {
                headers: headers,
            }
        );
        if (response?.status == 202 || response?.status == 200) {
            await consentRequestInitiate(req, res, token);
            //return res.status(200).json({ "status": response.status, "cust_status": "Pending", "message": "Your data in process. please wait for some time..." })
        } else {
            return res.status(response?.status).json({ "status": 200, "error": "getting error from api", step: 2 });
        }

    } catch (error: any) {
        if (error.response) {
            return res
                .status(403)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(403).json({ error: 'Service unavailable' });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

export const consentRequestInitiate = async (req: any, res: any, token?: any) => {
    try {
        const input = req.body;

        if (!input.abha_id || !input.facilityId) {
            return res.status(400).json({
                status: "error",
                message: "Missing required fields: abha_id, facilityId",
            });
        }

        const result = await ConsentService.initiateConsentRequest({
            abhaId: input.abha_id,
            hiuId: input.facilityId,
            hiTypes: input.hiTypes || ["OPConsultation"],
            dateFrom: input.from || new Date().toISOString(),
            dateTo: input.to || new Date().toISOString(),
            dataEraseAt: input.dataEraseAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            requesterName: input.requesterName,
            purposeCode: input.purposeCode,
            purposeText: input.purposeText,
            patientData: input.patientData,
        });
        return res.status(result.status).json({
            status: "REQUESTED",
            statusCode: result.status,
            requestId: result.requestId,
            message: "Consent request has been successfully initiated",
            data: result.data,
        });
    } catch (error: any) {
        console.error("[CONSENT_M3] Error:", error.response?.data || error.message);
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(503).json({ error: "Service unavailable" });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
};


