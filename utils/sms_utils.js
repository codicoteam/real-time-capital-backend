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
  try {
    const formattedNumber = formatPhoneNumber(phoneNumber);

    const message = await client.messages.create({
      body: body,
      to: formattedNumber,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    });

    console.log(`SMS sent to ${formattedNumber}: ${message.sid}`);
    return message;
  } catch (error) {
    console.error("SMS sending failed:", error.message);
    throw error;
  }
}

module.exports = {
  sendSmsWithMessage,
};
