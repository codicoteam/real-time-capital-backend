const express = require("express");
const router = express.Router();
const loanController = require("../controllers/loan_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Loans
 *   description: Loan management endpoints
 */

/**
 * @swagger
 * /api/v1/loans:
 *   post:
 *     summary: Create a new loan
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - customer_user
 *               - asset
 *               - principal_amount
 *               - interest_rate_percent
 *               - start_date
 *               - due_date
 *             properties:
 *               customer_user:
 *                 type: string
 *               asset:
 *                 type: string
 *               application:
 *                 type: string
 *               principal_amount:
 *                 type: number
 *               interest_rate_percent:
 *                 type: number
 *               start_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               collateral_category:
 *                 type: string
 *                 enum: [small_loans, motor_vehicle, jewellery]
 *     responses:
 *       201:
 *         description: Loan created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  loanController.createLoan
);

/**
 * @swagger
 * /api/v1/loans:
 *   get:
 *     summary: Get loans with pagination
 *     tags: [Loans]
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
 *         name: customer_user
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
 *       - in: query
 *         name: collateral_category
 *         schema:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *       - in: query
 *         name: loan_no
 *         schema:
 *           type: string
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: due_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: due_to
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
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: created_at
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Loans retrieved successfully
 *       400:
 *         description: Invalid query parameters
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
  loanController.getLoans
);

/**
 * @swagger
 * /api/v1/loans/all:
 *   get:
 *     summary: Get all loans without pagination
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: customer_user
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
 *       - in: query
 *         name: collateral_category
 *         schema:
 *           type: string
 *           enum: [small_loans, motor_vehicle, jewellery]
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: created_at
 *       - in: query
 *         name: sort_order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: All loans retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/all",
  requireRoles("admin_pawn_limited", "management"),
  loanController.getAllLoans
);

/**
 * @swagger
 * /api/v1/loans/{id}:
 *   get:
 *     summary: Get loan by ID
 *     tags: [Loans]
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
 *         description: Loan details
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:id",
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  loanController.getLoan
);

/**
 * @swagger
 * /api/v1/loans/{id}:
 *   put:
 *     summary: Update loan
 *     tags: [Loans]
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
 *               current_balance:
 *                 type: number
 *               interest_rate_percent:
 *                 type: number
 *               storage_charge_percent:
 *                 type: number
 *               penalty_percent:
 *                 type: number
 *               grace_days:
 *                 type: number
 *     responses:
 *       200:
 *         description: Loan updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:id",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  loanController.updateLoan
);

/**
 * @swagger
 * /api/v1/loans/{id}/status:
 *   put:
 *     summary: Update loan status
 *     tags: [Loans]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid status or status transition
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:id/status",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  loanController.updateStatus
);

/**
 * @swagger
 * /api/v1/loans/{id}/payment:
 *   post:
 *     summary: Process loan payment
 *     tags: [Loans]
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
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *               payment_method:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment processed successfully
 *       400:
 *         description: Invalid payment data
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:id/payment",
  requireRoles("loan_officer_processor", "admin_pawn_limited"),
  loanController.processPayment
);

/**
 * @swagger
 * /api/v1/loans/{id}/charges:
 *   get:
 *     summary: Calculate loan charges
 *     tags: [Loans]
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
 *         description: Loan charges calculated
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/:id/charges",
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  loanController.calculateCharges
);

/**
 * @swagger
 * /api/v1/loans/{id}:
 *   delete:
 *     summary: Delete loan (soft delete)
 *     tags: [Loans]
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
 *         description: Loan deleted successfully
 *       400:
 *         description: Cannot delete active or overdue loan
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited"),
  loanController.deleteLoan
);

/**
 * @swagger
 * /api/v1/loans/customer/{customerId}:
 *   get:
 *     summary: Get loans by customer
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Customer's loans retrieved successfully
 *       404:
 *         description: Customer not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/customer/:customerId",
  requireRoles(
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  loanController.getLoansByCustomer
);

/**
 * @swagger
 * /api/v1/loans/search:
 *   get:
 *     summary: Search loans
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term (minimum 2 characters)
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
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Search term too short
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/search",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  loanController.searchLoans
);

/**
 * @swagger
 * /api/v1/loans/stats:
 *   get:
 *     summary: Get loan statistics
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loan statistics
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/stats",
  requireRoles("admin_pawn_limited", "management"),
  loanController.getLoanStats
);

/**
 * @swagger
 * /api/v1/loans/applications/{id}:
 *   get:
 *     summary: Get loan application by ID
 *     tags: [Loans]
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
 *         description: Loan application details
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/applications/:id",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  loanController.getLoanApplication
);

/**
 * @swagger
 * /api/v1/loans/applications/{id}/status:
 *   put:
 *     summary: Update loan application status
 *     tags: [Loans]
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
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [draft, submitted, processing, approved, rejected, cancelled]
 *               internal_notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan application status updated
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Loan application not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/applications/:id/status",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  loanController.updateLoanApplicationStatus
);

module.exports = router;
