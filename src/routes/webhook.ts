import { Router } from "express";
import { healthInformation, hipNotifiy, linkTokenGeneration, onCarecontext } from "../controllers/v2/webhook.controller";
import { consentOnFetchCallback, requestOnInitCallback } from "../controllers/v3/webhook.controller";

const webook = Router();

webook.post("/api/v3/hip/token/on-generate-token", linkTokenGeneration);


// Calback url M2 Callback URL don't confuse V3
webook.post("/api/v3/link/on_carecontext", onCarecontext); //api/v3/link/on_carecontext
webook.post("/api/v3/consent/request/hip/notify", hipNotifiy); //api/v3/consent/request/hip/notify
webook.post("/api/v3/hip/health-information/request", healthInformation) // to get the transcation id


// M3 Call back url 
webook.post("/api/v3/hiu/consent/request/on-init", requestOnInitCallback);
webook.post("/:requestid/api/v3/hiu/consent/on-fetch", consentOnFetchCallback); //http://localhost:3000/7e64fb5c-96a0-4585-9e1e-7c10ce8df7a5/api/v3/hiu/consent/on-fetch


export default webook;