import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { X_HIP_ID, facilityId, generateUID } from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";

export const requestOnInitCallback = async (req: any, res: any) => {
    try {
        const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        console.log("Link token generation start here ----------------------------------")
        console.log("URL-------------", baseUrl, req.headers['authorization'].split(" ")[1]);
        //
        let postData = req.body;
        console.log("linkTokenGeneration-1 Request ", postData)
        const latestRecord = await HealthRecordModel.findOne({
            "version_m3.access_token": req.headers['authorization'].split(" ")[1]
        }).sort({ updatedAt: -1 })
            .limit(1);

        console.log("LinkTokenGeneration-2 Response ", latestRecord, postData);


        if (latestRecord) {
            console.log("LinkTokenGeneration Response success", postData);
            await HealthRecordModel.updateOne(
                { _id: latestRecord._id },
                {
                    $set: {
                        "version_m3.consentId": postData.consentRequest.id,
                        "version_m3.consentRequestId": postData.response.requestId,
                        "version_m3.updatedAt": new Date()
                    }
                }
            );
            await updateConsentRequestStatus(req, res, postData.consentRequest.id, latestRecord);
            return res
                .status(200)
                .json({ status: 200, message: "Latest record updated for m3" });
        } else {
            console.log("LinkTokenGeneration Response no data found", postData);
            return res
                .status(200)
                .json({ status: 200, message: "No records found for this abhaAddress." });
        }
    } catch (error: any) {
        console.log("web hook error Response", error)
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

//https://dev.abdm.gov.in/api/hiecm/consent/v3/request/status

export const updateConsentRequestStatus = async (req: any, res: any, consentId: string, latestRecord: any) => {
    try {

        const params = {
            "consentRequestId": consentId
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
                    'X-HIP-ID': X_HIP_ID,
                    "Authorization": "Bearer " + req.headers['authorization']
                },
            }
        );
        console.log("M3 Step-1 Response consentRequestId", response.data)
        if (response.status == 202 || response.status == 200) {
            let resp = response.data;
            await HealthRecordModel.updateOne(
                { _id: latestRecord._id },
                {
                    $set: {
                        "version_m3.consentStatus": resp.consentRequest.status
                    }
                }
            );
            await onNotify(req, res, latestRecord);
            //return res.status(response.status).json({ "status": response.status, "message": "Success", "api_name": "get consent status https://dev.abdm.gov.in/api/hiecm/consent/v3/request/status" });
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

//https://dev.abdm.gov.in/api/hiecm/consent/v3/request/hiu/on-notify
export const onNotify = async (req: any, res: any, latestRecord: any) => {
    try {

        const record = await HealthRecordModel.findOne({ _id: latestRecord._id }).sort({ updatedAt: -1 }).limit(1);

        let random32String = generateUID();
        let params = {
            "acknowledgement": [
                {
                    "status": record?.version_m3?.status,
                    "consentId": record?.version_m3?.consentId,
                }
            ],
            "response": {
                "requestId": record?.version_m3?.last_request_id,
            }
        }

        const response = await axios.post(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.ON_NOTIFY}`,
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
        console.log("M3 Step-1 Response onNotify", response.data)
        if (response.status == 202 || response.status == 200) {
            await patientConsentFetch(req, res, record?.version_m3?.consentId)
            //return res.status(response.status).json({ "status": response.status, "message": "Success", "api_name": "notifiy status https://dev.abdm.gov.in/api/hiecm/consent/v3/request/hiu/on-notify" });
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


//https://dev.abdm.gov.in/api/hiecm/consent/v3/fetch
export const patientConsentFetch = async (req: any, res: any, consentId: any) => {
    try {

        console.log("Step -- 99  patient Consent Fetch start here ------------------- ")
        let random32String = generateUID();
        let params = {
            "consentId": consentId
        }
        const response = await axios.post(
            `${process.env.ABDM_BASE_URL + ENDPOINTS.CONSENT_FETCH}`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    'X-HIP-ID': X_HIP_ID,
                    "Authorization": "Bearer " + req.headers['authorization']
                },
            }
        );
        console.log("patient Consent Fetch response ----------", response.data, "---------status-----", response.status)
        if (response.status == 202 || response.status == 200) {
            // will get the response in callback
            return res.status(response.status).json({ "status": response.status, "message": "Success", "api_name": "notifiy status https://webhook.site/7e64fb5c-96a0-4585-9e1e-7c10ce8df7a5/api/v3/hiu/consent/on-fetch" });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api " + response.data, step: 1 });
        }
    } catch (error: any) {
        console.log("patient Consent Fetch response in catch block", error.response)
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


//https://webhook.site/7e64fb5c-96a0-4585-9e1e-7c10ce8df7a5/api/v3/hiu/consent/on-fetch

export const consentOnFetchCallback = async (req: any, res: any) => {
    try {

        console.log("Step -- 100  consent OnFetchCallbackstart here ------------------- https://webhook.site/7e64fb5c-96a0-4585-9e1e-7c10ce8df7a5/api/v3/hiu/consent/on-fetch ")
        let body = req.body;
        let params = req.params.requestid;
        console.log("params", params, body.consent.consentDetail.patient.id);

        let abhaAddress = body.consent.consentDetail.patient.id

        await HealthRecordModel.updateOne(
            { hid_address: abhaAddress },
            {
                $set: {
                    "version_m3.consentDetails": body
                }
            }
        );
        return res.status(200).json({ msg: "Consent details updated" });
    } catch (error: any) {
        console.log("patient Consent Fetch response in catch block", error.response)
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







//https://webhook.site/2086641f-2f45-4341-8d8d-63ff0797f61f/api/v3/link/on_carecontext
export const onCarecontext = async (req: any, res: any) => {
    try {
        let request = req.body;

        console.log("on_carecontext callback and request data ---------------------", request)

        let response = await HealthRecordModel.updateOne({ hid_address: request.abhaAddress }, { version_m2: { last_request_id: request.response.requestId } });

        console.log("on_carecontext response -------------------", response)

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

//https://webhook.site/2086641f-2f45-4341-8d8d-63ff0797f61f/api/v3/consent/request/hip/notify
export const hipNotifiy = async (req: any, res: any) => {
    try {
        let postData = req.body;
        let auth = req.headers['authorization']

        console.log("hipNotifiy /api/v3/consent/request/hip/notify callback start here ----------------------------------")


        console.log("hipNotifiy-1", postData)

        let consentId = postData.notification.consentId;
        let abhaAddress = postData.notification.consentDetail.patient.id;

        await HealthRecordModel.updateOne({ $or: [{ access_token: auth, hid_address: abhaAddress }] }, {
            $set: {
                "version_m2.notify_callback_response": postData
            }
        });


        const latestRecord: any = await HealthRecordModel.findOne({
            hid_address: abhaAddress
        }).sort({ updatedAt: -1 }).limit(1);

        console.log("hipNotifiy-2 Response ", postData);

        if (latestRecord) {

            console.log("hipNotifiy-2  sucess authorization  ", auth);
            await sentRequestNotify(res, consentId, latestRecord.last_request_id, auth);
        } else {
            console.log("hipNotifiy-2  error block ");
            return res
                .status(200)
                .json({ status: 200, message: "Request ID not found in our database." });
        }

    } catch (error: any) {
        console.log("web hook hipNotifiy error Response", error)
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


//https://dev.abdm.gov.in/api/hiecm/consent/v3/request/hip/on-notify
export const sentRequestNotify = async (res: any, consentId: any, reqId: any, token: any) => {
    try {
        console.log("Step-5")

        let postData = {
            acknowledgement: {
                status: "OK",
                consentId: consentId
            },
            response: {
                requestId: reqId
            }
        }

        let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABDM_BASE_URL}/hiecm/consent/v3/request/hip/on-notify`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": "Bearer " + token //req.headers['authorization']
                },
            }
        );

        console.log("response data from  /hiecm/consent/v3/request/hip/on-notifyon-notify ", response.data);

        if (response.status == 202 || response.status == 200) {
            // await careContext(req, res, response.data.linkToken);
            return res.status(200).json({ "URL": "api/hiecm/consent/v3/request/hip/on-notify", "status": "Success", "message": "Success" })
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

// Next step received the callback 
// api/v3/hip/health-information/request
export const getTranscationId = async (req: any, res: any) => {
    try {
        console.log("Step-6 getTranscationId api request ", req.body);
        let input = req.body;

        let requestId = req.headers['request-id'];

        let postData = {
            hiRequest: {
                transactionId: input.transactionId,
                sessionStatus: "ACKNOWLEDGED"
            },
            response: {
                requestId: requestId
            }
        }

        //let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABDM_BASE_URL}/hiecm/data-flow/v3/health-information/hip/on-request`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': requestId,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": req.headers['authorization']
                },
            }
        );
        console.log("Step-7 hiecm/data-flow/v3/health-information/hip/on-request api response ", response.data);

        if (response.status == 202 || response.status == 200) {
            await HealthRecordModel.updateOne(
                { access_token: req.headers['authorization'] },
                {
                    $set: {
                        "version_m2.transaction_id": input.transactionId
                    }
                }
            );
            await callingDataPushUrl(req, res, input.hiRequest.dataPushUrl);
            return res.status(200).json({ "URL": "/hiecm/data-flow/v3/health-information/hip/on-request", "status": "Success", "message": "Note: Status get updated in data_flow_request table in db as ACKNOWLEDGED" })
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



export const callingDataPushUrl = async (req: any, res: any, dataPushUrl: string) => {
    try {

        console.log("Step-8 callingDataPushUrl api request ", req.body);
        let input = req.body;

        let requestId = req.headers['request-id'];

        const latestRecord: any = await HealthRecordModel.findOne({
            transaction_id: input.transactionId
        }).sort({ updatedAt: -1 }).limit(1);

        let postData = {
            pageNumber: 0,        // Current page number.
            pageCount: 1,         //Total number of pages.
            transactionId: input.transactionId,
            entries: [
                {
                    content: "chnage me",  //chnage me
                    media: "application/fhir+json",
                    checksum: "string",
                    careContextReference: latestRecord.notify_callback_response?.notification?.careContexts.map((v: any) => v.careContextReference)[0]
                }
            ],
            keyMaterial: {
                cryptoAlg: "ECDH",
                curve: "Curve25519",
                dhPublicKey: {
                    expiry: "2028-10-03", //chnage me
                    parameters: "Curve25519",
                    keyValue: "X509"
                },
                "nonce": "nonce" //chnage me
            }
        }

        //let random32String = generateUID();
        const response = await axios.post(
            dataPushUrl,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': requestId,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-CM-ID': 'sbx',
                    "Authorization": req.headers['authorization']
                },
            }
        );
        console.log("Step-9 callingDataPushUrl api response ---- ", response.data);
        if (response.status == 202 || response.status == 200) {

            return res.status(200).json({ "URL": "dataPushUrl", "status": "Success", "message": "dataPushUrl api submited" })
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

///