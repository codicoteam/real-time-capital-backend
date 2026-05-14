// controllers/auction_report_controller.js
"use strict";

const auctionReportService = require("../services/auction_report_service");

class AuctionReportController {
  /**
   * GET /api/v1/auction-report
   *
   * Query params:
   *   startDate  – ISO date string  (e.g. 2024-04-12)
   *   endDate    – ISO date string  (e.g. 2024-05-01)
   *
   * Returns a full auction financial report including:
   *  - Financial summary cards (auctions, bids, payments, asset values)
   *  - 5 charts
   *  - Populated auction list (auction-pipeline assets only, pawned/redeemed excluded)
   */
  async getAuctionReport(req, res) {
    try {
      const { startDate, endDate } = req.query;
      const result = await auctionReportService.getAuctionReportData({
        startDate,
        endDate,
      });

      return res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      console.error("[AuctionReportController] getAuctionReport error:", error);
      return res.status(400).json({
        success: false,
        error: error.message || "Failed to generate auction report.",
      });
    }
  }
}

module.exports = new AuctionReportController();
