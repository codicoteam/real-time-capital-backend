// services/email_service.js
const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Generate professional HTML email template
 */
function generateEmailTemplate({ title, message, otpCode = null }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
          
          <!-- Official Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px 40px; text-align: center; border-bottom: 4px solid #6ba547;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold; letter-spacing: 2px;">Real Time Capital</h1>
              <p style="color: #6ba547; margin: 10px 0 0 0; font-size: 15px; font-weight: 600;">Professional Pawn Services</p>
            </td>
          </tr>
          
          <!-- Content Area -->
          <tr>
            <td style="padding: 40px 40px 30px 40px;">
              
              <!-- Title -->
              <h2 style="color: #1a1a1a; margin: 0 0 25px 0; font-size: 20px; font-weight: bold; border-bottom: 2px solid #6ba547; padding-bottom: 10px;">
                ${title}
              </h2>
              
              <!-- Message -->
              <div style="color: #333333; font-size: 15px; line-height: 1.6;">
                ${message}
              </div>
              
              <!-- OTP Section (if applicable) -->
              ${
                otpCode
                  ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                <tr>
                  <td>
                    <p style="color: #666666; font-size: 14px; margin: 0 0 10px 0;">Verification Code:</p>
                    <div style="background: linear-gradient(135deg, #f0f7ec 0%, #e8f5e0 100%); border: 2px solid #6ba547; border-radius: 8px; padding: 20px; text-align: center;">
                      <p style="color: #1a1a1a; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 0; font-family: 'Courier New', monospace;">
                        ${otpCode}
                      </p>
                    </div>
                    <p style="color: #666666; font-size: 12px; margin: 10px 0 0 0; font-style: italic;">
                      This code expires in 15 minutes. Do not share with anyone.
                    </p>
                  </td>
                </tr>
              </table>
              `
                  : ""
              }
              
            </td>
          </tr>
          
          <!-- Action Required Notice -->
          ${
            otpCode
              ? `
          <tr>
            <td style="padding: 0 40px 30px 40px;">
              <div style="background-color: #fff9e6; border-left: 4px solid #ffa500; padding: 15px; border-radius: 4px;">
                <p style="color: #8b5a00; font-size: 13px; margin: 0; font-weight: bold;">ACTION REQUIRED</p>
                <p style="color: #a56c00; font-size: 12px; margin: 5px 0 0 0;">
                  Please use the verification code above to complete your requested action.
                </p>
              </div>
            </td>
          </tr>
          `
              : ""
          }
          
          <!-- Official Footer -->
          <tr>
            <td style="background-color: #f5f5f5; padding: 30px 40px; border-top: 1px solid #d1d1d1;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 0 0 15px 0; border-bottom: 1px solid #d1d1d1;">
                    <p style="color: #1a1a1a; font-size: 14px; margin: 0 0 10px 0; font-weight: bold;">
                      Real Time Capital
                    </p>
                    <p style="color: #666666; font-size: 12px; margin: 0; line-height: 1.5;">
                      Professional Pawn Services • Secure & Trusted
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 15px 0 0 0;">
                    <p style="color: #888888; font-size: 11px; margin: 0; line-height: 1.4;">
                      This is an automated message from Real Time Capital.<br>
                      Please do not reply to this email. For assistance, contact our customer support team.<br>
                      © ${new Date().getFullYear()} Real Time Capital. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Send verification email for new user registration
 */
async function sendVerificationEmail({ to, fullName, otp }) {
  const subject = "Account Verification - Real Time Capital";
  const title = "Account Verification Required";
  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      Welcome to Real Time Capital. Your account registration has been received and requires verification.
    </p>
    <p style="margin: 0 0 15px 0;">
      To activate your account and start accessing our professional pawn services, please verify your email address using the verification code provided below.
    </p>
    <p style="margin: 0;">
      Upon verification, you will gain access to our pawn system, transaction management, and secure lending services.
    </p>
  `;

  const html = generateEmailTemplate({
    title,
    message,
    otpCode: otp,
  });

  await sendEmail({ to, subject, html });
}

/**
 * Send account deletion confirmation email
 */
async function sendDeleteAccountEmail({ to, fullName, otp }) {
  const subject = "Account Deletion Request - Real Time Capital";
  const title = "Account Deletion Confirmation";
  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      We have received a request to permanently delete your Real Time Capital account and all associated data.
    </p>
    <p style="margin: 0 0 15px 0;">
      <strong>Important:</strong> This action will remove your access to all pawn services, transaction history, and account records. All your personal information will be permanently deleted in accordance with our data retention policy.
    </p>
    <p style="margin: 0;">
      To proceed with account deletion, please confirm this action using the verification code below. If you did not initiate this request, please disregard this email and immediately contact our customer support team.
    </p>
  `;

  const html = generateEmailTemplate({
    title,
    message,
    otpCode: otp,
  });

  await sendEmail({ to, subject, html });
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail({ to, fullName, otp }) {
  const subject = "Password Reset - Real Time Capital";
  const title = "Password Reset Request";
  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      A password reset request has been initiated for your Real Time Capital account.
    </p>
    <p style="margin: 0 0 15px 0;">
      To reset your password and regain access to our pawn services, please use the verification code provided below.
    </p>
    <p style="margin: 0;">
      If you did not request a password reset, please ignore this email or contact our security team immediately.
    </p>
  `;

  const html = generateEmailTemplate({
    title,
    message,
    otpCode: otp,
  });

  await sendEmail({ to, subject, html });
}

/**
 * Generate formal document-style template for notifications
 */
function generateDocumentTemplate({ title, message, details = null }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
          
          <!-- Official Letterhead -->
          <tr>
            <td style="border-bottom: 3px solid #6ba547; padding: 30px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <h1 style="color: #1a1a1a; margin: 0; font-size: 26px; font-weight: bold; letter-spacing: 1px;">
                      Real Time Capital
                    </h1>
                    <p style="color: #333333; margin: 5px 0 0 0; font-size: 13px;">
                      OFFICIAL COMMUNICATION
                    </p>
                  </td>
                  <td align="right" style="vertical-align: top;">
                    <p style="color: #666666; margin: 0; font-size: 11px;">
                      ${new Date().toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Document Content -->
          <tr>
            <td style="padding: 35px 40px 25px 40px;">
              
              <!-- Document Title -->
              <h2 style="color: #1a1a1a; margin: 0 0 25px 0; font-size: 18px; font-weight: bold;">
                ${title}
              </h2>
              
              <!-- Main Content -->
              <div style="color: #333333; font-size: 14px; line-height: 1.7;">
                ${message}
              </div>
              
              <!-- Details Section -->
              ${details || ""}
              
            </td>
          </tr>
          
          <!-- Signature/Authority Section -->
          <tr>
            <td style="padding: 25px 40px 30px 40px; border-top: 1px solid #d1d1d1;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="color: #333333; font-size: 12px; margin: 0 0 5px 0; font-weight: bold;">
                      Real Time Capital Customer Service
                    </p>
                    <p style="color: #666666; font-size: 11px; margin: 0; line-height: 1.5;">
                      Professional Pawn Services • Customer Support • Account Management<br>
                      This communication is generated and authorized by Real Time Capital.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Confidential Footer -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 20px 40px; border-top: 4px solid #6ba547;">
              <p style="color: #cccccc; font-size: 10px; margin: 0; text-align: center; line-height: 1.4;">
                CONFIDENTIAL: This email and any attachments contain information which is confidential and may be privileged.<br>
                It is intended for the named recipient(s) only. If you are not the intended recipient, please notify the sender immediately.<br>
                Unauthorized use, disclosure, copying, or distribution is prohibited. © Real Time Capital.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Send transaction notification email
 */
async function sendTransactionNotificationEmail({ to, fullName, notification }) {
  const subject = `Transaction Notification: ${notification.subject}`;
  const title = notification.subject;

  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      ${notification.message}
    </p>
    ${
      notification.details
        ? `<p style="margin: 0 0 15px 0;">${notification.details}</p>`
        : ""
    }
    <p style="margin: 0;">
      Thank you for choosing Real Time Capital. We're committed to providing you with secure and professional pawn services.
    </p>
  `;

  let detailsHtml = "";
  if (notification.metadata) {
    detailsHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0; background-color: #f5f5f5; border: 1px solid #d1d1d1; border-radius: 8px;">
        <tr>
          <td style="padding: 15px;">
            <p style="color: #1a1a1a; font-size: 12px; margin: 0 0 10px 0; font-weight: bold;">
              TRANSACTION DETAILS:
            </p>
            ${Object.entries(notification.metadata)
              .map(
                ([key, value]) => `
              <p style="color: #666666; font-size: 12px; margin: 0 0 5px 0;">
                <span style="font-weight: bold; color: #333333;">${key}:</span> ${value}
              </p>
            `
              )
              .join("")}
          </td>
        </tr>
      </table>
    `;
  }

  const html = generateDocumentTemplate({
    title,
    message,
    details: detailsHtml,
  });

  await sendEmail({ to, subject, html });
}

/**
 * Send pawn transaction confirmation email
 */
async function sendPawnConfirmationEmail({ to, fullName, pawn }) {
  const subject = `Pawn Transaction Confirmation - ${pawn.reference}`;
  const title = "Pawn Transaction Confirmed";

  const message = `
    <p style="margin: 0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin: 0 0 15px 0;">
      This email confirms that Real Time Capital has received and processed your pawn transaction.
    </p>
    <p style="margin: 0;">
      Your transaction details are provided below. Please retain this confirmation for your records and bring valid identification when redeeming your item.
    </p>
  `;

  const detailsHtml = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0; background-color: #f5f5f5; border: 1px solid #d1d1d1; border-radius: 8px;">
      <tr>
        <td style="padding: 15px;">
          <p style="color: #1a1a1a; font-size: 12px; margin: 0 0 15px 0; font-weight: bold; border-bottom: 2px solid #6ba547; padding-bottom: 5px;">
            TRANSACTION DETAILS
          </p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding: 5px 0; color: #666666; font-size: 12px; width: 150px;">Transaction Reference:</td>
              <td style="padding: 5px 0; color: #1a1a1a; font-size: 12px; font-weight: bold;">${pawn.reference}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666666; font-size: 12px;">Transaction Date:</td>
              <td style="padding: 5px 0; color: #333333; font-size: 12px;">${pawn.date}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666666; font-size: 12px;">Item Type:</td>
              <td style="padding: 5px 0; color: #333333; font-size: 12px;">${pawn.type}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666666; font-size: 12px;">Status:</td>
              <td style="padding: 5px 0; color: #6ba547; font-size: 12px; font-weight: bold;">CONFIRMED</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  const html = generateDocumentTemplate({
    title,
    message,
    details: detailsHtml,
  });

  await sendEmail({ to, subject, html });
}

/**
 * Base email sending function
 */
async function sendEmail({ to, subject, text, html }) {
  const mailOptions = {
    from: `Real Time Capital <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: text || subject,
    html: html || `<p>${text || subject}</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}

/**
 * Send admin created account email
 */
async function sendAdminCreatedAccountEmail({
  to,
  fullName,
  webLoginUrl = process.env.WEB_LOGIN_URL,
  playStoreUrl = process.env.PLAYSTORE_URL,
}) {
  const subject = "Your Real Time Capital account has been created";
  const title = "Welcome to Real Time Capital — Your account is ready";

  const message = `
    <p style="margin:0 0 15px 0;">Dear ${fullName},</p>
    <p style="margin:0 0 15px 0;">
      An account has been created for you on <strong>Real Time Capital</strong> by our staff.
    </p>
    <p style="margin:0 0 15px 0;">
      You can sign in using the email that received this message.
      If you don't have a password yet, simply choose <em>Forgot password</em> on the sign-in page to set one securely.
    </p>
    <p style="margin:0 0 15px 0;">
      <a href="${webLoginUrl}" style="display:inline-block;padding:12px 24px;background-color:#6ba547;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">
        Sign in to Real Time Capital
      </a>
    </p>
    <p style="margin:0 0 15px 0;">Or get the app on Google Play:</p>
    <p style="margin:0;">
      <a href="${playStoreUrl}" style="display:inline-block;padding:12px 24px;background-color:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">
        Open on Google Play
      </a>
    </p>
  `;

  const html = generateDocumentTemplate({
    title,
    message,
    details: "",
  });

  await sendEmail({ to, subject, html });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendDeleteAccountEmail,
  sendPasswordResetEmail,
  sendTransactionNotificationEmail,
  sendPawnConfirmationEmail,
  generateEmailTemplate,
  generateDocumentTemplate,
  sendAdminCreatedAccountEmail
};