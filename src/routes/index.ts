import { NextFunction, Request, Response, Router } from "express";
import { add, listing, update } from "../controllers/hospital.controller";
import { login, logout, userProfile } from "../controllers/login.controller";
import { userAdd, userListing, userUpdate } from "../controllers/user.controller";
import { checkToken } from "../middlewares/user.authentication";
const router = Router();

router.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Welcome to the API");
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


export default router;
