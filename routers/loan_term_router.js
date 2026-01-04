const express = require("express");
const router = express.Router();
const loanTermController = require("../controllers/loan_term_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Loan Terms
 *   description: Loan term management endpoints
 */

/**
 * @swagger
 * /api/v1/loan-terms:
 *   post:
 *     summary: Create a new loan term
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - loan
 *               - start_date
 *               - due_date
 *               - opening_balance
 *               - closing_balance
 *             properties:
 *               loan:
 *                 type: string
 *               term_no:
 *                 type: number
 *               start_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               opening_balance:
 *                 type: number
 *               closing_balance:
 *                 type: number
 *               interest_rate_percent:
 *                 type: number
 *               interest_period_days:
 *                 type: number
 *               storage_charge_percent:
 *                 type: number
 *               renewal_type:
 *                 type: string
 *                 enum: [initial, interest_only_renewal, partial_principal_renewal, full_settlement]
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Loan term created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 */
router.post("/", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  loanTermController.createLoanTerm
);

/**
 * @swagger
 * /api/v1/loan-terms:
 *   get:
 *     summary: Get loan terms with pagination
 *     tags: [Loan Terms]
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
 *         name: loan
 *         schema:
 *           type: string
 *       - in: query
 *         name: term_no
 *         schema:
 *           type: number
 *       - in: query
 *         name: renewal_type
 *         schema:
 *           type: string
 *           enum: [initial, interest_only_renewal, partial_principal_renewal, full_settlement]
 *       - in: query
 *         name: approved_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: start_date_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: start_date_to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: due_date_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: due_date_to
 *         schema:
 *           type: string
 *           format: date
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
 *         description: Loan terms retrieved successfully
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
router.get("/", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  loanTermController.getLoanTerms
);

/**
 * @swagger
 * /api/v1/loan-terms/all:
 *   get:
 *     summary: Get all loan terms without pagination
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: loan
 *         schema:
 *           type: string
 *       - in: query
 *         name: renewal_type
 *         schema:
 *           type: string
 *           enum: [initial, interest_only_renewal, partial_principal_renewal, full_settlement]
 *       - in: query
 *         name: approved_by
 *         schema:
 *           type: string
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
 *         description: All loan terms retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/all", 
  requireRoles('admin_pawn_limited', 'management'),
  loanTermController.getAllLoanTerms
);

/**
 * @swagger
 * /api/v1/loan-terms/{id}:
 *   get:
 *     summary: Get loan term by ID
 *     tags: [Loan Terms]
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
 *         description: Loan term details
 *       404:
 *         description: Loan term not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  loanTermController.getLoanTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/{id}:
 *   put:
 *     summary: Update loan term
 *     tags: [Loan Terms]
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
 *               start_date:
 *                 type: string
 *                 format: date
 *               due_date:
 *                 type: string
 *                 format: date
 *               opening_balance:
 *                 type: number
 *               closing_balance:
 *                 type: number
 *               interest_rate_percent:
 *                 type: number
 *               storage_charge_percent:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan term updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Loan term not found
 *       401:
 *         description: Unauthorized
 */
router.put("/:id", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  loanTermController.updateLoanTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/{id}/approve:
 *   post:
 *     summary: Approve loan term
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Loan term approved successfully
 *       400:
 *         description: Loan term is already approved
 *       404:
 *         description: Loan term not found
 *       401:
 *         description: Unauthorized
 */
router.post("/:id/approve", 
  requireRoles('loan_officer_approval', 'admin_pawn_limited'),
  loanTermController.approveLoanTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/{id}:
 *   delete:
 *     summary: Delete loan term
 *     tags: [Loan Terms]
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
 *         description: Loan term deleted successfully
 *       400:
 *         description: Cannot delete approved loan term
 *       404:
 *         description: Loan term not found
 *       401:
 *         description: Unauthorized
 */
router.delete("/:id", 
  requireRoles('admin_pawn_limited'),
  loanTermController.deleteLoanTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/loan/{loanId}:
 *   get:
 *     summary: Get loan terms by loan ID
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
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
 *         description: Loan terms retrieved successfully
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get("/loan/:loanId", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  loanTermController.getLoanTermsByLoan
);

/**
 * @swagger
 * /api/v1/loan-terms/loan/{loanId}/current:
 *   get:
 *     summary: Get current active term for a loan
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current loan term retrieved successfully
 *       404:
 *         description: No terms found for loan
 *       401:
 *         description: Unauthorized
 */
router.get("/loan/:loanId/current", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  loanTermController.getCurrentTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/loan/{loanId}/timeline:
 *   get:
 *     summary: Get loan term timeline
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Loan term timeline retrieved successfully
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get("/loan/:loanId/timeline", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  loanTermController.getLoanTermTimeline
);

/**
 * @swagger
 * /api/v1/loan-terms/loan/{loanId}/next-term:
 *   get:
 *     summary: Get next term number for a loan
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Next term number retrieved successfully
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get("/loan/:loanId/next-term", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  loanTermController.getNextTermNumber
);

/**
 * @swagger
 * /api/v1/loan-terms/loan/{loanId}/renew:
 *   post:
 *     summary: Create a renewal term for a loan
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
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
 *               - renewal_type
 *             properties:
 *               renewal_type:
 *                 type: string
 *                 enum: [interest_only_renewal, partial_principal_renewal, full_settlement]
 *               payment_amount:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Renewal term created successfully
 *       400:
 *         description: Invalid renewal type or data
 *       404:
 *         description: Loan not found or no existing terms
 *       401:
 *         description: Unauthorized
 */
router.post("/loan/:loanId/renew", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  loanTermController.createRenewalTerm
);

/**
 * @swagger
 * /api/v1/loan-terms/stats:
 *   get:
 *     summary: Get loan term statistics
 *     tags: [Loan Terms]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Loan term statistics
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", 
  requireRoles('admin_pawn_limited', 'management'),
  loanTermController.getLoanTermStats
);

module.exports = router;