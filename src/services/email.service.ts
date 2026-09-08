import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
}

const getEmailConfig = (): EmailConfig => ({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
  from: process.env.SMTP_FROM || "Pran.ai <noreply@pran.ai>",
});

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    const config = getEmailConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth.user && config.auth.pass ? config.auth : undefined,
    });
  }
  return transporter;
};

interface PasswordResetEmailParams {
  to: string;
  userName: string;
  resetToken: string;
  expiryMinutes: number;
}

interface OtpEmailParams {
  to: string;
  userName: string;
  otp: string;
  expiryMinutes: number;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const generatePasswordResetEmail = (
  params: PasswordResetEmailParams,
): { subject: string; html: string; text: string } => {
  const frontendUrl =
    process.env.FRONTEND_RESET_URL || "http://localhost:3000/reset-password";
  const resetUrl = `${frontendUrl}?token=${params.resetToken}`;

  const subject = "Password Reset Request - Pran AI";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6;">
  <div style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 28px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Pran AI Hospital Portal</h1>
    </div>
    <div style="padding: 36px 32px; color: #374151; line-height: 1.6;">
      <h2 style="margin-top: 0; color: #111827; font-size: 20px;">Password Reset Request</h2>
      <p style="font-size: 15px;">Hello ${params.userName || "User"},</p>
      <p style="font-size: 15px;">We received a request to reset the password for your account. Click the button below to set a new password:</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${resetUrl}" style="background-color: #0f766e; color: #ffffff; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">Reset Password</a>
      </div>
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; margin-bottom: 24px; font-size: 14px; color: #92400e;">
        <strong>Notice:</strong> This link is single-use and will expire in ${params.expiryMinutes} minutes. If you did not request a password reset, you can safely ignore this email.
      </div>
      <p style="font-size: 13px; color: #6b7280; word-break: break-all;">If the button doesn't work, copy and paste this link into your browser:<br/><a href="${resetUrl}" style="color: #0f766e;">${resetUrl}</a></p>
    </div>
    <div style="background-color: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
      <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Pran AI Hospital System. All rights reserved.</p>
      <p style="margin: 0;">This is an automated system email. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Password Reset Request - Pran AI

Hello ${params.userName || "User"},

We received a request to reset your password. Use the link below to reset your password:

${resetUrl}

This link will expire in ${params.expiryMinutes} minutes.

If you did not request this password reset, please ignore this email.
  `.trim();

  return { subject, html, text };
};

const generateOtpEmail = (
  params: OtpEmailParams,
): { subject: string; html: string; text: string } => {
  const subject = "Your Password Reset OTP - Pran AI";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6;">
  <div style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 28px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Pran AI Hospital Portal</h1>
    </div>
    <div style="padding: 36px 32px; color: #374151; line-height: 1.6;">
      <h2 style="margin-top: 0; color: #111827; font-size: 20px;">Password Reset OTP</h2>
      <p style="font-size: 15px;">Hello ${params.userName || "User"},</p>
      <p style="font-size: 15px;">We received a request to reset the password for your account. Use the following One-Time Password (OTP) to proceed:</p>
      <div style="text-align: center; margin: 28px 0;">
        <div style="background-color: #f0fdf4; color: #166534; padding: 16px 36px; border-radius: 8px; font-weight: 700; font-size: 32px; letter-spacing: 6px; display: inline-block; border: 2px dashed #16a34a;">
          ${params.otp}
        </div>
      </div>
      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; margin-bottom: 24px; font-size: 14px; color: #92400e;">
        <strong>Security Notice:</strong> This OTP is valid for ${params.expiryMinutes} minutes. Do not share this code with anyone, including hospital administration.
      </div>
    </div>
    <div style="background-color: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
      <p style="margin: 0 0 6px 0;">© ${new Date().getFullYear()} Pran AI Hospital System. All rights reserved.</p>
      <p style="margin: 0;">This is an automated system email. Please do not reply.</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Password Reset OTP - Pran AI

Hello ${params.userName || "User"},

We received a request to reset your password. Use the following OTP to reset your password:

OTP: ${params.otp}

This OTP is valid for ${params.expiryMinutes} minutes.

If you did not request this password reset, please ignore this email.
  `.trim();

  return { subject, html, text };
};

export const sendPasswordResetEmail = async (
  params: PasswordResetEmailParams,
): Promise<SendEmailResult> => {
  try {
    const config = getEmailConfig();

    if (!config.auth.user || !config.auth.pass) {
      console.warn(
        `[EMAIL_DEV_MODE] SMTP not configured. Password Reset Token for ${params.to}: ${params.resetToken}`,
      );
      return {
        success: true,
        messageId: `dev-reset-token-${Date.now()}`,
      };
    }

    const transporterInstance = getTransporter();
    const content = generatePasswordResetEmail(params);

    const info = await transporterInstance.sendMail({
      from: config.from,
      to: params.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("[EMAIL_SEND_ERROR] Failed to send password reset email:", error?.message || error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
};

export const sendOtpEmail = async (
  params: OtpEmailParams,
): Promise<SendEmailResult> => {
  try {
    const config = getEmailConfig();

    if (!config.auth.user || !config.auth.pass) {
      console.warn(
        `[EMAIL_DEV_MODE] SMTP not configured. OTP for ${params.to}: ${params.otp}`,
      );
      return {
        success: true,
        messageId: `dev-otp-${Date.now()}`,
      };
    }

    const transporterInstance = getTransporter();
    const content = generateOtpEmail(params);

    const info = await transporterInstance.sendMail({
      from: config.from,
      to: params.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });

    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("[EMAIL_SEND_ERROR] Failed to send OTP email:", error?.message || error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
};

export const verifyEmailConfig = async (): Promise<boolean> => {
  try {
    const config = getEmailConfig();
    if (!config.auth.user || !config.auth.pass) {
      console.warn("[EMAIL_SERVICE] SMTP credentials missing — running in simulated mode");
      return false;
    }

    const transporterInstance = getTransporter();
    await transporterInstance.verify();
    console.log("[EMAIL_SERVICE] SMTP connection successfully verified");
    return true;
  } catch (error: any) {
    console.error("[EMAIL_SERVICE] SMTP verification failed:", error?.message || error);
    return false;
  }
};
