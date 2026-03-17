// controllers/email_controller.js
const { sendEmail } = require("../utils/emails_util");

class EmailController {
  /**
   * POST /email – Send an email message
   */
  async sendEmail(req, res) {
    try {
      const { to, subject, text, html } = req.body;

      // Validate required fields
      if (!to || !subject) {
        return res.status(400).json({
          success: false,
          error: "to and subject are required",
        });
      }

      // At least one of text or html must be provided
      if (!text && !html) {
        return res.status(400).json({
          success: false,
          error: "Either text or html content is required",
        });
      }

      const result = await sendEmail({ to, subject, text, html });

      res.status(200).json({
        success: true,
        data: {
          to: result?.to || to,
          subject: result?.subject || subject,
        },
        message: "Email sent successfully",
      });
    } catch (error) {
      console.error("EmailController error:", error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new EmailController();