import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { HIP_TYPES, STATUS_CODE, facilityId, generateUID } from "../../utils/constant";
import { MSG } from "../../utils/msgs";
import { getFinalData } from "../../utils/prepareAndEncryptFhirPayload";

export const linkTokenGeneration = async (req: any, res: any) => {
    try {
        const baseUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        console.log("Link token generation start here ----------------------------------")
        console.log("URL-------------", baseUrl);
        //
        let postData = req.body;
        console.log("linkTokenGeneration-1 Request ", postData)
        const latestRecord = await HealthRecordModel.findOne({
            hid_address: postData.abhaAddress
        })
            .sort({ updatedAt: -1 })
            .limit(1);
        if (latestRecord) {
            console.log("LinkTokenGeneration Response success", postData);
            await HealthRecordModel.updateOne(
                { _id: latestRecord._id },
                {
                    $set: {
                        "version_m2.token_link": postData.linkToken,
                        "version_m2.last_request_id": postData.response.requestId,
                        "version_m2.updatedAt": new Date()
                    }
                }
            );
        } else {
            console.log("LinkTokenGeneration Response no data found", postData);
            // return res
            //     .status(200)
            //     .json({ status: 200, message: "No records found for this abhaAddress." });
        }
        await carecontext(req, res, postData.linkToken, latestRecord);
    } catch (error: any) {
        console.log("web hook error Response", error)
        if (error.response) {
            // return res
            //     .status(error.response.status)
            //     .json({ error: error.response.data });
        } else if (error.request) {
            return res.status(503).json({ error: 'Service unavailable' });
        } else {
            return res.status(500).json({ error: error.message });
        }
    }
}

//https://dev.abdm.gov.in/api/hiecm/hip/v3/link/carecontext
export const carecontext = async (req: any, res: any, linkToken: any, latestRecord: any) => {
    console.log("careContext api start")
    try {

        let postData = {
            abhaNumber: latestRecord.hidn_number,
            abhaAddress: latestRecord.hid_address,
            patient: [
                {
                    referenceNumber: latestRecord.hid_address,
                    display: latestRecord.abha_details.name,
                    careContexts: [
                        {
                            referenceNumber: latestRecord.hidn_number,
                            display: latestRecord.abha_details.name,
                        }
                    ],
                    hiType: "Prescription",
                    count: 1
                }
            ]
        }

        let random32String = generateUID();
        console.log("headers", {
            'Content-Type': 'application/json',
            'REQUEST-ID': random32String,
            'TIMESTAMP': new Date().toISOString(),
            'X-HIP-ID': facilityId, //'SBX_HIP_V2',
            'X-CM-ID': 'sbx',
            'X-LINK-TOKEN': linkToken,
            "Authorization": req.headers['authorization']
        })
        console.log("postDatapostData", postData)

        const response = await axios.post(
            `${process.env.ABDM_BASE_URL}/hiecm/hip/v3/link/carecontext`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-HIP-ID': facilityId, //'SBX_HIP_V2',
                    'X-CM-ID': 'sbx',
                    'X-LINK-TOKEN': linkToken,
                    "Authorization": req.headers['authorization']
                },
            }
        );

        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {
            let respo = response.data;
            return res.status(STATUS_CODE.SUCCESS).json({ "status": "Pending", "message": MSG.DATA_PROCESSING })
            //return res.status(STATUS_CODE.SUCCESS).json({ "status": response.status, "msg": "success" });
            // Update Request id
            //await HealthRecordModel.updateOne({ hid_address: respo.abhaAddress }, { last_request_id: respo.response.requestId });

        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response });
        }

    } catch (error: any) {
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


//https://webhook.site/2086641f-2f45-4341-8d8d-63ff0797f61f/api/v3/link/on_carecontext
export const onCarecontext = async (req: any, res: any) => {
    try {
        let request = req.body;

        console.log("on_carecontext callback and request data ---------------------", request)

        let response = await HealthRecordModel.updateOne(
            { hid_address: request.abhaAddress },
            {
                $set: {
                    "version_m2.last_request_id": request.response.requestId
                }
            }
        );;

        console.log("on_carecontext response -------------------", response)
        return res.status(STATUS_CODE.SUCCESS).json({ "status": "success" });


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
        let auth = req.headers['authorization'] || ""

        console.log("hipNotifiy /api/v3/consent/request/hip/notify callback start here ----------------------------------")


        console.log("hipNotifiy-1", postData)

        let consentId = postData?.notification?.consentId;
        let abhaAddress = postData.notification?.consentDetail?.patient?.id || "";

        console.log("auth ", auth);
        console.log("consentId ", consentId);
        console.log("abhaAddress ", abhaAddress);

        await HealthRecordModel.findOneAndUpdate(
            { hid_address: abhaAddress },
            {
                $set: {
                    "version_m2.notify_callback_response": postData,
                    "version_m2.consentId": consentId
                }
            },
            { sort: { updatedAt: -1 } } // sort option is valid here
        );

        const latestRecord: any = await HealthRecordModel.findOne({
            hid_address: abhaAddress
        }).sort({ updatedAt: -1 }).limit(1);

        console.log("hipNotifiy-2 Response ", postData);


        await contextNotifiy(req, res, latestRecord)

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

//https://dev.abdm.gov.in/api/hiecm/hip/v3/link/context/notify
export const contextNotifiy = async (req: any, res: any, latestRecord: any) => {
    console.log("contextNotifiy request data")
    try {
        let postData = {
            notification: {
                patient: {
                    id: latestRecord.hidn_number
                },
                careContext: {
                    patientReference: latestRecord.hidn_number,
                    careContextReference: "Episode11"
                },
                hiTypes: [HIP_TYPES[0]],
                date: new Date().toISOString(),
                hip: {
                    id: facilityId
                }
            }
        }
        let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABDM_BASE_URL}/hiecm/hip/v3/link/context/notify`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'REQUEST-ID': random32String,
                    'TIMESTAMP': new Date().toISOString(),
                    'X-HIP-ID': facilityId,
                    'X-CM-ID': 'sbx',
                    'X-LINK-TOKEN': latestRecord.version_m2.token_link,
                    "Authorization": req.headers['authorization']
                },
            }
        );
        console.log("response contextNotifiy", response.status, response.data);
        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {
            await onNotifiy(req, res, latestRecord.version_m2.consentId, latestRecord.version_m2.last_request_id)
        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response });
        }

    } catch (error: any) {
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


//https://dev.abdm.gov.in/api/hiecm/consent/v3/request/hip/on-notify
export const onNotifiy = async (req: any, res: any, consentId: any, requestId: any) => {
    try {
        console.log("onNotifiy function start here hiecm/consent/v3/request/hip/on-notify", consentId, requestId);

        console.log("Authorization", req.headers['authorization']);

        let postData = {
            acknowledgement: {
                status: "Ok",
                consentId: consentId
            },
            response: {
                requestId: requestId
            }
        }

        console.log("postdata", postData);

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
                    "Authorization": req.headers['authorization']
                },
            }
        );

        console.log("response onNotifiy", response.data);
        console.log("onNotifiy response status", response.status);

        if (response.status == STATUS_CODE.CREATED || response.status == STATUS_CODE.SUCCESS) {
            return res.status(STATUS_CODE.SUCCESS).json(response.data)
        } else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response });
        }

    } catch (error: any) {
        console.log("error onNotifiy /hiecm/consent/v3/request/hip/on-notify=============", error.response);
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

//////////////////// Implemented till here  ///////////////////////////////////////////////////////////



// Next step received the callback 
///
// ap/v3/hip/health-information/request
export const healthInformation = async (req: any, res: any) => {
    try {
        console.log("Step-6 healthInformation api request ", req.body);
        let input = req.body;

        let requestId = req.headers['request-id'];

        let consentId = input.hiRequest.consent.id

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
                { "version_m2.consentId": consentId },
                {
                    $set: {
                        "version_m2.transaction_id": input.transactionId
                    }
                }
            );
            await callingDataPushUrl(req, res, input.hiRequest.dataPushUrl, input.transactionId);
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

///////////////////////////
export const callingDataPushUrl = async (req: any, res: any, dataPushUrl: string, transactionId: any) => {
    try {

        console.log("Step-8 callingDataPushUrl api request ", req.body);
        //let input = req.body;

        let requestId = req.headers['request-id'];

        const latestRecord: any = await HealthRecordModel.findOne({
            transaction_id: transactionId
        }).sort({ updatedAt: -1 }).limit(1);

        // let postData = {
        //     pageNumber: 0,        // Current page number.
        //     pageCount: 1,         //Total number of pages.
        //     transactionId: input.transactionId,
        //     entries: [
        //         {
        //             content: "change me",  //chnage me
        //             media: "application/fhir+json",
        //             checksum: "string",
        //             careContextReference: latestRecord.notify_callback_response?.notification?.careContexts.map((v: any) => v.careContextReference)[0]
        //         }
        //     ],
        //     keyMaterial: {
        //         cryptoAlg: "ECDH",
        //         curve: "Curve25519",
        //         dhPublicKey: {
        //             expiry: "2028-10-03", //change me
        //             parameters: "Curve25519",
        //             keyValue: "X509"
        //         },
        //         "nonce": "nonce" //change me
        //     }
        // }

        let postData = getFinalData(transactionId);

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
        console.log("Step-9.1 callingDataPushUrl api status ---- ", response.status);
        if (response.status == 202 || response.status == 200) {
            await healthInformationNotify(req, res, latestRecord, requestId)
            //return res.status(200).json({ "URL": "dataPushUrl", "status": "Success", "message": "dataPushUrl api submited" })
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



//https://dev.abdm.gov.in/api/hiecm/data-flow/v3/health-information/notify
export const healthInformationNotify = async (req: any, res: any, latestRecord: any, requestId: any) => {
    try {

        console.log("Step-8 healthInformationNotify api request ", req.body);
        console.log("ULR-----------------hiecm/data-flow/v3/health-information/notify")

        let postData = {
            notification: {
                consentId: latestRecord.version_m2.consentId,
                transactionId: latestRecord.version_m2.healthInformation,
                doneAt: new Date().toISOString(),
                notifier: {
                    type: "HIP",
                    id: facilityId
                },
                statusNotification: {
                    sessionStatus: "OK",
                    hipId: facilityId,
                    statusResponses: [
                        {
                            careContextReference: "careContextReference ID",
                            hiStatus: "OK",
                            description: "description"
                        }
                    ]
                }
            }
        };

        //let random32String = generateUID();
        const response = await axios.post(`${process.env.ABDM_BASE_URL}/hiecm/data-flow/v3/health-information/notify`,
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
            return res.status(200).json({ "status": "Success", "message": "/health-information/notify api submited", "URL": "https://dev.abdm.gov.in/api/hiecm/data-flow/v3/health-information/notify" })
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