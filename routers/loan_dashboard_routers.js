// routes/loan_report_routes.js
"use strict";

const express = require("express");
const router = express.Router();
const loanReportController = require("../controllers/loans_dashboard_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: LoanReport
 *   description: Loan & loan application financial reporting
 */

/**
 * @swagger
 * /api/v1/loan-report:
 *   get:
 *     summary: Get loan financial report for a date range (admin only)
 *     tags: [LoanReport]
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
 *         description: Loan financial report generated successfully
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
 *                   example: Loan financial report generated successfully.
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
 *                         Key financial KPIs for the period.
 *                         All monetary values are in USD rounded to 2 d.p.
 *                       properties:
 *                         total_loans_disbursed:
 *                           type: integer
 *                         total_principal_disbursed:
 *                           type: number
 *                         total_expected_repayable:
 *                           type: number
 *                         total_interest_on_books:
 *                           type: number
 *                           description: >
 *                             Total interest owed across ALL loans in the period
 *                             (expected_total_repayable - principal_amount).
 *                         total_collected_payments:
 *                           type: number
 *                         total_outstanding_balance:
 *                           type: number
 *                         actual_interest_earned:
 *                           type: number
 *                           description: >
 *                             Interest portion already collected from borrowers.
 *                         projected_remaining_interest:
 *                           type: number
 *                           description: >
 *                             Outstanding interest still owed on open loans.
 *                         projected_interest_from_applications:
 *                           type: number
 *                           description: >
 *                             Potential interest if all pipeline applications
 *                             are approved and disbursed.
 *                         projected_total_repayable_from_applications:
 *                           type: number
 *                         total_applications:
 *                           type: integer
 *                         total_requested_amount:
 *                           type: number
 *                         avg_loan_amount:
 *                           type: number
 *                         avg_interest_rate_percent:
 *                           type: number
 *
 *                     charts:
 *                       type: object
 *                       description: >
 *                         5 chart datasets ready for Chart.js / Recharts.
 *                       properties:
 *                         loan_disbursement_trend:
 *                           type: object
 *                           description: >
 *                             Chart 1 – Daily principal disbursed + interest on books
 *                             + number of loans. Use dual-axis bar+line chart.
 *                         application_trend:
 *                           type: object
 *                           description: >
 *                             Chart 2 – Daily application count by status (stacked bar)
 *                             + total requested amount (line, second axis).
 *                         loans_by_status:
 *                           type: object
 *                           description: >
 *                             Chart 3 – Loan count & breakdown by status.
 *                             Use doughnut / pie chart.
 *                         interest_revenue_trend:
 *                           type: object
 *                           description: >
 *                             Chart 4 – Daily payments received vs estimated
 *                             interest component. Use line chart.
 *                         collateral_category_breakdown:
 *                           type: object
 *                           description: >
 *                             Chart 5 – Loans vs applications grouped by collateral
 *                             category (principal / requested amounts + interest).
 *                             Use grouped bar chart.
 *
 *                     breakdowns:
 *                       type: object
 *                       description: Tabular breakdowns by status, collateral, repayment type.
 *
 *                     tables:
 *                       type: object
 *                       properties:
 *                         loans:
 *                           type: array
 *                           description: >
 *                             All loans in the period with customer name, email,
 *                             phone, national_id, profile_pic and key financials.
 *                         loan_applications:
 *                           type: array
 *                           description: >
 *                             All loan applications in the period with customer
 *                             profile data and requested amounts.
 *       400:
 *         description: Bad request (invalid dates, etc.)
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
router.get("/", authMiddleware, loanReportController.getLoanReport.bind(loanReportController));

/**
 * @swagger
 * /api/v1/loan-report/export/excel:
 *   get:
 *     summary: Export loan report as a detailed Excel workbook
 *     tags: [LoanReport]
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
router.get("/export/excel", authMiddleware, loanReportController.exportLoanReportExcel.bind(loanReportController));

module.exports = router;