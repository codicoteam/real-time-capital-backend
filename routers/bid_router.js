const express = require("express");
const router = express.Router();
const BidController = require("../controllers/bid_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Bids
 *   description: Bid management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Bid:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         auction:
 *           $ref: '#/components/schemas/Auction'
 *         bidder_user:
 *           $ref: '#/components/schemas/User'
 *         amount:
 *           type: number
 *         currency:
 *           type: string
 *         placed_at:
 *           type: string
 *           format: date-time
 *         dispute:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"]
 *             reason:
 *               type: string
 *             raised_by:
 *               $ref: '#/components/schemas/User'
 *             raised_at:
 *               type: string
 *               format: date-time
 *             resolved_by:
 *               $ref: '#/components/schemas/User'
 *             resolved_at:
 *               type: string
 *               format: date-time
 *             resolution_notes:
 *               type: string
 *         payment_status:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         paid_amount:
 *           type: number
 *         paid_at:
 *           type: string
 *           format: date-time
 *         payment_reference:
 *           type: string
 *         meta:
 *           type: object
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     Auction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         auction_no:
 *           type: string
 *         asset:
 *           $ref: '#/components/schemas/Asset'
 *         status:
 *           type: string
 *         starts_at:
 *           type: string
 *           format: date-time
 *         ends_at:
 *           type: string
 *           format: date-time
 *
 *     Asset:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *         evaluated_value:
 *           type: number
 *         attachments:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Attachment'
 *
 *     Attachment:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         filename:
 *           type: string
 *         url:
 *           type: string
 *
 *     UpdateBidRequest:
 *       type: object
 *       properties:
 *         payment_status:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         paid_amount:
 *           type: number
 *         payment_reference:
 *           type: string
 *         dispute:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"]
 *             resolution_notes:
 *               type: string
 *
 *     UpdatePaymentStatusRequest:
 *       type: object
 *       required:
 *         - payment_status
 *       properties:
 *         payment_status:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         payment_reference:
 *           type: string
 *         paid_amount:
 *           type: number
 *
 *     RaiseDisputeRequest:
 *       type: object
 *       required:
 *         - reason
 *       properties:
 *         reason:
 *           type: string
 *           minLength: 10
 *           maxLength: 1000
 *
 *     ResolveDisputeRequest:
 *       type: object
 *       required:
 *         - status
 *         - resolution_notes
 *       properties:
 *         status:
 *           type: string
 *           enum: ["resolved_valid", "resolved_invalid"]
 *         resolution_notes:
 *           type: string
 *           minLength: 10
 *           maxLength: 1000
 */

/**
 * @swagger
 * /api/v1/bids:
 *   get:
 *     summary: Get bids with pagination and filters
 *     tags: [Bids]
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
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: bidder_user
 *         schema:
 *           type: string
 *         description: Filter by bidder user ID
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
 *       - in: query
 *         name: dispute_status
 *         schema:
 *           type: string
 *           enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"]
 *         description: Filter by dispute status
 *       - in: query
 *         name: min_amount
 *         schema:
 *           type: number
 *         description: Minimum bid amount
 *       - in: query
 *         name: max_amount
 *         schema:
 *           type: number
 *         description: Maximum bid amount
 *       - in: query
 *         name: placed_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by bid placement date from
 *       - in: query
 *         name: placed_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by bid placement date to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by payment reference
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: placed_at
 *           enum: [placed_at, amount, created_at]
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
 *         description: Bids retrieved successfully
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
 *                     bids:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Bid'
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
router.get("/", BidController.getBids);

/**
 * @swagger
 * /api/v1/bids/all:
 *   get:
 *     summary: Get all bids without pagination
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: bidder_user
 *         schema:
 *           type: string
 *         description: Filter by bidder user ID
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
 *       - in: query
 *         name: dispute_status
 *         schema:
 *           type: string
 *           enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"]
 *         description: Filter by dispute status
 *       - in: query
 *         name: min_amount
 *         schema:
 *           type: number
 *         description: Minimum bid amount
 *       - in: query
 *         name: max_amount
 *         schema:
 *           type: number
 *         description: Maximum bid amount
 *     responses:
 *       200:
 *         description: All bids retrieved successfully
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
 *                     $ref: '#/components/schemas/Bid'
 *       401:
 *         description: Unauthorized
 */
router.get("/all", BidController.getAllBids);

/**
 * @swagger
 * /api/v1/bids/{id}:
 *   get:
 *     summary: Get bid by ID with detailed information
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     responses:
 *       200:
 *         description: Bid details with auction and asset information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Bid'
 *       404:
 *         description: Bid not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Access denied to this bid
 */
router.get("/:id", BidController.getBid);

/**
 * @swagger
 * /api/v1/bids/{id}:
 *   put:
 *     summary: Update bid (staff/admin only)
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateBidRequest'
 *     responses:
 *       200:
 *         description: Bid updated successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Bid not found
 */
router.put(
  "/:id",
  requireRoles(
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  BidController.updateBid
);

/**
 * @swagger
 * /api/v1/bids/{id}/payment:
 *   put:
 *     summary: Update bid payment status
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePaymentStatusRequest'
 *     responses:
 *       200:
 *         description: Payment status updated successfully
 *       400:
 *         description: Invalid payment status or status transition
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Bid not found
 */
router.put(
  "/:id/payment",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  BidController.updateBidPaymentStatus
);

/**
 * @swagger
 * /api/v1/bids/{id}/dispute:
 *   post:
 *     summary: Raise a dispute on a bid
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RaiseDisputeRequest'
 *     responses:
 *       200:
 *         description: Dispute raised successfully
 *       400:
 *         description: Invalid dispute data or dispute already exists
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Only bidder can raise dispute
 *       404:
 *         description: Bid not found
 */
router.post("/:id/dispute", BidController.raiseDispute);

/**
 * @swagger
 * /api/v1/bids/{id}/dispute/resolve:
 *   put:
 *     summary: Resolve a dispute (staff/admin only)
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResolveDisputeRequest'
 *     responses:
 *       200:
 *         description: Dispute resolved successfully
 *       400:
 *         description: Invalid resolution data or no active dispute
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Bid not found
 */
router.put(
  "/:id/dispute/resolve",
  requireRoles(
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  BidController.resolveDispute
);

/**
 * @swagger
 * /api/v1/bids/{id}:
 *   delete:
 *     summary: Delete a bid (admin only)
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Bid ID
 *     responses:
 *       200:
 *         description: Bid deleted successfully
 *       400:
 *         description: Cannot delete bid with completed payment or active dispute
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Bid not found
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited", "management", "super_admin_vendor"),
  BidController.deleteBid
);

/**
 * @swagger
 * /api/v1/bids/stats:
 *   get:
 *     summary: Get bid statistics
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: auction_id
 *         schema:
 *           type: string
 *         description: Filter by auction ID
 *       - in: query
 *         name: bidder_user
 *         schema:
 *           type: string
 *         description: Filter by bidder user ID
 *     responses:
 *       200:
 *         description: Bid statistics
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
 *                     total_paid_amount:
 *                       type: number
 *                     payment_status:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           count:
 *                             type: integer
 *                           amount:
 *                             type: number
 *                     dispute_status:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           count:
 *                             type: integer
 *                           amount:
 *                             type: number
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", BidController.getBidStats);

/**
 * @swagger
 * /api/v1/bids/auction/{auctionId}:
 *   get:
 *     summary: Get bids by auction
 *     tags: [Bids]
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
 *         description: Auction bids retrieved successfully
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
 *                     $ref: '#/components/schemas/Bid'
 *       404:
 *         description: Auction not found
 *       401:
 *         description: Unauthorized
 */
router.get("/auction/:auctionId", BidController.getBidsByAuction);

/**
 * @swagger
 * /api/v1/bids/user/{userId}:
 *   get:
 *     summary: Get bids by user
 *     tags: [Bids]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User's bids retrieved successfully
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
 *                     $ref: '#/components/schemas/Bid'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Cannot view other users' bids
 */
router.get("/user/:userId", BidController.getBidsByUser);

/**
 * @swagger
 * /api/v1/bids/search:
 *   get:
 *     summary: Search bids
 *     tags: [Bids]
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
 *         name: bidder_user
 *         schema:
 *           type: string
 *         description: Filter by bidder user ID
 *       - in: query
 *         name: payment_status
 *         schema:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         description: Filter by payment status
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
 *                     $ref: '#/components/schemas/Bid'
 *       400:
 *         description: Search term too short
 *       401:
 *         description: Unauthorized
 */
router.get("/search", BidController.searchBids);

module.exports = router;
