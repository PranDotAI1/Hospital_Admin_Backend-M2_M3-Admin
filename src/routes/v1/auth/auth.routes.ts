import { Router } from "express";
import { login, logout } from "../../../controllers/login.controller";
import { checkToken } from "../../../middlewares/user.authentication";
import { asyncHandler } from "../../../utils/asyncHandler";

const router = Router();

router.post("/login", asyncHandler(login));

router.get("/logout", checkToken, asyncHandler(logout));

export default router;
