import axios from "axios";
import { GET_URL } from "../../utils/constant";
import { ENDPOINTS } from "../../utils/endpoints";

export const setBridgeUrlforTest = async (req: any, res: any) => {
    try {
        const { token, random32String } = req.body;
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
        if (response.status == 202 || response.status == 200) {
            //await registrationService(token, req, res, url);
            return res.status(response.status).json({ "status": "success" });
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "getting error from api" + response.data, step: 2 });
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