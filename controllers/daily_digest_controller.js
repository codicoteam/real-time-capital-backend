"use strict";

const dailyDigestService = require("../services/daily_digest_service");
const { runDailyDigest } = require("../services/daily_digest_scheduler");

class DailyDigestController {
  /**
   * GET /api/v1/daily-digest/preview?date=YYYY-MM-DD
   * Returns the digest data without sending an email — lets admins see today's
   * (or a past day's) activity summary on demand, and lets us verify the numbers
   * before the 6pm send.
   */
  async preview(req, res) {
    try {
      const { date } = req.query;
      const referenceDate = date ? new Date(`${date}T12:00:00.000Z`) : new Date();
      if (isNaN(referenceDate.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid date" });
      }
      const digest = await dailyDigestService.getDigestData(referenceDate);
      res.status(200).json({ success: true, message: "Digest preview generated", data: digest });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to generate digest preview",
      });
    }
  }

  /**
   * POST /api/v1/daily-digest/send-now
   * Manually triggers today's digest email immediately (super admin only) —
   * for testing, or to resend if the 6pm run was missed.
   */
  async sendNow(req, res) {
    try {
      const result = await runDailyDigest();
      res.status(200).json({
        success: true,
        message: `Digest sent to ${(result.sent_to || []).length} admin(s)`,
        data: { sent_to: result.sent_to },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message || "Failed to send digest",
      });
    }
  }
}

module.exports = new DailyDigestController();
