const express = require("express");
const router = express.Router();
const InventoryTransactionController = require("../controllers/inventory_transaction_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Inventory Transactions
 *   description: Financial transaction tracking and reporting for pawn shop operations
 */

/**
 * @swagger
 * /api/v1/transactions:
 *   post:
 *     summary: Create a new inventory transaction
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - amount
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [loan_disbursement, repayment, interest_income, storage_income, penalty_income, asset_sale, asset_purchase, expense, adjustment]
 *               amount:
 *                 type: number
 *               currency:
 *                 type: string
 *                 default: USD
 *               asset:
 *                 type: string
 *               loan:
 *                 type: string
 *               payment:
 *                 type: string
 *               account_code:
 *                 type: string
 *               notes:
 *                 type: string
 *               occurred_at:
 *                 type: string
 *                 format: date-time
 *               meta:
 *                 type: object
 *     responses:
 *       201:
 *         description: Transaction created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  InventoryTransactionController.createTransaction
);

/**
 * @swagger
 * /api/v1/transactions/loan/{loanId}/disbursement:
 *   post:
 *     summary: Create loan disbursement transaction
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Loan disbursement transaction created
 *       400:
 *         description: Loan not found or already disbursed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/loan/:loanId/disbursement",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  InventoryTransactionController.createLoanDisbursementTransaction
);

/**
 * @swagger
 * /api/v1/transactions/payment/{paymentId}/repayment:
 *   post:
 *     summary: Create repayment transactions from payment
 *     tags: [Inventory Transactions]
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
 *         description: Repayment transactions created
 *       400:
 *         description: Payment not found or not paid
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/payment/:paymentId/repayment",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  InventoryTransactionController.createRepaymentTransaction
);

/**
 * @swagger
 * /api/v1/transactions/asset/{assetId}/sale:
 *   post:
 *     summary: Create asset sale transaction
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sale_price
 *             properties:
 *               sale_price:
 *                 type: number
 *               meta:
 *                 type: object
 *     responses:
 *       201:
 *         description: Asset sale transaction created
 *       400:
 *         description: Asset not found or not sold
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/asset/:assetId/sale",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.createAssetSaleTransaction
);

/**
 * @swagger
 * /api/v1/transactions/expense:
 *   post:
 *     summary: Create expense transaction
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - category
 *               - description
 *             properties:
 *               amount:
 *                 type: number
 *               category:
 *                 type: string
 *                 enum: [rent, utilities, salaries, maintenance, marketing, insurance, other]
 *               description:
 *                 type: string
 *               currency:
 *                 type: string
 *                 default: USD
 *               notes:
 *                 type: string
 *               meta:
 *                 type: object
 *     responses:
 *       201:
 *         description: Expense transaction created
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.post(
  "/expense",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.createExpenseTransaction
);

/**
 * @swagger
 * /api/v1/transactions:
 *   get:
 *     summary: Get transactions with pagination and filters
 *     tags: [Inventory Transactions]
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
 *         name: type
 *         schema:
 *           type: string
 *           enum: [loan_disbursement, repayment, interest_income, storage_income, penalty_income, asset_sale, asset_purchase, expense, adjustment]
 *         description: Filter by transaction type
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *       - in: query
 *         name: asset
 *         schema:
 *           type: string
 *         description: Filter by asset ID
 *       - in: query
 *         name: loan
 *         schema:
 *           type: string
 *         description: Filter by loan ID
 *       - in: query
 *         name: payment
 *         schema:
 *           type: string
 *         description: Filter by payment ID
 *       - in: query
 *         name: account_code
 *         schema:
 *           type: string
 *         description: Filter by account code
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
 *         name: occurred_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by occurrence start date
 *       - in: query
 *         name: occurred_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by occurrence end date
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
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in transaction number, notes, or account code
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: occurred_at
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
 *         description: Transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  InventoryTransactionController.getTransactions
);

/**
 * @swagger
 * /api/v1/transactions/all:
 *   get:
 *     summary: Get all transactions without pagination
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by transaction type
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
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
 *         description: All transactions retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/all",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.getAllTransactions
);

/**
 * @swagger
 * /api/v1/transactions/{id}:
 *   get:
 *     summary: Get transaction by ID
 *     tags: [Inventory Transactions]
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
 *         description: Transaction details
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:id",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  InventoryTransactionController.getTransaction
);

/**
 * @swagger
 * /api/v1/transactions/{id}:
 *   put:
 *     summary: Update transaction
 *     tags: [Inventory Transactions]
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
 *               account_code:
 *                 type: string
 *               notes:
 *                 type: string
 *               meta:
 *                 type: object
 *               update_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transaction updated successfully
 *       400:
 *         description: Cannot update certain fields for this transaction type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Transaction not found
 */
router.put(
  "/:id",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.updateTransaction
);

/**
 * @swagger
 * /api/v1/transactions/{id}:
 *   delete:
 *     summary: Delete transaction
 *     tags: [Inventory Transactions]
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
 *         description: Transaction deleted successfully
 *       400:
 *         description: Cannot delete this transaction type
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Transaction not found
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.deleteTransaction
);

/**
 * @swagger
 * /api/v1/transactions/stats:
 *   get:
 *     summary: Get transaction statistics
 *     tags: [Inventory Transactions]
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
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by transaction type
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *     responses:
 *       200:
 *         description: Transaction statistics
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/stats",
  requireRoles("loan_officer_approval", "admin_pawn_limited", "management"),
  InventoryTransactionController.getTransactionStats
);

/**
 * @swagger
 * /api/v1/transactions/report/{report_type}:
 *   get:
 *     summary: Get financial report (Profit & Loss, Cash Flow)
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: report_type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [profit_loss, cash_flow]
 *           default: profit_loss
 *         description: Type of financial report
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
 *         description: Financial report generated successfully
 *       400:
 *         description: Start date and end date are required
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/report/:report_type",
  requireRoles("admin_pawn_limited", "management"),
  InventoryTransactionController.getFinancialReport
);

/**
 * @swagger
 * /api/v1/transactions/summary:
 *   get:
 *     summary: Get transaction summary for dashboard
 *     tags: [Inventory Transactions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transaction summary for dashboard
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 */
router.get(
  "/summary",
  requireRoles("loan_officer_approval", "admin_pawn_limited", "management"),
  InventoryTransactionController.getTransactionSummary
);

/**
 * @swagger
 * /api/v1/transactions/export:
 *   get:
 *     summary: Export transactions
 *     tags: [Inventory Transactions]
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
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by transaction type
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: csv
 *         description: Export format
 *     responses:
 *       200:
 *         description: Transactions exported successfully
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
  InventoryTransactionController.exportTransactions
);

module.exports = router;
