"use strict";

const express = require("express");
const router = express.Router();
const investorController = require("../../controllers/investor/investor_controller");
const {
  investorAuthMiddleware,
  requireInvestorAdmin,
  requireAdminOrSelf,
} = require("../../middlewares/investor_auth_middleware");
const {
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  requireAdminOrSelfUnified,
} = require("../../middlewares/investor_or_pawn_admin_middleware");

/**
 * @swagger
 * tags:
 *   name: Investors
 *   description: Investor portal — onboarding, auth, and account management
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     InvestorBearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: JWT issued by the investor portal login endpoint
 *
 *   schemas:
 *     ProfitShareOverride:
 *       type: object
 *       description: Per-investor negotiated profit-share. Only the terms present override the platform default.
 *       properties:
 *         two_week:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 65
 *           description: Investor share (%) on 2-week loans
 *         one_month:
 *           type: number
 *           minimum: 0
 *           maximum: 100
 *           example: 70
 *           description: Investor share (%) on 1-month loans
 *
 *     Investor:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "6592b8f0c0d3e7a3d9c2a111"
 *         kind:
 *           type: string
 *           enum: [admin, individual, company, company_client]
 *           example: individual
 *         name:
 *           type: string
 *           example: "Tendai Moyo"
 *         email:
 *           type: string
 *           format: email
 *           example: "tendai@rtcapital.co.zw"
 *         avatar_color:
 *           type: string
 *           example: "#10b981"
 *         status:
 *           type: string
 *           enum: [active, pending, suspended, deleted]
 *           example: active
 *         phone:
 *           type: string
 *           example: "+263 77 000 0000"
 *         location:
 *           type: string
 *           example: "Harare, Zimbabwe"
 *         committed_capital:
 *           type: number
 *           example: 50000
 *           description: USD committed capital
 *         parent_company_id:
 *           type: string
 *           nullable: true
 *           example: null
 *         profit_share_override:
 *           $ref: '#/components/schemas/ProfitShareOverride'
 *           nullable: true
 *         title:
 *           type: string
 *           nullable: true
 *           example: "Investment Manager"
 *         notes:
 *           type: string
 *           nullable: true
 *         added_by:
 *           type: string
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     LoanTermSplit:
 *       type: object
 *       properties:
 *         borrower_rate:
 *           type: number
 *           example: 20
 *           description: Interest rate charged to the borrower (%)
 *         investor_share:
 *           type: number
 *           example: 60
 *           description: Share of the generated profit that goes to the investor (%)
 *         label:
 *           type: string
 *           example: "2-Week Loan"
 *         days:
 *           type: number
 *           example: 14
 *
 *     InvestorProfitSplit:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         two_week:
 *           $ref: '#/components/schemas/LoanTermSplit'
 *         one_month:
 *           $ref: '#/components/schemas/LoanTermSplit'
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     InvestorLoginRequest:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           example: "admin@rtcapital.co.zw"
 *         password:
 *           type: string
 *           example: "mypassword"
 *
 *     CreateInvestorRequest:
 *       type: object
 *       required: [kind, name, email, password, committed_capital]
 *       properties:
 *         kind:
 *           type: string
 *           enum: [individual, company]
 *           example: individual
 *         name:
 *           type: string
 *           example: "Tendai Moyo"
 *         email:
 *           type: string
 *           format: email
 *           example: "tendai@example.com"
 *         password:
 *           type: string
 *           minLength: 6
 *           example: "pass123"
 *         phone:
 *           type: string
 *           example: "+263 77 000 0000"
 *         location:
 *           type: string
 *           example: "Harare, Zimbabwe"
 *         committed_capital:
 *           type: number
 *           example: 50000
 *         profit_share_override:
 *           $ref: '#/components/schemas/ProfitShareOverride'
 *           nullable: true
 *         notes:
 *           type: string
 *
 *     AddCompanyClientRequest:
 *       type: object
 *       required: [name, email, password, committed_capital]
 *       properties:
 *         name:
 *           type: string
 *           example: "John Mupandawana"
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 6
 *         phone:
 *           type: string
 *         location:
 *           type: string
 *         committed_capital:
 *           type: number
 *           example: 10000
 *         profit_share_override:
 *           $ref: '#/components/schemas/ProfitShareOverride'
 *           nullable: true
 *         notes:
 *           type: string
 *
 *     UpdateInvestorRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *         phone:
 *           type: string
 *         location:
 *           type: string
 *         password:
 *           type: string
 *           minLength: 6
 *         avatar_color:
 *           type: string
 *         committed_capital:
 *           type: number
 *           description: Admin only
 *         status:
 *           type: string
 *           enum: [active, pending, suspended]
 *           description: Admin only
 *         notes:
 *           type: string
 *           description: Admin only
 *
 *     SeedAdminRequest:
 *       type: object
 *       required: [name, email, password]
 *       properties:
 *         name:
 *           type: string
 *           example: "Real Time Capital"
 *         email:
 *           type: string
 *           format: email
 *           example: "admin@rtcapital.co.zw"
 *         password:
 *           type: string
 *           minLength: 8
 *         title:
 *           type: string
 *           example: "Investment Manager"
 */

// ─── AUTH ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/investors/auth/seed-admin:
 *   post:
 *     summary: Bootstrap the investor portal admin account (one-time setup)
 *     description: >
 *       Creates the single investor-portal admin account. Returns 409 if an admin
 *       already exists. Call this once during initial deployment — no auth required.
 *     tags: [Investors]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SeedAdminRequest'
 *     responses:
 *       201:
 *         description: Admin created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *                     token:
 *                       type: string
 *       409:
 *         description: Admin already exists
 */
router.post("/auth/seed-admin", investorController.seedAdmin.bind(investorController));

/**
 * @swagger
 * /api/v1/investors/auth/login:
 *   post:
 *     summary: Investor portal login
 *     description: >
 *       Authenticates any investor portal account (admin, individual, company,
 *       company_client). Returns a JWT to include as `Authorization: Bearer <token>`
 *       on all subsequent requests.
 *     tags: [Investors]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InvestorLoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *                     token:
 *                       type: string
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account suspended
 */
router.post("/auth/login", investorController.login.bind(investorController));

// ─── PROFIT SPLIT CONFIG ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/investors/profit-split:
 *   get:
 *     summary: Get platform-wide profit split config
 *     description: Returns the current borrower interest rates and investor share percentages for each loan term.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     responses:
 *       200:
 *         description: Profit split config
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     profit_split:
 *                       $ref: '#/components/schemas/InvestorProfitSplit'
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/profit-split",
  investorOrPawnAdminMiddleware,
  investorController.getProfitSplit.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/profit-split:
 *   put:
 *     summary: Update platform-wide profit split config (admin only)
 *     description: >
 *       Updates the borrower rates and/or investor share percentages for 2-week
 *       and/or 1-month loan terms. Only fields provided are updated.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               two_week:
 *                 type: object
 *                 properties:
 *                   borrower_rate:
 *                     type: number
 *                     example: 20
 *                   investor_share:
 *                     type: number
 *                     example: 60
 *                   label:
 *                     type: string
 *               one_month:
 *                 type: object
 *                 properties:
 *                   borrower_rate:
 *                     type: number
 *                     example: 30
 *                   investor_share:
 *                     type: number
 *                     example: 65
 *                   label:
 *                     type: string
 *     responses:
 *       200:
 *         description: Config updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     profit_split:
 *                       $ref: '#/components/schemas/InvestorProfitSplit'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 */
router.put(
  "/profit-split",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.updateProfitSplit.bind(investorController),
);

// ─── INVESTOR ACCOUNTS ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/investors:
 *   post:
 *     summary: Create an investor account (admin only)
 *     description: >
 *       Admin onboards an individual investor or a company investor.
 *       For company clients, use `POST /api/v1/investors/companies/{companyId}/clients`.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateInvestorRequest'
 *     responses:
 *       201:
 *         description: Investor created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       409:
 *         description: Email already registered
 */
router.post(
  "/",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.createInvestor.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors:
 *   get:
 *     summary: List investors (admin only)
 *     description: Returns paginated list of individual and company investors. Does not include company_clients directly — use the company clients endpoint for those.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: query
 *         name: kind
 *         schema:
 *           type: string
 *           enum: [individual, company, company_client]
 *         description: Filter by account type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, email, phone, or location
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, pending, suspended, deleted]
 *         description: Filter by status (defaults to non-deleted)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of investors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     investors:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Investor'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 */
router.get(
  "/",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.listInvestors.bind(investorController),
);

// ─── ADMIN LOAN ALLOCATIONS ─────────────────────────────────────────────────
// Must be registered BEFORE /:id routes to prevent "admin" matching as an ID param

router.get(
  "/admin/stats",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.getAdminStats.bind(investorController),
);

router.get(
  "/admin/loan-allocations",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.getAdminAllAllocations.bind(investorController),
);

router.post(
  "/admin/manual-allocations",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.createManualAllocations.bind(investorController),
);

// Monthly interest payments on active loans
router.get(
  "/allocations/:allocationId/monthly-interest",
  investorOrPawnAdminMiddleware,
  investorController.getMonthlyInterest.bind(investorController),
);

router.post(
  "/allocations/:allocationId/monthly-interest",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.recordMonthlyInterest.bind(investorController),
);

router.post(
  "/admin/assign-loan/:loanId",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.triggerLoanAssignment.bind(investorController),
);

router.get(
  "/admin/rtc-account",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.getRtcAccount.bind(investorController),
);

router.patch(
  "/admin/rtc-account/capital",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.updateRtcCapital.bind(investorController),
);

router.get(
  "/admin/rtc-account/transactions",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.getRtcTransactions.bind(investorController),
);

router.post(
  "/admin/rtc-account/transactions",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.recordRtcTransaction.bind(investorController),
);

router.get(
  "/admin/rtc-account/unlinked-expenses",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.getUnlinkedApprovedExpenses.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/{id}:
 *   get:
 *     summary: Get investor by ID (admin or self)
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Investor MongoDB _id
 *     responses:
 *       200:
 *         description: Investor data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *       400:
 *         description: Invalid ID
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.get(
  "/:id",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getInvestor.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/{id}:
 *   put:
 *     summary: Update investor profile (admin or self)
 *     description: >
 *       Investors can update their own name, phone, location, password, and avatar_color.
 *       Admins can additionally update committed_capital, status, and notes.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateInvestorRequest'
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 */
router.put(
  "/:id",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.updateInvestor.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/{id}:
 *   delete:
 *     summary: Soft-delete an investor account (admin only)
 *     description: Sets status to 'deleted'. The account record is retained for audit purposes.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Investor deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *       400:
 *         description: Invalid ID or cannot delete self
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       404:
 *         description: Not found
 */
router.delete(
  "/:id",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.deleteInvestor.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/{id}/profit-share:
 *   put:
 *     summary: Update per-investor profit share override (admin only)
 *     description: >
 *       Sets a negotiated investor-share override for a specific investor.
 *       Send `profit_share_override: null` to remove the override and fall back
 *       to the platform default.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profit_share_override:
 *                 $ref: '#/components/schemas/ProfitShareOverride'
 *                 nullable: true
 *                 description: Pass null to clear the override
 *     responses:
 *       200:
 *         description: Profit share override updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       404:
 *         description: Not found
 */
router.put(
  "/:id/profit-share",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.updateProfitShare.bind(investorController),
);

// ─── COMPANY CLIENTS ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/v1/investors/companies/{companyId}/clients:
 *   post:
 *     summary: Add a client under a company investor account (admin only)
 *     description: Creates a company_client account linked to the given company investor.
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema:
 *           type: string
 *         description: The company investor's MongoDB _id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddCompanyClientRequest'
 *     responses:
 *       201:
 *         description: Company client created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     investor:
 *                       $ref: '#/components/schemas/Investor'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       404:
 *         description: Company not found
 *       409:
 *         description: Email already registered
 */
router.post(
  "/companies/:companyId/clients",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.addCompanyClient.bind(investorController),
);

/**
 * @swagger
 * /api/v1/investors/companies/{companyId}/clients:
 *   get:
 *     summary: List clients of a company investor (admin only)
 *     tags: [Investors]
 *     security:
 *       - InvestorBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: companyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Company and its clients
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     company:
 *                       $ref: '#/components/schemas/Investor'
 *                     clients:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Investor'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin only
 *       404:
 *         description: Company not found
 */
router.get(
  "/companies/:companyId/clients",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.listCompanyClients.bind(investorController),
);

// ─── PER-INVESTOR TRANSACTIONS ───────────────────────────────────────────────

router.get(
  "/:id/transaction-summary",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getTransactionSummary.bind(investorController),
);

router.get(
  "/:id/transactions",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getTransactions.bind(investorController),
);

router.post(
  "/:id/transactions",
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  investorController.recordTransaction.bind(investorController),
);

// ─── PER-INVESTOR PORTFOLIO DATA ─────────────────────────────────────────────

router.get(
  "/:id/loan-allocations",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getInvestorAllocations.bind(investorController),
);

router.get(
  "/:id/portfolio-stats",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getInvestorPortfolioStats.bind(investorController),
);

router.get(
  "/:id/growth-history",
  investorOrPawnAdminMiddleware,
  requireAdminOrSelfUnified,
  investorController.getInvestorGrowthHistory.bind(investorController),
);

module.exports = router;
