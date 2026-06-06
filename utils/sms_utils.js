const twilio = require("twilio");
require("dotenv").config();

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

/**
 * Format Zimbabwe phone numbers
 * - 078xxxxxxx -> +26378xxxxxxx
 * - 26378xxxxxxx -> +26378xxxxxxx
 * - +26378xxxxxxx -> +26378xxxxxxx
 */
function formatPhoneNumber(phoneNumber) {
  let number = phoneNumber.trim();

  // Remove spaces
  number = number.replace(/\s+/g, "");

  if (number.startsWith("+263")) {
    return number;
  }

  if (number.startsWith("263")) {
    return `+${number}`;
  }

  if (number.startsWith("07")) {
    return `+263${number.substring(1)}`;
  }

  throw new Error("Invalid Zimbabwe phone number format");
}

/**
 * Send SMS
 * @param {string} phoneNumber
 * @param {string} body
 */
async function sendSmsWithMessage(phoneNumber, body) {
  const formattedNumber = formatPhoneNumber(phoneNumber);

  // Build the Twilio payload — prefer direct 'from' number for Zimbabwe
  // delivery reliability; fall back to messaging service if no number is set.
  const params = { body, to: formattedNumber };
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  } else if (process.env.TWILIO_PHONE_NUMBER) {
    params.from = process.env.TWILIO_PHONE_NUMBER;
  } else {
    throw new Error("No Twilio sender configured (set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID)");
  }

  try {
    const message = await client.messages.create(params);

    console.log(
      `[SMS] Sent to ${formattedNumber} | SID: ${message.sid} | Status: ${message.status}`
    );

    if (message.status === "failed" || message.status === "undelivered") {
      console.error(
        `[SMS] Delivery failed: ${message.errorMessage || "unknown"} (code ${message.errorCode})`
      );
    }

    return message;
  } catch (error) {
    const hint =
      error.code === 21211 ? "Invalid 'To' number format" :
      error.code === 21408 ? "Zimbabwe not enabled in Twilio Geo Permissions" :
      error.code === 21606 ? "'From' number cannot send SMS" :
      error.code === 20003 ? "Invalid Twilio credentials" :
      error.message;

    console.error(`[SMS] Failed to ${formattedNumber}: ${hint}`);
    throw error;
  }
}

module.exports = {
  sendSmsWithMessage,
};
