import { HealthRecordModel } from "../models/HealthRecord";
import { CLIENT_ID, CLIENT_SECRET, GET_URL, GRANT_TYPE, HIP_NAME, bridgeId, facilityId, facilityName, generateUID } from "../utils/constant";
import axios from "axios";

export const getLinkToken = async (req: any, res: any) => {
    try {
        console.log("Step-1")
        const params = {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: GRANT_TYPE,
        };

        let random32String = generateUID();

        const response = await axios.post(
            `${process.env.ABHA_URL}/sessions`,
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
        console.log("Step-1 Response", response)
        if (response.data.accessToken) {

            await checkBridgeUrl(response.data.accessToken, GET_URL, req, res, random32String);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("error-1", error)
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
        console.log("Step-2")
        const response = await axios.get(
            `${process.env.ABHA_URL}/bridge-services`,
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
        console.log("Step-2.2", response)
        if (response?.data?.bridge?.url != url) {
            await setBridgeUrl(token, url, req, res, random32String);
            return;
        }
        else if (response.status == 200) {
            console.log("Step-2 Response", token)
            await tokenGeneration(req, res, token);
            return;
        }
        else {
            console.log("Step-2 else response")
            await setBridgeUrl(token, url, req, res, random32String);
            return;
            //return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        console.log("error-2", error)
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
        console.log("Step-3", token)
        const response = await axios.patch(
            `${process.env.ABHA_URL}/bridge/url`,
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
        console.log("Step-3 Response1", response)
        if (response.status == 202 || response.status == 200) {
            console.log("Step-3 Response")
            await registrationService(token, req, res, url);
            return;
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
        }

    } catch (error: any) {
        console.log("error-3", error)
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
        console.log("Step-4")
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
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": "Bearer " + token
                },
            }
        );
        console.log("Step-5 Response", response)
        if (response.status == 202 || response.status == 200) {
            //return res.status(200).json({ "success": token });
            await tokenGeneration(req, res, token);
            return;
            //return res.status(200).json({ error: response.data, accessToken: token, url: url });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api", step: 2 });
        }

    } catch (error: any) {
        console.log("error.response", error.response)
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

export const tokenGeneration = async (req: any, res: any, token: any) => {
    try {
        console.log("Step-5")
        let request = req.body;

        let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABHA_URL1}/token/generate-token`,
            request,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-HIP-ID': 'SBX_HIP_V2',
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + token //req.headers['authorization']
                },
            }
        );
        console.log("Step-6 Response", response)
        if (response.status == 202 || response.status == 200) {

            await HealthRecordModel.create({
                facility_id: facilityId,
                facility_name: facilityName,
                hidn_number: request.abhaNumber,
                hid_address: request.abhaAddress,
                patient_name: request.name,
                abha_details: request,
                access_token: token
            })
            // await careContext(req, res, response.data.linkToken);
            return res.status(200).json({ "status": "Pending", "message": "Your data in process. please wait for some time..." })
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response });
        }

    } catch (error: any) {
        console.log("error-6", error.response)
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

export const careContext = async (req: any, res: any, token: any) => {
    console.log("tokentoken", token)
    try {
        let request = req.body;

        let postData = {
            abhaNumber: request.abhaNumber,
            abhaAddress: request.abhaAddress,
            patient: [
                {
                    referenceNumber: request.abhaNumber + request.abhaAddress,
                    display: req.name,
                    careContexts: [
                        {
                            referenceNumber: request.abhaNumber,
                            display: req.name,
                        }
                    ],
                    hiType: "test",
                    count: 1
                }
            ]
        }

        let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABHA_URL1}/link/carecontext`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-HIP-ID': 'SBX_HIP_V2',
                    'X-CM-ID': 'sbx',
                    'X-LINK-TOKEN': token,
                    "Authorization": req.headers['authorization']
                },
            }
        );

        if (response.status == 202 || response.status == 200) {
            // let respo = response.data;


            await onNotifiy(req, res, "consentid", "requestId")
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response });
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

export const onNotifiy = async (req: any, res: any, consentId: any, requestId: any) => {
    try {


        let postData = {
            acknowledgement: {
                status: "ok",
                consentId: consentId
            },
            response: {
                requestId: requestId
            }
        }

        let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABHA_URL2}/consent/v3/request/hip/on-notify`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": req.headers['authorization']
                },
            }
        );

        if (response.status == 202 || response.status == 200) {
            return res.status(200).json(response.data)
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response });
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

export const tokenGeneration1 = async (req: any, res: any) => {
    try {

        let request = req.body;

        let random32String = generateUID();
        console.log("tokenGeneration1 start", request, `${process.env.ABHA_URL1}/token/generate-token`)
        const response = await axios.post(
            `${process.env.ABHA_URL1}/token/generate-token`,
            request,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-HIP-ID': 'SBX_HIP_V2',
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + request.token //req.headers['authorization']
                },
            }
        );
        console.log("tokenGeneration1 Response", response.data)
        if (response.status == 202 || response.status == 200) {

            // await HealthRecordModel.create({
            //     facility_id: facilityId,
            //     facility_name: facilityName,
            //     hidn_number: request.abhaNumber,
            //     hid_address: request.abhaAddress,
            //     patient_name: request.name,
            //     abha_details: request,
            //     access_token: request.token
            // })
            // await careContext(req, res, response.data.linkToken);
            return res.status(200).json({ "status": "tokenGeneration1", "message": "Your data in process. please wait for some time..." })
        } else {
            return res.status(response.status).json({ "tokenGeneration13": response.status, "error": "getting error from api" + response });
        }

    } catch (error: any) {
        console.log("error-6 tokenGeneration1", error.response)
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