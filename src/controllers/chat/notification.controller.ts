import { Request, Response } from "express";
import nodemailer from "nodemailer";
import { STATUS_CODE } from "../../utils/constant";

interface NotificationData {
  patientName?: string;
  doctorName?: string;
  departmentName?: string;
  appointmentDate?: string;
  slotTime?: string;
  appointmentNumber?: string;
  consultationFee?: number | string;
  hospitalName?: string;
  hospitalAddress?: string;
  hospitalPhone?: string;
  [key: string]: any;
}

const getEmailTransporter = () => {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";

  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    }),
    from: process.env.SMTP_FROM || '"Pran AI Hospital" <noreply@pran.ai>',
    hasAuth: Boolean(user && pass),
  };
};

const renderAppointmentEmailHtml = (data: NotificationData): string => {
  const hospital = data.hospitalName || "Pran AI Hospital";
  const patient = data.patientName || "Valued Patient";
  const doctor = data.doctorName || "Specialist Doctor";
  const department = data.departmentName || "General Consultation";
  const date = data.appointmentDate || "Scheduled Date";
  const slot = data.slotTime || "Scheduled Time";
  const aptNum = data.appointmentNumber || "N/A";
  const fee = data.consultationFee !== undefined ? `₹${data.consultationFee}` : "Applicable at counter";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%); padding: 32px 24px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">${hospital}</h1>
              <p style="color: #ccfbf1; margin: 8px 0 0 0; font-size: 15px;">Appointment Booking Confirmation</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 32px; color: #374151;">
              <p style="font-size: 16px; margin-top: 0;">Dear <strong>${patient}</strong>,</p>
              <p style="font-size: 15px; line-height: 1.6; color: #4b5563;">
                Your appointment has been successfully scheduled. Please review your booking details below:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 24px 0; padding: 20px;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; color: #64748b;">Appointment ID:</td>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 15px; font-weight: 600; text-align: right; color: #0f766e;">${aptNum}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; color: #64748b;">Doctor:</td>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 15px; font-weight: 600; text-align: right; color: #1e293b;">${doctor}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; color: #64748b;">Department:</td>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 15px; font-weight: 600; text-align: right; color: #1e293b;">${department}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; color: #64748b;">Date:</td>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 15px; font-weight: 600; text-align: right; color: #1e293b;">${date}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; color: #64748b;">Time Slot:</td>
                  <td style="padding: 8px 0; border-bottom: 1px dashed #cbd5e1; font-size: 15px; font-weight: 600; text-align: right; color: #1e293b;">${slot}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-size: 14px; color: #64748b;">Consultation Fee:</td>
                  <td style="padding: 8px 0; font-size: 15px; font-weight: 600; text-align: right; color: #1e293b;">${fee}</td>
                </tr>
              </table>
              <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 14px 16px; border-radius: 4px; font-size: 14px; color: #065f46; line-height: 1.5;">
                <strong>Important Instructions:</strong>
                <ul style="margin: 8px 0 0 0; padding-left: 20px;">
                  <li>Please arrive 15 minutes before your scheduled slot.</li>
                  <li>Carry any previous medical prescriptions or diagnostic reports.</li>
                  <li>Present your Appointment ID (<strong>${aptNum}</strong>) at the reception desk.</li>
                </ul>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
              <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} ${hospital}. All rights reserved.</p>
              <p style="margin: 0;">This is an automated appointment confirmation message.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
};

export const sendConfirmationEmail = async (
  recipient: string,
  data: NotificationData,
  customSubject?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const { transporter, from, hasAuth } = getEmailTransporter();
    const subject =
      customSubject ||
      `Appointment Confirmation - ${data.appointmentNumber || "Hospital"}`;
    const html = renderAppointmentEmailHtml(data);
    const text = `
Appointment Confirmation - ${data.hospitalName || "Pran AI Hospital"}
Patient: ${data.patientName || "Patient"}
Doctor: ${data.doctorName || "Doctor"}
Department: ${data.departmentName || "General"}
Date: ${data.appointmentDate}
Time: ${data.slotTime}
Appointment ID: ${data.appointmentNumber}
Fee: ${data.consultationFee !== undefined ? `₹${data.consultationFee}` : "N/A"}

Please arrive 15 minutes prior to your scheduled time.
    `.trim();

    if (!hasAuth) {
      console.log(
        `[NOTIFICATION_EMAIL_SIMULATED] To: ${recipient} | Subject: ${subject} | Appt: ${data.appointmentNumber}`,
      );
      return {
        success: true,
        messageId: `simulated-email-${Date.now()}`,
      };
    }

    const info = await transporter.sendMail({
      from,
      to: recipient,
      subject,
      html,
      text,
    });

    console.log(`[NOTIFICATION_EMAIL_SENT] MessageId: ${info.messageId} to ${recipient}`);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("[NOTIFICATION_EMAIL_ERROR]", error?.message || error);
    return { success: false, error: error.message };
  }
};

export const sendConfirmationSMS = async (
  mobile: string,
  data: NotificationData,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const cleanMobile = mobile.replace(/\D/g, "").slice(-10);
    const message = `Dear ${data.patientName || "Patient"}, your appointment with ${data.doctorName || "Doctor"} is confirmed for ${data.appointmentDate} at ${data.slotTime}. Appt ID: ${data.appointmentNumber}. Please arrive 15 mins prior.`;

    console.log(`[NOTIFICATION_SMS_SIMULATED] Mobile: ${cleanMobile} | Msg: ${message}`);

    return {
      success: true,
      messageId: `simulated-sms-${Date.now()}`,
    };
  } catch (error: any) {
    console.error("[NOTIFICATION_SMS_ERROR]", error?.message || error);
    return { success: false, error: error.message };
  }
};

export const sendConfirmationWhatsApp = async (
  mobile: string,
  data: NotificationData,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    const cleanMobile = mobile.replace(/\D/g, "").slice(-10);
    const whatsappRecipient = `whatsapp:+91${cleanMobile}`;
    const text = `*Appointment Confirmation*\nDear ${data.patientName || "Patient"},\nYour appointment with *${data.doctorName}* (${data.departmentName}) is confirmed.\n\n📅 *Date:* ${data.appointmentDate}\n⏰ *Time:* ${data.slotTime}\n🆔 *Appt ID:* ${data.appointmentNumber}\n\nPlease arrive 15 minutes before your slot.`;

    console.log(`[NOTIFICATION_WHATSAPP_SIMULATED] To: ${whatsappRecipient}\n${text}`);

    return {
      success: true,
      messageId: `simulated-whatsapp-${Date.now()}`,
    };
  } catch (error: any) {
    console.error("[NOTIFICATION_WHATSAPP_ERROR]", error?.message || error);
    return { success: false, error: error.message };
  }
};

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { recipient, channel = "email", data, message } = req.body;

    let result: { success: boolean; messageId?: string; error?: string };

    switch (channel.toLowerCase()) {
      case "email":
        result = await sendConfirmationEmail(recipient, data || {}, message);
        break;
      case "sms":
        result = await sendConfirmationSMS(recipient, data || {});
        break;
      case "whatsapp":
        result = await sendConfirmationWhatsApp(recipient, data || {});
        break;
      default:
        return res.status(STATUS_CODE.BAD_REQUEST).json({
          status: "error",
          success: false,
          message: `Unsupported notification channel '${channel}'. Supported: email, sms, whatsapp`,
        });
    }

    return res.status(STATUS_CODE.SUCCESS).json({
      status: result.success ? "success" : "error",
      success: result.success,
      channel,
      recipient,
      messageId: result.messageId,
      message: result.success
        ? `Confirmation notification successfully processed via ${channel}`
        : `Failed to deliver notification via ${channel}: ${result.error}`,
    });
  } catch (error: any) {
    console.error("[CHAT_NOTIFICATION_SEND_ERROR]", error?.message || error);
    return res.status(STATUS_CODE.ERROR).json({
      status: "error",
      success: false,
      message: process.env.NODE_ENV === "production" ? "Failed to send notification" : error.message,
    });
  }
};
