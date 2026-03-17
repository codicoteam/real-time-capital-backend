// controllers/sms_controller.js
const { sendSmsWithMessage } = require("../utils/sms_utils");

class SmsController {
  /**
   * POST /sms – Send an SMS message
   */
  async sendSms(req, res) {
    try {
      const { phoneNumber, body } = req.body;

      // Validate required fields
      if (!phoneNumber || !body) {
        return res.status(400).json({
          success: false,
          error: "phoneNumber and body are required",
        });
      }

      const result = await sendSmsWithMessage(phoneNumber, body);

      res.status(200).json({
        success: true,
        data: {
          sid: result.sid,
          to: result.to,
          status: result.status,
        },
        message: "SMS sent successfully",
      });
    } catch (error) {
      console.error("SmsController error:", error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new SmsController();
