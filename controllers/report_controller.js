// controllers/report_controller.js
const reportService = require("../services/report_service");

class ReportController {
  /**
   * GET /report – Returns comprehensive system report with graphs and analytics.
   */
  async getReportData(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const result = await reportService.getReportData({ startDate, endDate });
      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      console.error("ReportController error:", error);
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new ReportController();
