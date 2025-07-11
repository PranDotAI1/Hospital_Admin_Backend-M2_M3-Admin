import { HealthRecordModel } from "../models/HealthRecord";
import { generateUID } from "../utils/constant";
import axios from "axios";

export const linkTokenGeneration = async (req: any, res: any) => {
    try {

        //
        let postData = req.body;
        console.log("linkTokenGeneration-1", postData)
        const latestRecord = await HealthRecordModel.findOne({
            hid_address: postData.abhaAddress
        })
            .sort({ updatedAt: -1 })
            .limit(1);

        if (latestRecord) {
            await HealthRecordModel.updateOne(
                { _id: latestRecord._id },
                {
                    $set: {
                        token_link: postData.linkToken,
                        last_request_id: postData.response.requestId,
                        updatedAt: new Date()
                    }
                }
            );
            return res
                .status(200)
                .json({ status: 200, message: "Latest record updated." });
        } else {
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

export const hipNotifiy = async (req: any, res: any) => {
    try {
        let postData = req.body;

        console.log("hipNotifiy-1", postData)

        let consentId = postData.notification.consentId;
        let abhaAddress = postData.notification.consentDetail.patient.id;


        const latestRecord: any = await HealthRecordModel.findOne({
            hid_address: abhaAddress
        }).sort({ updatedAt: -1 }).limit(1);

        if (latestRecord) {
            let auth = req.headers['authorization']
            await sentRequestNotify(res, consentId, latestRecord.last_request_id, auth);
        } else {
            return res
                .status(200)
                .json({ status: 200, message: "No records found for this abhaAddress." });
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
            `${process.env.ABHA_URL2}/consent/v3/request/hip/on-notify`,
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

        if (response.status == 202 || response.status == 200) {
            // await careContext(req, res, response.data.linkToken);
            return res.status(200).json({ "status": "Success", "message": "Success" })
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