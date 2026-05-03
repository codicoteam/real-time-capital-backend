const express = require("express");
const router = express.Router();

const customerDashboardController = require("../controllers/customerDashboard.controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// ─── Shared Swagger schema (reused across both endpoints) ────────────────────

/**
 * @swagger
 * components:
 *   schemas:
 *     DashboardProfile:
 *       type: object
 *       description: Full user model (OTP / password fields stripped)
 *       properties:
 *         _id:              { type: string }
 *         first_name:       { type: string }
 *         last_name:        { type: string }
 *         email:            { type: string }
 *         phone:            { type: string }
 *         roles:            { type: array, items: { type: string } }
 *         status:           { type: string }
 *         kyc_verification_status: { type: string }
 *         national_id_number: { type: string }
 *         date_of_birth:    { type: string, format: date }
 *         address:          { type: string }
 *         gender:           { type: string }
 *         marital_status:   { type: string }
 *         is_employed:      { type: boolean }
 *         employment_details: { type: object }
 *         next_of_kin:      { type: object }
 *         documents:        { type: array, items: { type: object } }
 *         profile_pic_url:  { type: string }
 *         fcm_tokens:       { type: array, items: { type: string } }
 *         created_at:       { type: string, format: date-time }
 *         updated_at:       { type: string, format: date-time }
 *
 *     DashboardSummary:
 *       type: object
 *       description: KPI cards – high-level snapshot of customer activity
 *       properties:
 *         credit_score:              { type: number }
 *         credit_rating:             { type: string, enum: [Excellent, Good, Fair, Poor] }
 *         total_loans:               { type: number }
 *         active_loans:              { type: number }
 *         overdue_loans:             { type: number }
 *         redeemed_loans:            { type: number }
 *         defaulted_loans:           { type: number }
 *         draft_loans:               { type: number }
 *         total_principal_borrowed:  { type: number }
 *         total_outstanding_balance: { type: number }
 *         total_loan_payments_made:  { type: number }
 *         total_applications:        { type: number }
 *         pending_applications:      { type: number }
 *         approved_applications:     { type: number }
 *         rejected_applications:     { type: number }
 *         total_assets:              { type: number }
 *         assets_pawned:             { type: number }
 *         assets_in_auction:         { type: number }
 *         assets_redeemed:           { type: number }
 *         auctions_participated:     { type: number }
 *         auctions_won:              { type: number }
 *         auctions_lost:             { type: number }
 *         total_bids_placed:         { type: number }
 *         paid_bids:                 { type: number }
 *         win_rate:                  { type: number }
 *         total_bid_payments_made:   { type: number }
 *         total_money_transacted:    { type: number }
 *         kyc_status:                { type: string }
 *         account_status:            { type: string }
 *         unread_notifications:      { type: number }
 *         is_flagged_as_debtor:      { type: boolean }
 *         debtor_record_count:       { type: number }
 *
 *     ActivityEntry:
 *       type: object
 *       description: Single entry in the recent-activity feed
 *       properties:
 *         category:  { type: string, enum: [loan, loan_application, loan_payment, bid, bid_payment, notification] }
 *         action:    { type: string }
 *         ref_no:    { type: string, nullable: true }
 *         ref_id:    { type: string, nullable: true }
 *         date:      { type: string, format: date-time }
 *
 *     DashboardReports:
 *       type: object
 *       properties:
 *         loan_report:
 *           type: object
 *           properties:
 *             total:                  { type: number }
 *             by_status:              { type: object }
 *             by_collateral_category: { type: object }
 *             financials:             { type: object }
 *             overdue_detail:         { type: array, items: { type: object } }
 *             loans_pending_approval: { type: number }
 *             loan_payment_history:   { type: array, items: { type: object } }
 *             loans:                  { type: array, items: { type: object } }
 *         auction_report:
 *           type: object
 *           properties:
 *             auctions_participated:   { type: number }
 *             auctions_won:            { type: number }
 *             auctions_lost:           { type: number }
 *             auctions_live:           { type: number }
 *             win_rate:                { type: number }
 *             total_bids:              { type: number }
 *             paid_bids:               { type: number }
 *             unpaid_bids:             { type: number }
 *             total_bid_amount_placed: { type: number }
 *             total_bid_payments_made: { type: number }
 *             won_auctions_detail:     { type: array, items: { type: object } }
 *             bid_history:             { type: array, items: { type: object } }
 *         payment_report:
 *           type: object
 *           properties:
 *             loan_payments:   { type: object }
 *             bid_payments:    { type: object }
 *             combined_total:  { type: number }
 *         application_report:
 *           type: object
 *           properties:
 *             total:                       { type: number }
 *             by_status:                   { type: object }
 *             by_collateral_category:      { type: object }
 *             by_source:                   { type: object }
 *             total_requested_amount:      { type: number }
 *             average_requested_amount:    { type: number }
 *             debtor_flagged_applications: { type: number }
 *             applications:                { type: array, items: { type: object } }
 *         asset_report:
 *           type: object
 *           properties:
 *             total:                   { type: number }
 *             by_status:               { type: object }
 *             by_category:             { type: object }
 *             total_declared_value:    { type: number }
 *             total_evaluated_value:   { type: number }
 *             assets_under_valuation:  { type: number }
 *             assets_in_auction:       { type: number }
 *             asset_list:              { type: array, items: { type: object } }
 *         notification_report:
 *           type: object
 *           properties:
 *             total:            { type: number }
 *             unread:           { type: number }
 *             read:             { type: number }
 *             by_type:          { type: object }
 *             by_priority:      { type: object }
 *             critical_unread:  { type: number }
 *             recent:           { type: array, items: { type: object } }
 *
 *     DashboardGraphs:
 *       type: object
 *       properties:
 *         loan_balance_history:         { type: array, items: { type: object } }
 *         loan_payments_over_time:      { type: array, items: { type: object } }
 *         bid_payments_over_time:       { type: array, items: { type: object } }
 *         combined_payments_over_time:  { type: array, items: { type: object } }
 *         bids_over_time:               { type: array, items: { type: object } }
 *         applications_over_time:       { type: array, items: { type: object } }
 *         application_status_breakdown: { type: array, items: { type: object } }
 *         auction_performance:          { type: object }
 *         asset_status_breakdown:       { type: array, items: { type: object } }
 *         loan_status_breakdown:        { type: array, items: { type: object } }
 *         notification_type_breakdown:  { type: array, items: { type: object } }
 *
 *     DashboardData:
 *       type: object
 *       properties:
 *         profile:            { $ref: '#/components/schemas/DashboardProfile' }
 *         summary:            { $ref: '#/components/schemas/DashboardSummary' }
 *         recent_activity:    { type: array, items: { $ref: '#/components/schemas/ActivityEntry' } }
 *         loans:              { type: array, items: { type: object } }
 *         loan_applications:  { type: array, items: { type: object } }
 *         assets:             { type: array, items: { type: object } }
 *         auctions:           { type: array, items: { type: object } }
 *         bids:               { type: array, items: { type: object } }
 *         bid_payments:       { type: array, items: { type: object } }
 *         loan_payments:      { type: array, items: { type: object } }
 *         notifications:      { type: array, items: { type: object } }
 *         debtor_records:     { type: array, items: { type: object } }
 *         reports:            { $ref: '#/components/schemas/DashboardReports' }
 *         graphs:             { $ref: '#/components/schemas/DashboardGraphs' }
 *
 *     DashboardResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string, example: "Customer dashboard data retrieved successfully" }
 *         data:    { $ref: '#/components/schemas/DashboardData' }
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: false }
 *         error:   { type: string }
 */

// ─── Tags ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   - name: Customer Dashboard (Staff)
 *     description: Staff endpoints – view any customer's full dashboard
 *   - name: Customer Dashboard (Self)
 *     description: Customer self-service – view own dashboard
 */

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/customer/dashboard/me:
 *   get:
 *     summary: Get own dashboard (customer self-service)
 *     description: >
 *       Authenticated customers can call this endpoint to retrieve their own
 *       full dashboard without supplying a userId. The identity is resolved
 *       from the JWT bearer token.
 *     tags: [Customer Dashboard (Self)]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *       401:
 *         description: Unauthorized – missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden – role not permitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       400:
 *         description: Bad request / service error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/dashboard/me",
  authMiddleware,
  requireRoles("customer"),
  customerDashboardController.getMyDashboard,
);

/**
 * @swagger
 * /api/v1/customer/dashboard/{userId}:
 *   get:
 *     summary: Get full dashboard for a specific customer (staff only)
 *     description: >
 *       Staff members can retrieve the complete dashboard for any customer by
 *       supplying the customer's MongoDB ObjectId as a path parameter.
 *       Returns the full user profile, KPI summary, recent-activity feed,
 *       all raw entity data, six aggregated reports, and eleven chart datasets.
 *     tags: [Customer Dashboard (Staff)]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           example: "664f1b2c8e4b2a001c8d9f01"
 *         description: MongoDB ObjectId of the target customer
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *             example:
 *               success: true
 *               message: "Customer dashboard data retrieved successfully"
 *               data:
 *                 profile:
 *                   _id: "664f1b2c8e4b2a001c8d9f01"
 *                   first_name: "Jane"
 *                   last_name: "Doe"
 *                   email: "jane@example.com"
 *                   roles: ["customer"]
 *                   status: "active"
 *                   kyc_verification_status: "verified"
 *                 summary:
 *                   credit_score: 720
 *                   credit_rating: "Good"
 *                   total_loans: 3
 *                   active_loans: 1
 *                   overdue_loans: 0
 *                   total_money_transacted: 4500
 *                   unread_notifications: 2
 *                   is_flagged_as_debtor: false
 *                 recent_activity:
 *                   - category: "loan_payment"
 *                     action: "Loan repayment made"
 *                     ref_no: "REF-20240501"
 *                     date: "2024-05-01T09:30:00.000Z"
 *                     amount: 250
 *                 reports:
 *                   loan_report:
 *                     total: 3
 *                     by_status: { active: 1, redeemed: 2 }
 *                     financials:
 *                       total_principal_borrowed: 3000
 *                       total_repaid: 2750
 *                       repayment_rate: 0.9167
 *                   payment_report:
 *                     combined_total: 4500
 *                 graphs:
 *                   auction_performance:
 *                     participated: 4
 *                     won: 1
 *                     lost: 3
 *                     win_rate_percent: 25.0
 *       400:
 *         description: Bad request – invalid userId or service error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Invalid user ID"
 *       401:
 *         description: Unauthorized – missing or invalid bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Forbidden – caller's role is not permitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               success: false
 *               error: "Access denied: insufficient role"
 */
router.get(
  "/dashboard/:userId",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_approval",
    "loan_officer_processor",
    "call_centre_support",
  ),
  customerDashboardController.getDashboard,
);

module.exports = router;
