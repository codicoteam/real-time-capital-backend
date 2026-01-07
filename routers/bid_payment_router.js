const express = require("express");
const router = express.Router();
const BidPaymentController = require("../controllers/bid_payment_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes except webhook
router.use((req, res, next) => {
  if (req.path === "/webhook/paynow") {
    return next();
  }
  authMiddleware(req, res, next);
});

/**
 * @swagger
 * tags:
 *   name: Bid Payments
 *   description: Bid payment management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     BidPayment:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         bid:
 *           $ref: '#/components/schemas/Bid'
 *         auction:
 *           $ref: '#/components/schemas/Auction'
 *         payer_user:
 *           $ref: '#/components/schemas/User'
 *         amount:
 *           type: number
 *         currency:
 *           type: string
 *         status:
 *           type: string
 *           enum: ["initiated", "pending", "success", "failed", "refunded", "cancelled"]
 *         method:
 *           type: string
 *           enum: ["cash", "bank", "ecocash", "onemoney", "telecash", "card", "paynow"]
 *         provider:
 *           type: string
 *         provider_txn_id:
 *           type: string
 *         payer_phone:
 *           type: string
 *         redirect_url:
 *           type: string
 *         receipt_no:
 *           type: string
 *         notes:
 *           type: string
 *         paid_at:
 *           type: string
 *           format: date-time
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 * 
 *     CreateBidPaymentRequest:
 *       type: object
 *       required:
 *         - bid_id
 *         - amount
 *         - method
 *       properties:
 *         bid_id:
 *           type: string
 *           description: Bid ID to pay for
 *         amount:
 *           type: number
 *           minimum: 0
 *         method:
 *           type: string
 *           enum: ["cash", "bank", "ecocash", "onemoney", "telecash", "card", "paynow"]
 *         provider:
 *           type: string
 *           description: Payment provider
 *         payer_phone:
 *           type: string
 *           description: Phone number for mobile payments (required for ecocash, onemoney, telecash)
 *           example: "+263771234567"
 *         redirect_url:
 *           type: string
 *           description: URL to redirect after payment (for online payments)
 *         notes:
 *           type: string
 * 
 *     MobilePaymentMethod:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         description:
 *           type: string
 *         icon:
 *           type: string
 *         supported_countries:
 *           type: array
 *           items:
 *             type: string
 *         phone_format:
 *           type: string
 *         default:
 *           type: boolean
 */

/**
 * @swagger
 * /api/v1/bid-payments/methods:
 *   get:
 *     summary: Get available mobile payment methods
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Mobile payment methods retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MobilePaymentMethod'
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.get("/methods", BidPaymentController.getMobilePaymentMethods);

/**
 * @swagger
 * /api/v1/bid-payments:
 *   post:
 *     summary: Create a new bid payment
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateBidPaymentRequest'
 *     responses:
 *       201:
 *         description: Bid payment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   oneOf:
 *                     - $ref: '#/components/schemas/BidPayment'
 *                     - type: object
 *                       properties:
 *                         payment:
 *                           $ref: '#/components/schemas/BidPayment'
 *                         paynow_response:
 *                           type: object
 *                           properties:
 *                             payment_url:
 *                               type: string
 *                             poll_url:
 *                               type: string
 *                             instructions:
 *                               type: string
 *                             method:
 *                               type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid input data, phone number required for mobile payments
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Bid or auction not found
 */
router.post("/", BidPaymentController.createBidPayment);

/**
 * @swagger
 * /api/v1/bid-payments:
 *   get:
 *     summary: Get bid payments with pagination and filters
 *     tags: [Bid Payments]
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
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: bid_id
 *         schema:
 *           type: string
 *         description: Filter by bid ID
 *       - in: query
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: payer_user
 *         schema:
 *           type: string
 *         description: Filter by payer user ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["initiated", "pending", "success", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *           enum: ["cash", "bank", "ecocash", "onemoney", "telecash", "card", "paynow"]
 *         description: Filter by payment method
 *       - in: query
 *         name: min_amount
 *         schema:
 *           type: number
 *         description: Minimum payment amount
 *       - in: query
 *         name: max_amount
 *         schema:
 *           type: number
 *         description: Maximum payment amount
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by receipt number, provider transaction ID, or phone number
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: created_at
 *           enum: [created_at, paid_at, amount]
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
 *         description: Bid payments retrieved successfully
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
 *                     payments:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/BidPayment'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         page:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         total:
 *                           type: integer
 *                         pages:
 *                           type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/", BidPaymentController.getBidPayments);

/**
 * @swagger
 * /api/v1/bid-payments/all:
 *   get:
 *     summary: Get all bid payments without pagination
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: bid_id
 *         schema:
 *           type: string
 *         description: Filter by bid ID
 *       - in: query
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: payer_user
 *         schema:
 *           type: string
 *         description: Filter by payer user ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["initiated", "pending", "success", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *           enum: ["cash", "bank", "ecocash", "onemoney", "telecash", "card", "paynow"]
 *         description: Filter by payment method
 *     responses:
 *       200:
 *         description: All bid payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BidPayment'
 *       401:
 *         description: Unauthorized
 */
router.get("/all", BidPaymentController.getAllBidPayments);

/**
 * @swagger
 * /api/v1/bid-payments/{id}:
 *   get:
 *     summary: Get bid payment by ID with detailed information
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details with bid, auction, and asset information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/BidPayment'
 *       404:
 *         description: Payment not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to this payment
 */
router.get("/:id", BidPaymentController.getBidPayment);

/**
 * @swagger
 * /api/v1/bid-payments/{id}:
 *   put:
 *     summary: Update bid payment (staff only)
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum: ["initiated", "pending", "success", "failed", "refunded", "cancelled"]
 *               method:
 *                 type: string
 *               provider:
 *                 type: string
 *               provider_txn_id:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment updated successfully
 *       400:
 *         description: Invalid input data or status transition
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payment not found
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
  BidPaymentController.updateBidPayment
);

/**
 * @swagger
 * /api/v1/bid-payments/{id}/check-status:
 *   get:
 *     summary: Check payment status (for PayNow and mobile payments)
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment status checked successfully
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
 *                     payment:
 *                       $ref: '#/components/schemas/BidPayment'
 *                     gateway_status:
 *                       type: string
 *                     status:
 *                       type: string
 *                     paid:
 *                       type: boolean
 *                     amount:
 *                       type: number
 *                     method:
 *                       type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Not a supported payment method or no poll URL
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found
 */
router.get("/:id/check-status", BidPaymentController.checkPaymentStatus);

/**
 * @swagger
 * /api/v1/bid-payments/webhook/paynow:
 *   post:
 *     summary: Process PayNow webhook (no authentication required)
 *     tags: [Bid Payments]
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
 *               pollUrl:
 *                 type: string
 *               method:
 *                 type: string
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *       400:
 *         description: Invalid webhook data
 *       404:
 *         description: Payment not found
 */
router.post("/webhook/paynow", BidPaymentController.processPayNowWebhook);

/**
 * @swagger
 * /api/v1/bid-payments/{id}/refund:
 *   post:
 *     summary: Refund bid payment (admin only)
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notes:
 *                 type: string
 *                 description: Reason for refund
 *     responses:
 *       200:
 *         description: Payment refunded successfully
 *       400:
 *         description: Cannot refund payment that is not successful
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payment not found
 */
router.post(
  "/:id/refund",
  requireRoles("admin_pawn_limited", "management", "super_admin_vendor"),
  BidPaymentController.refundBidPayment
);

/**
 * @swagger
 * /api/v1/bid-payments/{id}:
 *   delete:
 *     summary: Delete bid payment (admin only)
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment deleted successfully
 *       400:
 *         description: Cannot delete completed or refunded payments
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Payment not found
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited", "management", "super_admin_vendor"),
  BidPaymentController.deleteBidPayment
);

/**
 * @swagger
 * /api/v1/bid-payments/stats:
 *   get:
 *     summary: Get bid payment statistics
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: payer_user
 *         schema:
 *           type: string
 *         description: Filter by payer user ID
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *         description: Filter by payment method
 *     responses:
 *       200:
 *         description: Payment statistics
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
 *                     total:
 *                       type: integer
 *                     total_amount:
 *                       type: number
 *                     status:
 *                       type: object
 *                     method:
 *                       type: object
 *                     mobile_providers:
 *                       type: object
 *                     todays_payments:
 *                       type: integer
 *                     pending_mobile:
 *                       type: integer
 *                     successful_mobile:
 *                       type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", BidPaymentController.getBidPaymentStats);

/**
 * @swagger
 * /api/v1/bid-payments/auction/{auctionId}:
 *   get:
 *     summary: Get bid payments by auction
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     responses:
 *       200:
 *         description: Auction payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BidPayment'
 *       404:
 *         description: Auction not found
 *       401:
 *         description: Unauthorized
 */
router.get("/auction/:auctionId", BidPaymentController.getPaymentsByAuction);

/**
 * @swagger
 * /api/v1/bid-payments/payer/{payerId}:
 *   get:
 *     summary: Get bid payments by payer
 *     tags: [Bid Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: payerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Payer user ID
 *     responses:
 *       200:
 *         description: Payer's payments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BidPayment'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Cannot view other users' payments
 */
router.get("/payer/:payerId", BidPaymentController.getPaymentsByPayer);

/**
 * @swagger
 * /api/v1/bid-payments/search:
 *   get:
 *     summary: Search bid payments
 *     tags: [Bid Payments]
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
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: payer_user
 *         schema:
 *           type: string
 *         description: Filter by payer user ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["initiated", "pending", "success", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
 *       - in: query
 *         name: method
 *         schema:
 *           type: string
 *           enum: ["cash", "bank", "ecocash", "onemoney", "telecash", "card", "paynow"]
 *         description: Filter by payment method
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BidPayment'
 *       400:
 *         description: Search term too short
 *       401:
 *         description: Unauthorized
 */
router.get("/search", BidPaymentController.searchBidPayments);

module.exports = router;