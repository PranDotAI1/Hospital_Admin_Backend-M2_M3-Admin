import { Router } from "express";
import { checkToken } from "../../middlewares/user.authentication";
import { createHprIdWithAadhaarOtp, generateOTP, getSuggestionOfUsernameFromHprid, verifyMobileNumber, verifyOTP } from "../../controllers/v4/v4.controller";

const V4router = Router();

V4router.post("/generate-otp", generateOTP);
V4router.post("/verify-otp", verifyOTP);
V4router.post("/verify-mobile", verifyMobileNumber);
V4router.post("/suggest-username", getSuggestionOfUsernameFromHprid);
V4router.post("/create-hprid", createHprIdWithAadhaarOtp);

export default V4router;