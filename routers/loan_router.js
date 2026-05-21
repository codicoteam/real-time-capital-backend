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
 *                 description: When provided, an asset is automatically created from the application's collateral details
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
    "admin_pawn_limited",
    "super_admin_vendor",
  ),
  loanController.createLoan,
);

/**
 * @swagger
 * /api/v1/loans/asset-from-collateral/{applicationId}:
 *   post:
 *     summary: Create an asset from a loan application's collateral
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: applicationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Asset created successfully
 *       404:
 *         description: Application not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/asset-from-collateral/:applicationId",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "super_admin_vendor",
  ),
  loanController.createAssetFromCollateral,
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
 *           enum: [draft, pending_approval, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
 *       - in: query
 *         name: approval_status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
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
    "customer",
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor",
  ),
  loanController.getLoans,
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
 *           enum: [draft, pending_approval, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
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
  requireRoles(
    "admin_pawn_limited",
    "management",
    "super_admin_vendor",
    "loan_officer_processor",
  ),
  loanController.getAllLoans,
);

/**
 * @swagger
 * /api/v1/loans/agent/loans:
 *   get:
 *     summary: Get loans for agent's customers
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     description: Retrieve all loans belonging to customers that this agent has added/created
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, pending_approval, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled, partially_paid, defaulted, written_off]
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
 *         name: approval_status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *       - in: query
 *         name: requires_super_admin_approval
 *         schema:
 *           type: boolean
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
 *         description: Agent's customer loans retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: User is not an agent
 */
router.get("/agent/loans", requireRoles("agent"), loanController.getAgentLoans);

/**
 * @swagger
 * /api/v1/loans/agent/summary:
 *   get:
 *     summary: Get loan summary for agent's customers
 *     tags: [Loans]
 *     security:
 *       - bearerAuth: []
 *     description: Get statistics and summary of all loans belonging to customers that this agent has added/created
 *     responses:
 *       200:
 *         description: Agent loan summary retrieved successfully
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
 *                     total_customers:
 *                       type: integer
 *                     customers_with_loans:
 *                       type: integer
 *                     total_loans:
 *                       type: integer
 *                     active_loans:
 *                       type: integer
 *                     overdue_loans:
 *                       type: integer
 *                     pending_approval_loans:
 *                       type: integer
 *                     redeemed_loans:
 *                       type: integer
 *                     total_disbursed:
 *                       type: number
 *                     total_outstanding:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: User is not an agent
 */
router.get(
  "/agent/summary",
  requireRoles("agent"),
  loanController.getAgentCustomerLoansSummary,
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
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
  ),
  loanController.searchLoans,
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
  requireRoles("admin_pawn_limited", "management", "super_admin_vendor"),
  loanController.getLoanStats,
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
    "super_admin_vendor",
    "management",
    "agent",
  ),
  loanController.getLoan,
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
    "super_admin_vendor",
    "admin_pawn_limited",
  ),
  loanController.updateLoan,
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
 *                 enum: [draft, pending_approval, active, overdue, in_grace, auction, sold, redeemed, closed, cancelled]
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
    "super_admin_vendor",
    "admin_pawn_limited",
  ),
  loanController.updateStatus,
);

/**
 * @swagger
 * /api/v1/loans/{id}/request-approval:
 *   post:
 *     summary: Request super admin approval for a loan (amount > 500)
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
 *               - superAdminIds
 *             properties:
 *               superAdminIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of super admin user IDs (1-3)
 *     responses:
 *       200:
 *         description: Approval request sent
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Loan not found
 */
router.post(
  "/:id/request-approval",
  requireRoles("loan_officer_processor", "admin_pawn_limited"),
  loanController.requestSuperAdminApproval,
);

/**
 * @swagger
 * /api/v1/loans/{id}/approve-super-admin:
 *   post:
 *     summary: Super admin approves a loan
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
 *         description: Loan approved
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Loan not found
 */
router.post(
  "/:id/approve-super-admin",
  requireRoles("super_admin_vendor"),
  loanController.approveLoanBySuperAdmin,
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
  requireRoles(
    "loan_officer_processor",
    "super_admin_vendor",
    "admin_pawn_limited",
  ),
  loanController.processPayment,
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
    "admin_pawn_limited",
    "super_admin_vendor",
    "agent",
  ),
  loanController.calculateCharges,
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
  requireRoles("admin_pawn_limited", "super_admin_vendor"),
  loanController.deleteLoan,
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
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "agent",
  ),
  loanController.getLoansByCustomer,
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
    "super_admin_vendor",
    "management",
  ),
  loanController.getLoanApplication,
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
 *                 enum: [submitted, processing, approved, rejected, cancelled]
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
    "super_admin_vendor",
    "admin_pawn_limited",
  ),
  loanController.updateLoanApplicationStatus,
);

module.exports = router;
