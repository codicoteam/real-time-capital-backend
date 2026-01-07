const express = require("express");
const router = express.Router();
const LedgerEntryController = require("../controllers/ledger_entry_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Ledger Entries
 *   description: Accounting ledger entries for financial tracking and reporting
 */

/**
 * @swagger
 * /api/v1/ledger-entries:
 *   post:
 *     summary: Create a new ledger entry
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - category
 *               - amount
 *             properties:
 *               entry_date:
 *                 type: string
 *                 format: date-time
 *               branch_code:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [interest_income, storage_income, penalty_income, loan_disbursement, loan_principal_repayment, asset_sale_revenue, asset_sale_cogs, write_off, adjustment, other]
 *               amount:
 *                 type: number
 *               currency:
 *                 type: string
 *                 enum: [USD, ZWG]
 *                 default: USD
 *               refs:
 *                 type: object
 *                 properties:
 *                   loan_id:
 *                     type: string
 *                   payment_id:
 *                     type: string
 *                   asset_id:
 *                     type: string
 *                   inventory_txn_id:
 *                     type: string
 *               memo:
 *                 type: string
 *     responses:
 *       201:
 *         description: Ledger entry created successfully
 *       400:
 *         description: Invalid input data or amount sign mismatch
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.createLedgerEntry
);

/**
 * @swagger
 * /api/v1/ledger-entries/inventory-transaction/{inventoryTxnId}:
 *   post:
 *     summary: Create ledger entry from inventory transaction
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: inventoryTxnId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Ledger entry created from inventory transaction
 *       400:
 *         description: Cannot map transaction type to ledger category
 *       404:
 *         description: Inventory transaction not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/inventory-transaction/:inventoryTxnId",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.createLedgerEntryFromInventoryTransaction
);

/**
 * @swagger
 * /api/v1/ledger-entries/payment/{paymentId}:
 *   post:
 *     summary: Create ledger entries for payment
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: paymentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Payment ledger entries created
 *       400:
 *         description: Payment not paid or no valid components
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/payment/:paymentId",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.createLedgerEntryForPayment
);

/**
 * @swagger
 * /api/v1/ledger-entries:
 *   get:
 *     summary: Get ledger entries with pagination and filters
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [interest_income, storage_income, penalty_income, loan_disbursement, loan_principal_repayment, asset_sale_revenue, asset_sale_cogs, write_off, adjustment, other]
 *         description: Filter by category
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [USD, ZWG]
 *         description: Filter by currency
 *       - in: query
 *         name: branch_code
 *         schema:
 *           type: string
 *         description: Filter by branch code
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation start date
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation end date
 *       - in: query
 *         name: entry_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by entry start date
 *       - in: query
 *         name: entry_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by entry end date
 *       - in: query
 *         name: min_amount
 *         schema:
 *           type: number
 *         description: Minimum amount
 *       - in: query
 *         name: max_amount
 *         schema:
 *           type: number
 *         description: Maximum amount
 *       - in: query
 *         name: loan_id
 *         schema:
 *           type: string
 *         description: Filter by loan ID
 *       - in: query
 *         name: asset_id
 *         schema:
 *           type: string
 *         description: Filter by asset ID
 *       - in: query
 *         name: payment_id
 *         schema:
 *           type: string
 *         description: Filter by payment ID
 *       - in: query
 *         name: inventory_txn_id
 *         schema:
 *           type: string
 *         description: Filter by inventory transaction ID
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in memo or branch code
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: entry_date
 *         description: Field to sort by
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Ledger entries retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  requireRoles("loan_officer_approval", "admin_pawn_limited", "management"),
  LedgerEntryController.getLedgerEntries
);

/**
 * @swagger
 * /api/v1/ledger-entries/all:
 *   get:
 *     summary: Get all ledger entries without pagination
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *       - in: query
 *         name: branch_code
 *         schema:
 *           type: string
 *         description: Filter by branch code
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation start date
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation end date
 *     responses:
 *       200:
 *         description: All ledger entries retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/all",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.getAllLedgerEntries
);

/**
 * @swagger
 * /api/v1/ledger-entries/{id}:
 *   get:
 *     summary: Get ledger entry by ID
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ledger entry details
 *       404:
 *         description: Ledger entry not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:id",
  requireRoles("loan_officer_approval", "admin_pawn_limited", "management"),
  LedgerEntryController.getLedgerEntry
);

/**
 * @swagger
 * /api/v1/ledger-entries/{id}:
 *   put:
 *     summary: Update ledger entry
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
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
 *               memo:
 *                 type: string
 *               branch_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Ledger entry updated successfully
 *       400:
 *         description: Cannot update certain fields for this entry type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Ledger entry not found
 */
router.put(
  "/:id",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.updateLedgerEntry
);

/**
 * @swagger
 * /api/v1/ledger-entries/{id}:
 *   delete:
 *     summary: Delete ledger entry
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ledger entry deleted successfully
 *       400:
 *         description: Cannot delete this ledger entry type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Ledger entry not found
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.deleteLedgerEntry
);

/**
 * @swagger
 * /api/v1/ledger-entries/summary:
 *   get:
 *     summary: Get ledger summary/balance
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation start date
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation end date
 *       - in: query
 *         name: entry_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by entry start date
 *       - in: query
 *         name: entry_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by entry end date
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *       - in: query
 *         name: branch_code
 *         schema:
 *           type: string
 *         description: Filter by branch code
 *     responses:
 *       200:
 *         description: Ledger summary retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/summary",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.getLedgerSummary
);

/**
 * @swagger
 * /api/v1/ledger-entries/reports/trial-balance:
 *   get:
 *     summary: Get trial balance report
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Report start date
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Report end date
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Report format
 *     responses:
 *       200:
 *         description: Trial balance generated successfully
 *       400:
 *         description: Start date and end date are required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/reports/trial-balance",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.getTrialBalance
);

/**
 * @swagger
 * /api/v1/ledger-entries/reports/profit-loss:
 *   get:
 *     summary: Get profit and loss statement
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Report start date
 *       - in: query
 *         name: end_date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Report end date
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Report format
 *     responses:
 *       200:
 *         description: Profit and loss statement generated successfully
 *       400:
 *         description: Start date and end date are required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/reports/profit-loss",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.getProfitAndLoss
);

/**
 * @swagger
 * /api/v1/ledger-entries/dashboard/summary:
 *   get:
 *     summary: Get ledger summary for dashboard
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Ledger dashboard summary retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/dashboard/summary",
  requireRoles("loan_officer_approval", "admin_pawn_limited", "management"),
  LedgerEntryController.getLedgerDashboardSummary
);

/**
 * @swagger
 * /api/v1/ledger-entries/export:
 *   get:
 *     summary: Export ledger entries
 *     tags: [Ledger Entries]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation start date
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation end date
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *       - in: query
 *         name: branch_code
 *         schema:
 *           type: string
 *         description: Filter by branch code
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: csv
 *         description: Export format
 *     responses:
 *       200:
 *         description: Ledger entries exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/export",
  requireRoles("admin_pawn_limited", "management"),
  LedgerEntryController.exportLedgerEntries
);

module.exports = router;
