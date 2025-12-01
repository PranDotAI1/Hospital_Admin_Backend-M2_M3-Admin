import { Router } from "express";
import { userV2Onboard } from "../../controllers/v2/abha.controller";
import { onCarecontext } from "../../controllers/v2/webhook.controller";
import { checkToken } from "../../middlewares/user.authentication";

const V2router = Router();

//ABHA Routes v2
V2router.post("/registration", checkToken, userV2Onboard); //// step-1
//V2router.post("/carecontext", carecontext); //// step-2



export default V2router;