import axios from "axios";
import { CLIENT_ID, CLIENT_SECRET, GET_URL, GRANT_TYPE, bridgeId, facilityId, facilityName, generateUID } from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";
import { HealthRecordModel } from "../../models/HealthRecord";

export const userOnboardingByĂbha = async (req: any, res: any) => {
    try {
        console.log("M3 Step-1")
        const params = {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: GRANT_TYPE,
        };

        let random32String = generateUID();

        const response = await axios.post(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.GET_ABHA_SESSION}`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                },
            }
        );
        console.log("M3 Step-1 Response", response.data)
        if (response.data.accessToken) {

            await checkBridgeUrl(response.data.accessToken, GET_URL, req, res, random32String);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("M3 error-1", error.response)
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

export const checkBridgeUrl = async (token: string, url: string, req: any, res: any, random32String: any) => {
    try {
        console.log("M3 checkBridgeUrl Step-2")
        const response = await axios.get(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.GET_ABHA_BRIDGE_URL} `,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + token
                },
            }
        );
        console.log("M3 Step-2.2 status ", response.status)
        console.log("M3  checkBridgeUrl Step-2.2", response.data)
        if (response?.data?.bridge?.url != url) {
            await setBridgeUrl(token, url, req, res, random32String);
            return;
        }
        else {
            console.log("M3 Step-2 else response")
            await setBridgeUrl(token, url, req, res, random32String);
            return;
            //return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        console.log("M3 error-2", error.response)
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


export const setBridgeUrl = async (token: string, url: string, req: any, res: any, random32String: string) => {
    try {
        console.log("M3 Step-3", GET_URL, random32String, token)
        const response = await axios.patch(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.SET_BRIDGE_URL}`,
            { url: GET_URL },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + token
                },
            }
        );
        console.log("M3 Step-3 status ", response.status)
        console.log("M3 Step-3 Response1", response.data)
        if (response.status == 202 || response.status == 200) {
            console.log("M3 Step-3 Response")
            await registrationService(token, req, res, url);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        console.log("M3 setBridgeUrl error-3", error.response.data)
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

export const registrationService = async (token: string, req: any, res: any, url: any) => {
    try {
        console.log("M3 Step-4")
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
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": "Bearer " + token
                },
            }
        );
        console.log("step-5 status", response.status)
        console.log("Step-5 Response", response.data)
        if (response.status == 202 || response.status == 200) {
            //return res.status(200).json({ "success": token });
            //await tokenGeneration(req, res, token);
            return res.status(200).json({ "status": response.status, "cust_status": "Pending", "message": "Your data in process. please wait for some time..." })
            //return res.status(200).json({ error: response.data, accessToken: token, url: url });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api", step: 2 });
        }

    } catch (error: any) {
        console.log("M3 error.response", error.response)
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

export const consentRequestInitiate = async (req: any, res: any) => {
    try {
        let input = req.body;
        const params = {
            "consent": {
                "purpose": {
                    "text": "Care Management",
                    "code": "CAREMGT",
                    "refUri": "http://admin.pran.ai/"
                },
                "patient": {
                    "id": input.abha_id //abha address
                },
                "hiu": {
                    "id": input.facilityId //facilityId
                },
                "hip": null,
                "careContexts": null,
                "requester": {
                    "name": "Dr Vb test",
                    "identifier": {
                        "type": "REG001",
                        "value": "MH001",
                        "system": "http://admin.pran.ai"
                    }
                },
                "hiTypes": input.hiTypes,
                "permission": {
                    "accessMode": "VIEW",
                    "dateRange": {
                        "from": input.from,
                        "to": input.to
                    },
                    "dataEraseAt": input.dataEraseAt,
                    "frequency": "ONCE"
                }
            }
        }

        let random32String = generateUID();

        const response = await axios.post(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.REQ_INIT}`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + req.headers['authorization']
                },
            }
        );
        console.log("M3 Step-1 Response requestInitiate", response.data)
        if (response.status == 202 || response.status == 200) {
            const latestRecord = await HealthRecordModel.findOne({
                hid_address: input.abha_id
            }).sort({ updatedAt: -1 }).limit(1);
            if (latestRecord) {
                await HealthRecordModel.updateOne(
                    { _id: latestRecord._id },
                    {
                        $set: {
                            "version_m3.access_token": req.headers['authorization'],
                            "version_m3.requested_data": input
                        }
                    }
                );
            }
            return res.status(response.status).json({ "status": response.status, "message": "Success" });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("M3 error-1", error.response)
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


export const getConsentRequestStatus = async (req: any, res: any) => {
    try {
        let input = req.body;
        const params = {
            "consentRequestId": ""
        }

        let random32String = generateUID();

        const response = await axios.post(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.GET_REQ_STATUS}`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + req.headers['authorization']
                },
            }
        );
        console.log("M3 Step-1 Response requestInitiate", response.data)
        if (response.status == 202 || response.status == 200) {
            const latestRecord = await HealthRecordModel.findOne({
                hid_address: input.abha_id
            }).sort({ updatedAt: -1 }).limit(1);
            if (latestRecord) {
                await HealthRecordModel.updateOne(
                    { _id: latestRecord._id },
                    {
                        $set: {
                            "version_m3.access_token": req.headers['authorization'],
                            "version_m3.requested_data": input
                        }
                    }
                );
            }
            return res.status(response.status).json({ "status": response.status, "message": "Success" });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("M3 error-1", error.response)
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


