import { NextFunction, Request, Response, Router } from "express";
import { addDepartment, departmentList, updateDepartment } from "../controllers/department.controller";
import { add, listing, update } from "../controllers/hospital.controller";
import { login, logout, userProfile } from "../controllers/login.controller";
import { abhauserListing, userAdd, userListing, userNewAdd, userNotifyResponse, userUpdate } from "../controllers/user.controller";
import { tokenGeneration, userV2Onboard } from "../controllers/v2/abha.controller";
import { linkTokenGeneration } from "../controllers/v2/webhook.controller";
import { checkToken } from "../middlewares/user.authentication";
const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to the API");
});

router.get("/testing", (req: any, res: any) => {
  res.send("Welcome to the new API");
});
// onboarding Routes
router.post("/login", login)
router.get("/logout", checkToken, logout)
router.get("/profile", checkToken, userProfile)

//Hospital Routes
router.get("/hospital", checkToken, listing);
router.post("/hospital", checkToken, add);
router.put("/hospital/:id", checkToken, update);

//User Routes
router.get("/users", checkToken, userListing);
router.post("/user/add", checkToken, userAdd);
router.put("/user/:id", checkToken, userUpdate);

router.post("/user/new-add", userNewAdd);

// Department Routes
router.get("/departments", checkToken, departmentList);
router.post("/department", checkToken, addDepartment);
router.put("/department/:id", checkToken, updateDepartment);

//ABHA Routes
router.post("/registration", checkToken, userV2Onboard);
router.post("/token-generation", checkToken, tokenGeneration);
//router.post("/test-token", tokenGeneration1)


// get ABHA user information
router.get("/abha/user/listing", abhauserListing);
router.get("/abha/user/notify-response/:id", checkToken, userNotifyResponse);

//Webhook hit
router.post("/token/generate-token", checkToken, linkTokenGeneration);
//router.post("/v3/consent/request/hip/notify", hipNotifiy);

export default router;
