import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { CLIENT_ID, CLIENT_SECRET, GET_URL, GRANT_TYPE, STATUS_CODE, bridgeId, facilityId, facilityName, generateUID } from "../../utils/constant";
import { MSG } from "../../utils/msgs";

export const userV2Onboard = async (req: any, res: any) => {
    try {
        console.log("Step-1")
        const params = {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: GRANT_TYPE,
        };

        let random32String = generateUID();

        console.log("Session URL", `${process.env.ABHA_URL}/sessions`, params)
        let headers = {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String,
            'TIMESTAMP': new Date().toISOString(),
            'X-CM-ID': 'sbx',
        }
        const response = await axios.post(
            `${process.env.ABHA_URL}/sessions`,
            params,
            {
                headers: headers,
            }
        );
        console.log("Step-1 Response", response.data)
        if (response.data.accessToken) {

            await checkBridgeUrl(response.data.accessToken, GET_URL, req, res, random32String);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("error-1", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ error: error.message });
        }
    }
};

export const checkBridgeUrl = async (token: string, url: string, req: any, res: any, random32String: any) => {
    try {
        console.log("Step-2 checkBridgeUrl", process.env.ABHA_URL + "/" + "bridge-services");
        let random32String1 = generateUID();
        const headers = {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String1,
            'TIMESTAMP': new Date().toISOString(),
            'X-CM-ID': 'sbx',
            "authorization": "Bearer " + token
        }

        const response = await axios.get(
            `${process.env.ABHA_URL}/bridge-services`,
            {
                headers: headers,
            }
        );
        console.log("Step-2.2 status ", response.status)
        console.log("Step-2.2", response.data);
        console.log("URL to be set", response?.data?.bridge?.url, url);
        console.log("status", response.status == STATUS_CODE.SUCCESS)

        if (response?.data?.bridge?.url != url) {
            await setBridgeUrl(token, url, req, res, random32String);
            return;
        }
        else if (response.status == STATUS_CODE.SUCCESS) {
            console.log("Step-2 Response", token)
            await tokenGeneration(req, res, token);
            return;
        }
        else {
            console.log("Step-2 else response")
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
            return res.status(STATUS_CODE.SERVER_STOP).json({ error1: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ error2: error.message });
        }
    }
}


export const setBridgeUrl = async (token: string, url: string, req: any, res: any, random32String: string) => {
    try {
        console.log("Step-3", token)
        let headers = {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String,
            'TIMESTAMP': new Date().toISOString(),
            'X-CM-ID': 'sbx',
            "Authorization": "Bearer " + token
        }
        const response = await axios.patch(
            `${process.env.ABHA_URL}/bridge/url`,
            { url: GET_URL },
            {
                headers: headers,
            }
        );
        console.log("Step-3 status ", response.status)
        console.log("Step-3 Response1", response.data)
        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {
            console.log("Step-3 Response")
            await registrationService(token, req, res, url);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response.data, step: 2 });
        }

    } catch (error: any) {
        console.log("error-3", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ error: error.message });
        }
    }
}

export const registrationService = async (token: string, req: any, res: any, url: any) => {
    try {
        console.log("Step-4")
        let headers = {
            'Content-Type': 'application/json',
            "Authorization": "Bearer " + token
        }
        const response: any = await axios.post(
            `${process.env.REGISTRATION_URL}/MutipleHRPAddUpdateServices`,
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
        console.log("step-5 status", response.status)
        console.log("Step-5 Response", response.data)
        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {
            //return res.status(STATUS_CODE.SUCCESS).json({ "success": token });
            await tokenGeneration(req, res, token);
            return;
            //return res.status(STATUS_CODE.SUCCESS).json({ error: response.data, accessToken: token, url: url });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR, step: 2 });
        }

    } catch (error: any) {
        console.log("error.response", error.response)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ error: error.message });
        }
    }
}

export const tokenGeneration = async (req: any, res: any, token: any) => {
    try {
        console.log("tokenGeneration Step-5")
        let request = req.body;

        console.log("tokenGeneration request Data", request)
        let random32String = generateUID();
        let headers = {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String,
            'TIMESTAMP': new Date().toISOString(),
            'X-HIP-ID': facilityId,
            'X-CM-ID': 'sbx',
            "Authorization": "Bearer " + token //req.headers['authorization']
        }
        const response = await axios.post(
            `${process.env.ABHA_URL1}/token/generate-token`,
            request,
            {
                headers: headers,
            }
        );
        console.log("Step-6 Response", response.status)
        console.log("Step-6 Response", response.data)
        const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        console.log("Callback after token generation URL-------------", "https://admin.pran.ai/api/v3/hip/token/on-generate-token");
        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {

            await HealthRecordModel.create({
                facility_id: facilityId,
                facility_name: facilityName,
                hidn_number: request.abhaNumber,
                hid_address: request.abhaAddress,
                patient_name: request.name,
                abha_details: request,
                version_m2: { access_token: token },
                prescription: request.prescription,
                hiType: request.hiType
            })
            return res.status(response.status).json({ "status": response.status, "message": MSG.DATA_PROCESSING });

        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response });
        }

    } catch (error: any) {
        console.log("error-6", error.response)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ error: error.message });
        }
    }
}



