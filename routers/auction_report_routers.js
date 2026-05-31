// routes/auction_report_routes.js
"use strict";

const express = require("express");
const router = express.Router();
const auctionReportController = require("../controllers/auction_report_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: AuctionReport
 *   description: Auction & bid financial reporting
 */

/**
 * @swagger
 * /api/v1/auction-report:
 *   get:
 *     summary: Get auction financial report for a date range (admin only)
 *     tags: [AuctionReport]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start of reporting period (ISO format, e.g. 2024-04-12)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End of reporting period (ISO format, e.g. 2024-05-01)
 *     responses:
 *       200:
 *         description: Auction financial report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Auction financial report generated successfully.
 *                 data:
 *                   type: object
 *                   properties:
 *
 *                     period:
 *                       type: object
 *                       properties:
 *                         start_date:
 *                           type: string
 *                           format: date-time
 *                         end_date:
 *                           type: string
 *                           format: date-time
 *
 *                     financial_summary:
 *                       type: object
 *                       description: >
 *                         Key financial KPIs. All monetary values in USD rounded to 2 d.p.
 *                         Only covers auctions whose asset is in status "auction" or "sold".
 *                         Pawned/redeemed assets (loan paid) are EXCLUDED.
 *                       properties:
 *                         total_auctions:
 *                           type: integer
 *                         live_auctions:
 *                           type: integer
 *                         closed_auctions:
 *                           type: integer
 *                         cancelled_auctions:
 *                           type: integer
 *                         draft_auctions:
 *                           type: integer
 *                         total_winning_bid_revenue:
 *                           type: number
 *                           description: Sum of winning_bid_amount across all closed auctions.
 *                         avg_winning_bid:
 *                           type: number
 *                         highest_winning_bid:
 *                           type: number
 *                         lowest_winning_bid:
 *                           type: number
 *                         total_bids_placed:
 *                           type: integer
 *                         unique_bidders:
 *                           type: integer
 *                         avg_bids_per_auction:
 *                           type: number
 *                         total_bid_value:
 *                           type: number
 *                           description: Sum of ALL bid amounts (not just winning).
 *                         avg_bid_amount:
 *                           type: number
 *                         disputed_bids:
 *                           type: integer
 *                         total_payments_received:
 *                           type: integer
 *                           description: Count of successful BidPayments.
 *                         total_payment_amount:
 *                           type: number
 *                           description: Sum of successful BidPayment amounts.
 *                         total_refunded:
 *                           type: number
 *                         pending_payments:
 *                           type: integer
 *                         total_assets_in_auction:
 *                           type: integer
 *                         total_assets_sold:
 *                           type: integer
 *                         total_declared_value:
 *                           type: number
 *                         total_evaluated_value:
 *                           type: number
 *                         value_recovery_rate_percent:
 *                           type: number
 *                           description: >
 *                             (total winning bid revenue / total evaluated value) × 100.
 *                             Indicates how well auctions recovered asset value.
 *
 *                     charts:
 *                       type: object
 *                       description: 5 chart datasets ready for Chart.js / Recharts.
 *                       properties:
 *                         auction_trend:
 *                           type: object
 *                           description: >
 *                             Chart 1 – Daily auctions created vs closed + revenue.
 *                             Use dual-axis bar+line chart.
 *                         bid_trend:
 *                           type: object
 *                           description: >
 *                             Chart 2 – Daily bids placed + total bid value + unique bidders.
 *                             Use dual-axis line chart.
 *                         revenue_trend:
 *                           type: object
 *                           description: >
 *                             Chart 3 – Daily payments collected + cumulative revenue.
 *                             Use line chart.
 *                         auctions_by_status:
 *                           type: object
 *                           description: >
 *                             Chart 4 – Auction count by status. Use doughnut/pie chart.
 *                         collateral_category_breakdown:
 *                           type: object
 *                           description: >
 *                             Chart 5 – Per collateral category: asset count,
 *                             evaluated value, winning revenue. Use grouped bar chart.
 *
 *                     breakdowns:
 *                       type: object
 *                       properties:
 *                         auctions_by_status:
 *                           type: object
 *                         payment_by_method:
 *                           type: object
 *                           description: Successful payment totals grouped by method.
 *                         bid_payment_status_split:
 *                           type: object
 *                           description: Count of bids by payment_status field.
 *                         top_auctions:
 *                           type: array
 *                           description: Top 10 auctions by winning bid amount.
 *
 *                     tables:
 *                       type: object
 *                       properties:
 *                         auctions:
 *                           type: array
 *                           description: >
 *                             All auctions in the period (auction-pipeline assets only).
 *                             Each entry includes asset details, winner profile
 *                             (name, email, phone, national_id), bid count,
 *                             highest bid, and payment totals.
 *       400:
 *         description: Bad request (invalid dates etc.)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       401:
 *         description: Unauthorized – missing or invalid token
 *       403:
 *         description: Forbidden – insufficient role
 */
router.get(
  "/",
  authMiddleware,
  auctionReportController.getAuctionReport.bind(auctionReportController),
);

/**
 * @swagger
 * /api/v1/auction-report/export/excel:
 *   get:
 *     summary: Export auction report as a detailed Excel workbook
 *     tags: [AuctionReport]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Excel file stream
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get(
  "/export/excel",
  authMiddleware,
  auctionReportController.exportAuctionReportExcel.bind(auctionReportController),
);

module.exports = router;
