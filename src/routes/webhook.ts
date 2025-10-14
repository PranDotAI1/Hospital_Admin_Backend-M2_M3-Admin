import { Router } from "express";
import { healthInformation, hipNotifiy, linkTokenGeneration, onCarecontext } from "../controllers/v2/webhook.controller";
import { consentOnFetchCallback, receivedConsentRequestStatus, requestOnInitCallback } from "../controllers/v3/webhook.controller";

const webook = Router();

webook.post("/api/v3/hip/token/on-generate-token", linkTokenGeneration);


// Calback url M2 Callback URL only-----------------------------------
webook.post("/api/v3/link/on_carecontext", onCarecontext); //api/v3/link/on_carecontext
webook.post("/api/v3/consent/request/hip/notify", hipNotifiy); //api/v3/consent/request/hip/notify
webook.post("/api/v3/hip/health-information/request", healthInformation) // to get the transcation id


// M3 Call back url 
webook.post("/api/v3/hiu/consent/request/on-init", requestOnInitCallback);
webook.post("/:requestid/api/v3/hiu/consent/on-fetch", consentOnFetchCallback); ///api/v3/hiu/consent/on-fetch
webook.post("/api/v3/hiu/consent/request/on-status", receivedConsentRequestStatus); // /api/v3/hiu/consent/request/on-status

export default webook;