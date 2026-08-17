import twilio from "twilio";
import axios from "axios";

const LOG_PREFIX = "[TWILIO_SMS]";
const F2S_LOG_PREFIX = "[FAST2SMS]";

let _client: ReturnType<typeof twilio> | null = null;

const getClient = () => {
  if (_client) return _client;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error(
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in environment variables",
    );
  }

  _client = twilio(accountSid, authToken);
  return _client;
};

const getFromNumber = (): string => {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) {
    throw new Error(
      "TWILIO_FROM_NUMBER must be set in environment variables (your Twilio phone number or messaging service SID)",
    );
  }
  return from;
};

const getFacilityName = (): string => {
  return process.env.FACILITY_NAME || "Pran AI Hospital";
};

export const toE164 = (mobile: string): string => {
  const digits = mobile.replace(/\D/g, "");

  if (digits.startsWith("91") && digits.length === 12) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (mobile.startsWith("+") && digits.length >= 10) {
    return `+${digits}`;
  }

  return `+91${digits}`;
};

/**
 * Generate a cryptographically random 6-digit OTP.
 */
export const generateOTP = (): string => {
  const crypto = require("crypto");
  const num = crypto.randomInt(100000, 999999);
  return num.toString();
};

export const sendOTP = async (
  mobile: string,
  otp: string,
): Promise<{ success: boolean; sid?: string; error?: string }> => {
  try {
    const client = getClient();
    const from = getFromNumber();
    const to = toE164(mobile);
    const facility = getFacilityName();
    const message = await client.messages.create({
      to,
      from,
      body: `${otp} is your OTP for linking health records with ${facility}. Valid for 10 minutes. Do not share this code.`,
    });
    return { success: true, sid: message.sid };
  } catch (error: any) {
    console.error(
      `${LOG_PREFIX} Failed to send SMS:`,
      error.message,
      error.code ? `(code: ${error.code})` : "",
    );
    return { success: false, error: error.message };
  }
};

export const TwilioOtpService = {
  generateOTP,
  sendOTP,
  toE164,
};

const getF2sApiKey = (): string => {
  const key = process.env.FAST2SMS_API_KEY;
  if (!key) {
    throw new Error("FAST2SMS_API_KEY must be set in environment variables");
  }
  return key;
};

export const sendOTPviaFast2SMS = async (
  mobile: string,
  otp: string,
): Promise<{ success: boolean; requestId?: string; error?: string }> => {
  try {
    const apiKey = getF2sApiKey();
    const facility = getFacilityName();

    // Fast2SMS expects a 10-digit local number (no country code)
    const digits = mobile.replace(/\D/g, "");
    const localNumber =
      digits.startsWith("91") && digits.length === 12
        ? digits.slice(2)
        : digits.slice(-10);

    const message = `${otp} is your OTP for linking health records with ${facility}. Valid for 10 minutes. Do not share this code.`;
    const response = await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: {
        authorization: apiKey,
        route: "q",
        message,
        language: "english",
        flash: 0,
        numbers: localNumber,
      },
    });

    if (response.data?.return === true) {
      const requestId = response.data?.request_id;
      return { success: true, requestId };
    } else {
      const errMsg = JSON.stringify(response.data);
      console.error(`${F2S_LOG_PREFIX} API returned failure: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  } catch (error: any) {
    console.error(
      `${F2S_LOG_PREFIX} Failed to send SMS:`,
      error.response?.data || error.message,
    );
    return { success: false, error: error.message };
  }
};

export const Fast2SmsOtpService = {
  generateOTP,
  sendOTP: sendOTPviaFast2SMS,
  toE164,
};

// ─── Unified provider (set SMS_PROVIDER=fast2sms to use Fast2SMS) ─────────────

/**
 * Sends an OTP using the provider selected by SMS_PROVIDER env variable.
 * SMS_PROVIDER=twilio   → uses Twilio (default)
 * SMS_PROVIDER=fast2sms → uses Fast2SMS Quick SMS (no DLT required)
 */
export const sendOTPUnified = async (
  mobile: string,
  otp: string,
): Promise<{
  success: boolean;
  sid?: string;
  requestId?: string;
  error?: string;
}> => {
  const provider = (process.env.SMS_PROVIDER || "twilio").toLowerCase();
  if (provider === "fast2sms") {
    return sendOTPviaFast2SMS(mobile, otp);
  }
  return sendOTP(mobile, otp);
};

export default TwilioOtpService;
