const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/payment_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Payments
 *   description: Payment management endpoints
 */

/**
 * @swagger
 * /api/v1/payments:
 *   post:
 *     summary: Create a new payment
 *     tags: [Payments]
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
 *               - amount
 *             properties:
 *               loan:
 *                 type: string
 *               loan_term:
 *                 type: string
 *               amount:
 *                 type: number
 *               currency:
 *                 type: string
 *                 enum: [USD, ZWL]
 *               provider:
 *                 type: string
 *                 enum: [paynow, ecocash, bank_transfer, cash]
 *               method:
 *                 type: string
 *                 enum: [card, wallet, bank, cash]
 *               payment_status:
 *                 type: string
 *                 enum: [paid, pending, failed, cancelled, awaiting_confirmation]
 *               interest_component:
 *                 type: number
 *               principal_component:
 *                 type: number
 *               storage_component:
 *                 type: number
 *               penalty_component:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 */
router.post("/", 
  requireRoles('customer', 'loan_officer_processor', 'admin_pawn_limited'),
  paymentController.createPayment
);

/**
 * @swagger
 * /api/v1/payments:
 *   get:
 *     summary: Get payments with pagination
 *     tags: [Payments]
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
 *         name: customer_user
 *         schema:
 *           type: string
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: [paid, pending, failed, cancelled, awaiting_confirmation]
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [paynow, ecocash, bank_transfer, cash]
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [USD, ZWL]
 *       - in: query
 *         name: paid_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: paid_to
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
 *         description: Payments retrieved successfully
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
router.get("/", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  paymentController.getPayments
);

/**
 * @swagger
 * /api/v1/payments/all:
 *   get:
 *     summary: Get all payments without pagination
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: loan
 *         schema:
 *           type: string
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: [paid, pending, failed, cancelled, awaiting_confirmation]
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [paynow, ecocash, bank_transfer, cash]
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
 *         description: All payments retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/all", 
  requireRoles('admin_pawn_limited', 'management'),
  paymentController.getAllPayments
);

/**
 * @swagger
 * /api/v1/payments/{id}:
 *   get:
 *     summary: Get payment by ID
 *     tags: [Payments]
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
 *         description: Payment details
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  paymentController.getPayment
);

/**
 * @swagger
 * /api/v1/payments/{id}:
 *   put:
 *     summary: Update payment
 *     tags: [Payments]
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
 *               payment_status:
 *                 type: string
 *                 enum: [paid, pending, failed, cancelled, awaiting_confirmation]
 *               amount:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 */
router.put("/:id", 
  requireRoles('loan_officer_processor', 'admin_pawn_limited'),
  paymentController.updatePayment
);

/**
 * @swagger
 * /api/v1/payments/{id}/check-status:
 *   get:
 *     summary: Check PayNow payment status
 *     tags: [Payments]
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
 *         description: Payment status checked
 *       400:
 *         description: Not a PayNow payment or no poll URL
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id/check-status", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  paymentController.checkPayNowStatus
);

/**
 * @swagger
 * /api/v1/payments/{id}/refund:
 *   post:
 *     summary: Refund a payment
 *     tags: [Payments]
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
 *               provider_ref:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment refunded successfully
 *       400:
 *         description: Cannot refund unpaid payment
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 */
router.post("/:id/refund", 
  requireRoles('admin_pawn_limited'),
  paymentController.refundPayment
);

/**
 * @swagger
 * /api/v1/payments/customer/{customerId}:
 *   get:
 *     summary: Get payments by customer
 *     tags: [Payments]
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
 *         description: Customer's payments retrieved successfully
 *       404:
 *         description: Customer not found
 *       401:
 *         description: Unauthorized
 */
router.get("/customer/:customerId", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  paymentController.getPaymentsByCustomer
);

/**
 * @swagger
 * /api/v1/payments/loan/{loanId}:
 *   get:
 *     summary: Get payments by loan
 *     tags: [Payments]
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
 *         description: Loan payments retrieved successfully
 *       404:
 *         description: Loan not found
 *       401:
 *         description: Unauthorized
 */
router.get("/loan/:loanId", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  paymentController.getPaymentsByLoan
);

/**
 * @swagger
 * /api/v1/payments/stats:
 *   get:
 *     summary: Get payment statistics
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment statistics
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", 
  requireRoles('admin_pawn_limited', 'management'),
  paymentController.getPaymentStats
);

/**
 * @swagger
 * /api/v1/payments/summary:
 *   get:
 *     summary: Get payment summary for dashboard
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment summary
 *       401:
 *         description: Unauthorized
 */
router.get("/summary", 
  requireRoles('loan_officer_approval', 'admin_pawn_limited', 'management'),
  paymentController.getPaymentSummary
);

/**
 * @swagger
 * /api/v1/payments/report:
 *   get:
 *     summary: Generate payment report
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: [paid, pending, failed, cancelled, awaiting_confirmation]
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [paynow, ecocash, bank_transfer, cash]
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv, pdf]
 *           default: json
 *     responses:
 *       200:
 *         description: Payment report generated
 *       401:
 *         description: Unauthorized
 */
router.get("/report", 
  requireRoles('admin_pawn_limited', 'management'),
  paymentController.generatePaymentReport
);

/**
 * @swagger
 * /api/v1/payments/receipt/{receipt_no}:
 *   get:
 *     summary: Verify payment receipt
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: receipt_no
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment receipt verified
 *       404:
 *         description: Receipt not found
 *       401:
 *         description: Unauthorized
 */
router.get("/receipt/:receipt_no", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  paymentController.verifyReceipt
);

// Public webhook endpoint for PayNow (no authentication required)
/**
 * @swagger
 * /api/v1/payments/webhook/paynow:
 *   post:
 *     summary: PayNow webhook/callback endpoint
 *     tags: [Payments]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reference:
 *                 type: string
 *               status:
 *                 type: string
 *               amount:
 *                 type: number
 *               pollUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid webhook data
 */
router.post("/webhook/paynow", paymentController.processPayNowWebhook);

module.exports = router;