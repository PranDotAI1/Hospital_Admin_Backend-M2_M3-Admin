import { NextFunction, Request, Response, Router } from "express";
import { add, listing, update } from "../controllers/hospital.controller";
import { login, logout, userProfile } from "../controllers/login.controller";
import { userAdd, userListing, userUpdate } from "../controllers/user.controller";
import { addDepartment, departmentList, updateDepartment } from "../controllers/department.controller";
import { checkToken } from "../middlewares/user.authentication";
import { getLinkToken, tokenGeneration, tokenGeneration1 } from "../controllers/abha.controller";
import { hipNotifiy, linkTokenGeneration } from "../controllers/webhook.controller";
const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to the API");
});
//for testing purpose only
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

// Department Routes
router.get("/departments", departmentList);
router.post("/department", addDepartment);
router.put("/department/:id", checkToken, updateDepartment);

//ABHA Routes
router.post("/registration", getLinkToken);
router.post("/token-generation", tokenGeneration);
router.post("/test-token", tokenGeneration1)


//Webhook hit
router.post("/v3/hip/token/on-generate-token", linkTokenGeneration);
router.post("/v3/consent/request/hip/notify", hipNotifiy);

export default router;
