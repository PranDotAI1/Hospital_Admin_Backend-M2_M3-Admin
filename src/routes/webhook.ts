import { linkTokenGeneration } from "../controllers/webhook.controller";
import { Router } from "express";

const webook = Router();

webook.post("/v3/hip/token/on-generate-token", linkTokenGeneration);


export default webook;