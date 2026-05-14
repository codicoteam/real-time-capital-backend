// controllers/loan_report_controller.js
"use strict";

const loanReportService = require("../services/loan_dashboard_service");

class LoanReportController {
  /**
   * GET /api/v1/loan-report
   *
   * Query params:
   *   startDate  – ISO date string  (e.g. 2024-04-12)
   *   endDate    – ISO date string  (e.g. 2024-05-01)
   *
   * Returns a full loan financial report including:
   *  - Financial summary cards
   *  - 5 charts (disbursement trend, application trend, loans-by-status,
   *              interest revenue trend, collateral category breakdown)
   *  - Populated loan list
   *  - Populated loan application list
   */
  async getLoanReport(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const result = await loanReportService.getLoanReportData({
        startDate,
        endDate,
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      console.error("[LoanReportController] getLoanReport error:", error);
      return res.status(400).json({
        success: false,
        error: error.message || "Failed to generate loan report.",
      });
    }
  }
}

module.exports = new LoanReportController();
