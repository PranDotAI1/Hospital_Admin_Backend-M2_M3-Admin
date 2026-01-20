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
  from: process.env.SMTP_FROM || "Hospital Admin <noreply@hospital.com>",
});

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    const config = getEmailConfig();
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
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

const generatePasswordResetEmail = (
  params: PasswordResetEmailParams,
): { subject: string; html: string; text: string } => {
  const frontendUrl =
    process.env.FRONTEND_RESET_URL || "http://localhost:3000/reset-password";
  const resetUrl = `${frontendUrl}?token=${params.resetToken}`;

  const subject = "Password Reset Request";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
</head>
<body style="margin: 0; padding: 0; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="background-color: #f4f7f6; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Pran Ai</h1>
      </div>
      
      <!-- Body -->
      <div style="padding: 40px 32px; color: #374151; line-height: 1.6;">
        <h2 style="margin-top: 0; color: #111827; font-size: 20px; font-weight: 600;">Password Reset Request</h2>
        
        <p style="margin-bottom: 24px; font-size: 16px;">Hello ${params.userName || "User"},</p>
        
        <p style="margin-bottom: 24px; font-size: 16px;">We received a request to reset the password for your account associated with this email address. If you made this request, please click the button below to verify your email and set a new password.</p>
        
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background-color: #0f766e; color: #ffffff; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(15, 118, 110, 0.2);">
            Reset Password
          </a>
        </div>
        
        <div style="background-color: #f3f4f6; border-left: 4px solid #cbd5e1; padding: 16px; margin-bottom: 24px; font-size: 14px; color: #4b5563;">
          <strong>Security Notice:</strong> This link will expire in ${params.expiryMinutes} minutes for your security. If you did not request a password reset, you can safely ignore this email.
        </div>
        
        <div style="font-size: 13px; color: #6b7280; margin-top: 32px; word-break: break-all;">
          <p>Or copy and paste this link into your browser:<br>
          <a href="${resetUrl}" style="color: #0f766e; text-decoration: underline;">${resetUrl}</a></p>
        </div>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        <p style="margin: 0 0 10px 0;">© ${new Date().getFullYear()} Hospital Admin System. All rights reserved.</p>
        <p style="margin: 0;">
          This is an automated message. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Password Reset Request - Hospital Admin

Hello ${params.userName || "User"},

We received a request to reset your password. 

Reset your password by visiting: ${resetUrl}

This link will expire in ${params.expiryMinutes} minutes.

If you didn't request this password reset, please ignore this email.
  `.trim();

  return { subject, html, text };
};

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export const sendPasswordResetEmail = async (
  params: PasswordResetEmailParams,
): Promise<SendEmailResult> => {
  try {
    const config = getEmailConfig();

    if (!config.auth.user || !config.auth.pass) {
      if (process.env.NODE_ENV === "development") {
        const frontendUrl =
          process.env.FRONTEND_RESET_URL ||
          "http://localhost:3000/reset-password";

        return {
          success: true,
          messageId: `dev-${Date.now()}`,
        };
      }

      return {
        success: false,
        error: "Email service not configured",
      };
    }

    const transporter = getTransporter();
    const emailContent = generatePasswordResetEmail(params);

    const info = await transporter.sendMail({
      from: config.from,
      to: params.to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

interface OtpEmailParams {
  to: string;
  userName: string;
  otp: string;
  expiryMinutes: number;
}

const generateOtpEmail = (
  params: OtpEmailParams,
): { subject: string; html: string; text: string } => {
  const subject = "Password Reset OTP - Hospital Admin";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP</title>
</head>
<body style="margin: 0; padding: 0; width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="background-color: #f4f7f6; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); overflow: hidden;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #0f766e 0%, #115e59 100%); padding: 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">Pran Ai</h1>
      </div>
      
      <!-- Body -->
      <div style="padding: 40px 32px; color: #374151; line-height: 1.6;">
        <h2 style="margin-top: 0; color: #111827; font-size: 20px; font-weight: 600;">Password Reset OTP</h2>
        
        <p style="margin-bottom: 24px; font-size: 16px;">Hello ${params.userName || "User"},</p>
        
        <p style="margin-bottom: 24px; font-size: 16px;">We received a request to reset the password for your account. Use the following OTP to verify your identity and reset your password:</p>
        
        <div style="text-align: center; margin: 32px 0;">
          <div style="background-color: #f3f4f6; color: #111827; padding: 16px 32px; border-radius: 6px; font-weight: 700; font-size: 32px; letter-spacing: 4px; display: inline-block; border: 2px dashed #0f766e;">
            ${params.otp}
          </div>
        </div>
        
        <div style="background-color: #f3f4f6; border-left: 4px solid #cbd5e1; padding: 16px; margin-bottom: 24px; font-size: 14px; color: #4b5563;">
          <strong>Security Notice:</strong> This OTP will expire in ${params.expiryMinutes} minutes. Do not share this code with anyone.
        </div>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        <p style="margin: 0 0 10px 0;">© ${new Date().getFullYear()} Hospital Admin System. All rights reserved.</p>
        <p style="margin: 0;">
          This is an automated message. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
Password Reset OTP - Hospital Admin

Hello ${params.userName || "User"},

We received a request to reset your password. Use the following OTP to reset your password:

OTP: ${params.otp}

This OTP will expire in ${params.expiryMinutes} minutes.

If you didn't request this password reset, please ignore this email.
  `.trim();

  return { subject, html, text };
};

export const sendOtpEmail = async (
  params: OtpEmailParams,
): Promise<SendEmailResult> => {
  try {
    const config = getEmailConfig();

    if (!config.auth.user || !config.auth.pass) {
      if (process.env.NODE_ENV === "development") {
        return {
          success: true,
          messageId: `dev-otp-${Date.now()}`,
        };
      }

      return {
        success: false,
        error: "Email service not configured",
      };
    }

    const transporter = getTransporter();
    const emailContent = generateOtpEmail(params);

    const info = await transporter.sendMail({
      from: config.from,
      to: params.to,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error("Failed to send OTP email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

export const verifyEmailConfig = async (): Promise<boolean> => {
  try {
    const config = getEmailConfig();
    if (!config.auth.user || !config.auth.pass) {
      console.warn("Email service not configured - using dev mode");
      return false;
    }

    const transporter = getTransporter();
    await transporter.verify();
    console.log(" Email service configured and ready");
    return true;
  } catch (error) {
    console.error(" Email service configuration error:", error);
    return false;
  }
};
