import axios from "axios";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  GRANT_TYPE,
  X_CM_ID,
  generateUID,
} from "../utils/constant";
import { ENDPOINTS } from "../utils/endpoints";

/**
 * ABDM Gateway Session Token Service
 *
 * Manages the HIP's own session token for making outbound ABDM API calls.
 * The token is obtained from POST /hiecm/gateway/v3/sessions and cached
 * with automatic refresh before expiry.
 *
 * IMPORTANT: This token is different from:
 * - The internal JWT used for HIP authentication
 * - The linkToken used for care context linking
 * - The token ABDM sends in callback request headers
 */

interface AbdmTokenCache {
  accessToken: string;
  expiresAt: number; // Unix timestamp in ms
  tokenType: string;
}

let tokenCache: AbdmTokenCache | null = null;

// Refresh 60 seconds before actual expiry to avoid race conditions
const EXPIRY_BUFFER_MS = 60 * 1000;

/**
 * Get a valid ABDM session token, refreshing if needed.
 * Returns the full "Bearer <token>" string ready for Authorization header.
 */
export const getAbdmToken = async (): Promise<string> => {
  if (tokenCache && Date.now() < tokenCache.expiresAt - EXPIRY_BUFFER_MS) {
    return `Bearer ${tokenCache.accessToken}`;
  }
  return await refreshAbdmToken();
};

/**
 * Force refresh the ABDM session token.
 * Returns the full "Bearer <token>" string.
 */
export const refreshAbdmToken = async (): Promise<string> => {
  try {
    const baseUrl = process.env.ABDM_BASE_URL;
    if (!baseUrl) {
      throw new Error("ABDM_BASE_URL environment variable not set");
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      throw new Error(
        "ABDM_CLIENT_ID or ABDM_CLIENT_SECRET environment variable not set",
      );
    }

    // ABDM Gateway requires REQUEST-ID, TIMESTAMP, X-CM-ID (see Building HIP / Sandbox docs)
    const requestId = generateUID();
    const response = await axios.post(
      `${baseUrl}${ENDPOINTS.GET_ABHA_SESSION}`.trim(),
      {
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        grantType: GRANT_TYPE,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
        },
      },
    );

    const data = response.data;

    // ABDM returns: { accessToken, expiresIn (seconds), tokenType }
    const expiresInMs = (data.expiresIn || 1800) * 1000; // default 30 min

    tokenCache = {
      accessToken: data.accessToken,
      expiresAt: Date.now() + expiresInMs,
      tokenType: data.tokenType || "Bearer",
    };
    return `Bearer ${tokenCache.accessToken}`;
  } catch (error: any) {
    console.error(
      "AbdmTokenService: Failed to refresh token",
      error.response?.data || error.message,
    );
    // Clear cache on error so next call retries
    tokenCache = null;
    throw new Error(
      `Failed to obtain ABDM session token: ${error.response?.data?.message || error.message}`,
    );
  }
};

/**
 * Invalidate the cached token (e.g., after a 401 response).
 */
export const invalidateAbdmToken = (): void => {
  tokenCache = null;
};

/**
 * Check if we have a cached token (for health checks).
 */
export const hasValidToken = (): boolean => {
  return (
    tokenCache !== null &&
    Date.now() < tokenCache.expiresAt - EXPIRY_BUFFER_MS
  );
};

// Export as service object
export const AbdmTokenService = {
  getToken: getAbdmToken,
  refresh: refreshAbdmToken,
  invalidate: invalidateAbdmToken,
  hasValidToken,
};

export default AbdmTokenService;
