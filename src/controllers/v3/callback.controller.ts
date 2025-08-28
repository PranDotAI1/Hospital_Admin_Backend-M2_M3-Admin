import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";

// api/v3/hip/health-information/request
export const getConsetnRequestId = async (req: any, res: any) => {
    try {
        console.log("Step-1 getConsetnRequestId api request ", req.body);
        let input = req.body;

        let consentReqId = input.consentRequest.id;

        let requestId = req.headers['request-id'];

        let postData = {
            consentRequestId: consentReqId
        }

        //let random32String = generateUID();
        const response = await axios.post(
            `${process.env.ABDM_BASE_URL}/hiecm/consent/v3/request/status`,
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
        console.log("Step-2 hiecm/consent/v3/request/status api response ", response.data);

        if (response.status == 202 || response.status == 200) {
            await HealthRecordModel.updateOne(
                { access_token: req.headers['authorization'] },
                {
                    $set: {
                        transaction_id: input.transactionId
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