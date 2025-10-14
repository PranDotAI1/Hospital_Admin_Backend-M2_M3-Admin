import axios from "axios";
import { HealthRecordModel } from "../../models/HealthRecord";
import { CLIENT_ID, CLIENT_SECRET, GET_URL, GRANT_TYPE, STATUS_CODE, bridgeId, facilityId, facilityName, generateUID } from "../../utils/constant";
import { MSG } from "../../utils/msgs";
import { ENDPOINTS } from "../../utils/endpoints";
import { UserModel } from "../../models/User";

// M4 ONBOARDING
export const generateOTP = async (req: any, res: any) => {
    try {
        console.log("Step-1 M4 Start here -- generate token api call -----------")

        let data = await UserModel.findOne({ aadhaar: req.body.aadhaar });
        if (!req.body.aadhaar) {
            return res.status(STATUS_CODE.ERROR).json({ status: false, msg: "Aadhaar card can not blank" });
        }
        if (data == null) {
            await UserModel.insertOne({ aadhaar: req.body.aadhaar });
        }
        const params = {
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            grantType: GRANT_TYPE,
        };


        let url = process.env.M4_AUTH_BASE_URL + ENDPOINTS.M4_SESSION_API_URL;
        console.log("Step-2 M4 Auth URL", url)

        const response = await axios.post(
            `${url}`,
            params,
            {}
        );
        console.log("Step-3 M4 Auth API Response", response.data)
        if (response.data.accessToken) {
            await generateOtpViaAadharNumber(req, res, response.data.accessToken);
        } else {
            return res.status(response.status).json({ api_url: url, "status": response.status, "error": MSG.API_ERROR + response.data });
        }
    } catch (error: any) {
        console.log("M4 Auth API Error-1 catch block", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message });
        }
    }
};

// HPRID(Health care ID) Generate Aadhaar OTP via API Call
export const generateOtpViaAadharNumber = async (req: any, res: any, token: string) => {
    try {
        console.log("Step-1 M4 Genarete OTP via Aadhar Start here -----------")

        console.log("Step-1.1 M4 Genarete OTP Request Paramters -----------", req.body)

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_GENERATE_OTP_VIA_AADHAR;

        console.log("Step-2 M4 Genarete OTP via Aadhar URL", url)

        const response = await axios.post(
            `${url}`,
            { aadhaar: req.body.aadhaar },
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": "Bearer " + token
                },
            }
        );
        console.log("Step-3  M4 Genarete OTP API Status ", response.status)
        console.log("Step-4  M4 Genarete OTP API Data ", response.data)
        if (response.status == STATUS_CODE.SUCCESS) {
            let responseData = response.data;
            responseData.access_token = token;
            await UserModel.updateOne(
                { aadhaar: req.body.aadhaar },
                {
                    $set: {
                        "version_m4": responseData
                    }
                }
            );
            return res.status(response.status).json({ "status": response.status, "access_token": token, "message": "We have sent an OTP to the aadhaar linked mobile number " + responseData.mobileNumber, data: responseData });
        }
        else {
            return res.status(response.status).json({ "status": response.status, "error": MSG.API_ERROR + response.data });
        }

    } catch (error: any) {
        console.log("M4 OTP Generated API Error-1 catch block", error.response)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message });
        }
    }
}

// Verfiy OTP 
export const verifyOTP = async (req: any, res: any) => {
    try {
        let input = req.body;
        console.log("Step-1 M4 Verfiy OTP start here -----------")

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_VEFIRY_OTP;
        console.log("Step-2 M4 Verfiy OTP URL", url)

        let data = await UserModel.findOne({ aadhaar: input.aadhaar });

        let postData = {
            domainName: "@hpr.abdm",
            idType: "hpr_id",
            otp: input.otp,
            restrictions: "",
            txnId: data?.version_m4.txnId
        }


        let token = req.headers['authorization'] || req.headers['Authorization'] || data?.version_m4?.access_token

        if (!token || token == "") {
            return res.status(401).json({ "status": 403, "message": "Please send bearer access token in header" });
        }

        const response = await axios.post(
            `${url}`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": token
                },
            }
        );
        console.log("Step-3 M4  Verfiy OTP  API Response", response.data)
        if (response.status == STATUS_CODE.SUCCESS) {
            await checkHipExistance(req, res, token, data?.version_m4.txnId);
        } else {
            return res.status(response.status).json({ api_url: url, "status": response.status, "error": "invalid or exipred OTP" });
        }
    } catch (error: any) {
        console.log("M4 Auth API Error-1 catch block", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message });
        }
    }
};


export const checkHipExistance = async (req: any, res: any, token: string, txnId: string) => {
    try {
        console.log("Step-1 Check HIP existance start here -----------")

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_CHECK_HPID_EXISTANCE;

        let postData = {
            txnId: txnId,
            preverifiedCheck: true
        }
        const response = await axios.post(
            `${url}`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": token
                },
            }
        );
        console.log("Step-2 Check HIP existance  status ", response.status)
        console.log("Step-3 Check HIP existance Response", response.data)

        if (response.status == STATUS_CODE.SUCCESS) {

            const updateFields: any = {};
            for (const [key, value] of Object.entries(response.data)) {
                updateFields[`version_m4.${key}`] = value;
            }

            await UserModel.updateOne(
                { aadhaar: req.body.aadhaar },
                {
                    $set: updateFields
                }
            );
            return res.status(response.status).json({
                "status": response.status, "data": response.data,
            })
        } else {
            return res.status(response.status).json({ "status": response.status, "error": "This Hpid already exist" });
        }

    } catch (error: any) {
        console.log("M4 checkHipExistance API Error-1 catch block", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.response.data });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message });
        }
    }
}


// Verfiy  Mobile number 
export const verifyMobileNumber = async (req: any, res: any) => {
    try {
        let input = req.body;
        console.log("Step-1 M4 Verfiy Mobile  start here -----------")

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_VERFIY_MOBILE_NUMBER;
        console.log("Step-2 M4 Verfiy Mobile URL", url)

        let data = await UserModel.findOne({ aadhaar: input.aadhaar });

        if (!data) {
            return res.status(STATUS_CODE.NOT_FOUND).json({ "status": STATUS_CODE.NOT_FOUND, "message": "Aadhaar number not found" });
        }

        let token = req.headers['authorization'] || req.headers['Authorization'] || data?.version_m4?.access_token
        console.log("token", token)

        if (!token || token == "") {
            return res.status(401).json({ "status": 403, "message": "Please send bearer access token in header" });
        }

        let postData = {
            mobileNumber: input.mobileNumber,
            txnId: data?.version_m4.txnId
        }
        console.log("postData", postData)

        const response = await axios.post(
            `${url}`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": token
                },
            }
        );

        if (response.status == STATUS_CODE.SUCCESS) {
            return res.status(response.status).json({
                "status": response.status, "data": response.data,
            })
        } else {
            return res.status(response.status).json({ api_url: url, "status": response.status, "error": "Not verifed you mobile number" });
        }
    } catch (error: any) {
        console.log("M4 M4 Verfiy Error-1 catch block", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.message + " error", "message": "Please send bearer access token in header" });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message + " error" });
        }
    }
};



export const getSuggestionOfUsernameFromHprid = async (req: any, res: any) => {
    try {
        let input = req.body;
        console.log("Step-1 M4 Get suggestion user name  start here -----------")

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_GET_SUGGESTION_USERNAME_FROM_HPRID;
        console.log("Step-2 M4 Get suggestion user name URL", url)

        let data = await UserModel.findOne({ aadhaar: input.aadhaar });

        if (!data) {
            return res.status(STATUS_CODE.NOT_FOUND).json({ "status": STATUS_CODE.NOT_FOUND, "message": "Aadhaar number not found" });
        }

        let token = req.headers['authorization'] || req.headers['Authorization'] || data?.version_m4?.access_token
        console.log("token", token)

        if (!token || token == "") {
            return res.status(401).json({ "status": 403, "message": "Please send bearer access token in header" });
        }

        let postData = {
            txnId: data?.version_m4.txnId
        }
        console.log("postData", postData)

        const response = await axios.post(
            `${url}`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": token
                },
            }
        );

        if (response.status == STATUS_CODE.SUCCESS) {
            return res.status(response.status).json({
                "status": response.status, "data": response.data,
            })
        } else {
            return res.status(response.status).json({ api_url: url, "status": response.status, "error": "getting error from api" });
        }
    } catch (error: any) {
        console.log("M4 M4 Verfiy Error-1 catch block", error)
        if (error.response) {
            return res
                .status(error.response.status)
                .json({ status: error.response.status, error: error.message + " error", "message": "Please send bearer access token in header" });
        } else if (error.request) {
            return res.status(STATUS_CODE.SERVER_STOP).json({ status: error.response.status, error: MSG.SERVICE_UNAVAILABLE });
        } else {
            return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message + " error" });
        }
    }
};


export const createHprIdWithAadhaarOtp = async (req: any, res: any) => {
    try {
        let input = req.body;
        console.log("Step-1 M4 createHprIdWithAadhaarOtp start here -----------")

        let url = process.env.M4_API_BASE_URL + ENDPOINTS.M4_CREATE_PRE_VERFIED_HPRID;
        console.log("Step-2 M4 createHprIdWithAadhaarOtp  URL", url)

        let data: any = await UserModel.findOne({ aadhaar: input.aadhaar });
        if (!data) {
            return res.status(STATUS_CODE.NOT_FOUND).json({ "status": STATUS_CODE.NOT_FOUND, "message": "Aadhaar number not found" });
        }
        if (input.email == "" || input.firstName == "" || input.password == "" || !input.email || !input.firstName || !input.password) {
            return res.status(STATUS_CODE.ERROR).json({ "status": STATUS_CODE.ERROR, "message": "Please enter required fields email, firstName and password" });
        }


        let token = req.headers['authorization'] || req.headers['Authorization'] || data?.version_m4?.access_token

        if (!token || token == "") {
            return res.status(401).json({ "status": 403, "message": "Please send bearer access token in header" });
        }
        let postData: any = {
            idType: "hpr_id",
            domainName: "@hpr.abdm",
            email: input.email,
            firstName: input.firstName,
            middleName: input.middleName || "",
            lastName: input.lastName || "",
            password: input.password,
            profilePhoto: input.profilePhoto || "",
            txnId: data.txnId,
            hprId: "user@hpr.abdm",
            notifyUser: true,
            hpCategoryCode: 1,
            hpSubCategoryCode: 1
        }


        const response = await axios.post(
            `${url}`,
            postData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    "Authorization": token
                },
            }
        );

        if (response.status == STATUS_CODE.SUCCESS) {
            await UserModel.updateOne(
                { aadhaar: input.aadhaar },
                {
                    $set: response.data
                }
            );
            return res.status(response.status).json({
                status: response.status, data: response.data, msg: "HPRID created successfully"
            })
        } else {
            return res.status(response.status).json({ api_url: url, "status": response.status, "error": "getting error from api" });
        }
    } catch (error: any) {
        console.log("M4 M4 Verfiy Error-1 catch block", error)
        return res.status(STATUS_CODE.ERROR).json({ status: error.response.status, error: error.message + " error" });
    }
};