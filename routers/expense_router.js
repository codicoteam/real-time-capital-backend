const express = require("express");
const router = express.Router();
const ExpenseController = require("../controllers/expense.controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Expenses
 *   description: Expense management endpoints (internal use only)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Expense:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         expense_no:
 *           type: string
 *         category:
 *           type: string
 *           enum: [Rent, Electricity, Water, Internet, Salaries, Maintenance, Transport, Office Supplies, Security, Marketing, Other]
 *         amount:
 *           type: number
 *         expense_date:
 *           type: string
 *           format: date-time
 *         payment_method:
 *           type: string
 *           enum: [cash, bank_transfer, mobile_money, cheque, other]
 *         description:
 *           type: string
 *         attachments:
 *           type: array
 *           items:
 *             type: string
 *         status:
 *           type: string
 *           enum: [draft, pending, approved, rejected]
 *         approved_by:
 *           $ref: '#/components/schemas/User'
 *         approved_at:
 *           type: string
 *           format: date-time
 *         notes:
 *           type: string
 *         created_by:
 *           $ref: '#/components/schemas/User'
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     CreateExpenseRequest:
 *       type: object
 *       required:
 *         - category
 *         - amount
 *         - expense_date
 *       properties:
 *         category:
 *           type: string
 *           enum: [Rent, Electricity, Water, Internet, Salaries, Maintenance, Transport, Office Supplies, Security, Marketing, Other]
 *         amount:
 *           type: number
 *           minimum: 0
 *         expense_date:
 *           type: string
 *           format: date-time
 *         payment_method:
 *           type: string
 *           enum: [cash, bank_transfer, mobile_money, cheque, other]
 *           default: cash
 *         description:
 *           type: string
 *         attachments:
 *           type: array
 *           items:
 *             type: string
 *         notes:
 *           type: string
 *         status:
 *           type: string
 *           enum: [draft, pending]
 *           default: pending
 *
 *     UpdateExpenseStatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: [draft, pending, approved, rejected]
 */

/**
 * @swagger
 * /api/v1/expenses:
 *   post:
 *     summary: Create a new expense
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateExpenseRequest'
 *     responses:
 *       201:
 *         description: Expense created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Expense'
 *                 message:
 *                   type: string
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
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.createExpense
);

/**
 * @swagger
 * /api/v1/expenses:
 *   get:
 *     summary: Get expenses with pagination and filters
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [Rent, Electricity, Water, Internet, Salaries, Maintenance, Transport, Office Supplies, Security, Marketing, Other]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending, approved, rejected]
 *       - in: query
 *         name: payment_method
 *         schema:
 *           type: string
 *           enum: [cash, bank_transfer, mobile_money, cheque, other]
 *       - in: query
 *         name: from_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: min_amount
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_amount
 *         schema:
 *           type: number
 *       - in: query
 *         name: created_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           enum: [expense_date, amount, created_at]
 *           default: expense_date
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Expenses retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.getExpenses
);

/**
 * @swagger
 * /api/v1/expenses/stats:
 *   get:
 *     summary: Get expense statistics
 *     tags: [Expenses]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Expense statistics
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/stats",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.getExpenseStats
);

/**
 * @swagger
 * /api/v1/expenses/{id}:
 *   get:
 *     summary: Get expense by ID
 *     tags: [Expenses]
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
 *         description: Expense details
 *       404:
 *         description: Expense not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:id",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.getExpense
);

/**
 * @swagger
 * /api/v1/expenses/{id}:
 *   put:
 *     summary: Update expense (only if not approved/rejected)
 *     tags: [Expenses]
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
 *             $ref: '#/components/schemas/CreateExpenseRequest'
 *     responses:
 *       200:
 *         description: Expense updated successfully
 *       400:
 *         description: Invalid data or cannot update approved expense
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 */
router.put(
  "/:id",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.updateExpense
);

/**
 * @swagger
 * /api/v1/expenses/{id}/status:
 *   put:
 *     summary: Update expense status (approve/reject)
 *     tags: [Expenses]
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
 *             $ref: '#/components/schemas/UpdateExpenseStatusRequest'
 *     responses:
 *       200:
 *         description: Expense status updated
 *       400:
 *         description: Invalid status transition
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 */
router.put(
  "/:id/status",
  requireRoles(
    "loan_officer_approval",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.updateExpenseStatus
);

/**
 * @swagger
 * /api/v1/expenses/{id}:
 *   delete:
 *     summary: Delete expense (only if not approved)
 *     tags: [Expenses]
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
 *         description: Expense deleted successfully
 *       400:
 *         description: Cannot delete approved expense
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Expense not found
 */
router.delete(
  "/:id",
  requireRoles(
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  ExpenseController.deleteExpense
);

module.exports = router;