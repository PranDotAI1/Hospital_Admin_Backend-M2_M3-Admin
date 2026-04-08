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
import {
  ConsentArtefactModel,
  ConsentArtefactStatus,
} from "../models/ConsentArtefact";
import { PHRConsentArtefactModel } from "../models/PHRConsentArtefact";
import { ExternalHealthRecordModel } from "../models/ExternalHealthRecord";

export const setBridgeUrlOnStartup = async () => {
  try {
    if (!GET_URL) {
      console.log(
        "[STARTUP] ABDM_CALLBACK_URL is not set. Skipping bridge URL setup.",
      );
      return;
    }

    console.log(
      `[STARTUP] Starting ABDM Bridge URL Configuration -> ${GET_URL}`,
    );

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
      console.error(
        "[STARTUP] Failed to obtain ABDM access token for bridge configuration.",
      );
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
      { headers: bridgeHeaders },
    );

    if (bridgeResponse.status === 200 || bridgeResponse.status === 202) {
      console.log("[STARTUP] Successfully set ABDM Bridge URL.");
    } else {
      console.error(
        `[STARTUP] Failed to set bridge URL. Status: ${bridgeResponse.status}`,
        bridgeResponse.data,
      );
    }
  } catch (error: any) {
    console.error(
      "[STARTUP] Error configuring ABDM Bridge URL:",
      error.response?.data || error.message,
    );
  }
};

/**
 * Purge external health records whose consent artefact is no longer GRANTED.
 * Catches orphans left by missed revocation callbacks or race conditions.
 */
export const purgeRevokedExternalRecords = async () => {
  try {
    const allRecords =
      await ExternalHealthRecordModel.distinct("consentArtefactId");
    if (allRecords.length === 0) return;

    const grantedMain = await ConsentArtefactModel.distinct("artefactId", {
      artefactId: { $in: allRecords },
      status: ConsentArtefactStatus.GRANTED,
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gt: new Date() } },
      ],
    });
    const grantedPHR = await PHRConsentArtefactModel.distinct("artefactId", {
      artefactId: { $in: allRecords },
      status: ConsentArtefactStatus.GRANTED,
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gt: new Date() } },
      ],
    });
    const validIds = new Set([...grantedMain, ...grantedPHR]);
    const staleIds = allRecords.filter((id: string) => !validIds.has(id));

    if (staleIds.length > 0) {
      const result = await ExternalHealthRecordModel.deleteMany({
        consentArtefactId: { $in: staleIds },
      });
      console.log(
        `[STARTUP] Purged ${result.deletedCount} external records for ${staleIds.length} non-GRANTED/expired artefact(s)`,
      );
    } else {
      console.log("[STARTUP] No stale external health records found.");
    }
  } catch (error: any) {
    console.error(
      "[STARTUP] Error purging revoked external records:",
      error.message,
    );
  }
};
