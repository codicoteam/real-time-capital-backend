"use strict";

const loginActivityService = require("../services/login_activity_service");

class LoginActivityController {
  /**
   * GET /api/v1/login-activity
   */
  async list(req, res) {
    try {
      const { user_type, role, q, start, end, page = 1, limit = 25 } = req.query;
      const result = await loginActivityService.getLoginActivity(
        { user_type, role, q, start, end },
        page,
        limit
      );
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve login activity",
      });
    }
  }

  /**
   * GET /api/v1/login-activity/stats
   */
  async stats(req, res) {
    try {
      const result = await loginActivityService.getLoginStats();
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve login stats",
      });
    }
  }
}

module.exports = new LoginActivityController();
