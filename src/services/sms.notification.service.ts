import axios from "axios";
import { AbdmTokenService } from "./abdm.token.service";
import {
  generateUID,
  facilityId,
  facilityName,
  X_CM_ID,
} from "../utils/constant";

export const sendSmsNotification = async (
  mobile: string,
): Promise<boolean> => {
  try {
    if (!mobile) {
      console.log("SmsNotification: No mobile number provided");
      return false;
    }

    const authToken = await AbdmTokenService.getToken();
    const requestId = generateUID();

    const payload = {
      phoneNo: mobile,
      hip: {
        name: facilityName,
        id: facilityId,
      },
    };

    const response = await axios.post(
      `${process.env.ABDM_BASE_URL}/hiecm/v0.5/patients/sms/notify`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "REQUEST-ID": requestId,
          TIMESTAMP: new Date().toISOString(),
          "X-CM-ID": X_CM_ID,
          Authorization: authToken,
        },
      },
    );

    console.log("SmsNotification: SMS notify sent, status:", response.status);
    return response.status === 200 || response.status === 202;
  } catch (error: any) {
    console.error(
      "SmsNotification: Error sending SMS notify",
      error.response?.data || error.message,
    );
    return false;
  }
};

export const handleSmsOnNotify = (body: any): void => {
  console.log("SmsNotification: on-notify received", JSON.stringify(body));

  if (body.error) {
    console.error("SmsNotification: ABDM reported error", body.error);
  } else {
    console.log(
      "SmsNotification: SMS sent successfully, requestId:",
      body.response?.requestId,
    );
  }
};

export const SmsNotificationService = {
  sendSmsNotification,
  handleSmsOnNotify,
};

export default SmsNotificationService;
