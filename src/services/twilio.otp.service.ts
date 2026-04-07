import twilio from "twilio";

const LOG_PREFIX = "[TWILIO_SMS]";

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

    console.log(`${LOG_PREFIX} Sending OTP SMS to ${to.slice(0, -4)}****`);

    const message = await client.messages.create({
      to,
      from,
      body: `${otp} is your OTP for linking health records with ${facility} via ABDM. Valid for 10 minutes. Do not share this code.`,
    });

    console.log(
      `${LOG_PREFIX} SMS sent. SID: ${message.sid}, Status: ${message.status}`,
    );

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

export default TwilioOtpService;
