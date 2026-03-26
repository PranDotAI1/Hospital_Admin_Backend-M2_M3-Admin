import axios from "axios";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  GET_URL,
  GRANT_TYPE,
  generateUID,
  X_CM_ID,
} from "../utils/constant";
import { ENDPOINTS } from "../utils/endpoints";

export const setBridgeUrlOnStartup = async () => {
  try {
    if (!GET_URL) {
      console.log("[STARTUP] ABDM_CALLBACK_URL is not set. Skipping bridge URL setup.");
      return;
    }

    console.log(`[STARTUP] Starting ABDM Bridge URL Configuration -> ${GET_URL}`);

    const sessionParams = {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      grantType: GRANT_TYPE,
    };

    const sessionHeaders = {
      "Content-Type": "application/json",
      "REQUEST-ID": generateUID(),
      TIMESTAMP: new Date().toISOString(),
      "X-CM-ID": X_CM_ID || "sbx",
    };

    const sessionUrl =
      (process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in") +
      ENDPOINTS.GET_ABHA_SESSION.trim();

    const sessionResponse = await axios.post(sessionUrl, sessionParams, {
      headers: sessionHeaders,
    });

    const token = sessionResponse.data?.accessToken;

    if (!token) {
      console.error("[STARTUP] Failed to obtain ABDM access token for bridge configuration.");
      return;
    }

    const bridgeHeaders = {
      "Content-Type": "application/json",
      "REQUEST-ID": generateUID(),
      TIMESTAMP: new Date().toISOString(),
      "X-CM-ID": X_CM_ID || "sbx",
      Authorization: "Bearer " + token,
    };

    const bridgeUrl =
      (process.env.ABDM_BASE_URL || "https://dev.abdm.gov.in") +
      ENDPOINTS.SET_BRIDGE_URL.trim();

    const bridgeResponse = await axios.patch(
      bridgeUrl,
      { url: GET_URL },
      { headers: bridgeHeaders }
    );

    if (bridgeResponse.status === 200 || bridgeResponse.status === 202) {
      console.log("[STARTUP] Successfully set ABDM Bridge URL.");
    } else {
      console.error(
        `[STARTUP] Failed to set bridge URL. Status: ${bridgeResponse.status}`,
        bridgeResponse.data
      );
    }
  } catch (error: any) {
    console.error(
      "[STARTUP] Error configuring ABDM Bridge URL:",
      error.response?.data || error.message
    );
  }
};
