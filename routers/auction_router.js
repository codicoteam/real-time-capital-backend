const express = require("express");
const router = express.Router();
const AuctionController = require("../controllers/auction_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Auctions
 *   description: Auction management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Auction:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         auction_no:
 *           type: string
 *         asset:
 *           $ref: '#/components/schemas/Asset'
 *         starting_bid_amount:
 *           type: number
 *         reserve_price:
 *           type: number
 *         auction_type:
 *           type: string
 *           enum: ["online", "in_person"]
 *         starts_at:
 *           type: string
 *           format: date-time
 *         ends_at:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: ["draft", "live", "closed", "cancelled"]
 *         winner_user:
 *           $ref: '#/components/schemas/User'
 *         winning_bid_amount:
 *           type: number
 *         created_by:
 *           $ref: '#/components/schemas/User'
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *
 *     Asset:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         asset_no:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         category:
 *           type: string
 *           enum: ["electronics", "vehicle", "jewellery"]
 *         condition:
 *           type: string
 *         status:
 *           type: string
 *         evaluated_value:
 *           type: number
 *         owner_user:
 *           $ref: '#/components/schemas/User'
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
 *         mime_type:
 *           type: string
 *         category:
 *           type: string
 *
 *     CreateAuctionRequest:
 *       type: object
 *       required:
 *         - asset
 *         - starting_bid_amount
 *         - starts_at
 *         - ends_at
 *       properties:
 *         asset:
 *           type: string
 *           description: Asset ID
 *         starting_bid_amount:
 *           type: number
 *           minimum: 0
 *         reserve_price:
 *           type: number
 *           minimum: 0
 *         auction_type:
 *           type: string
 *           enum: ["online", "in_person"]
 *           default: "online"
 *         starts_at:
 *           type: string
 *           format: date-time
 *         ends_at:
 *           type: string
 *           format: date-time
 *
 *     UpdateAuctionRequest:
 *       type: object
 *       properties:
 *         starting_bid_amount:
 *           type: number
 *           minimum: 0
 *         reserve_price:
 *           type: number
 *           minimum: 0
 *         auction_type:
 *           type: string
 *           enum: ["online", "in_person"]
 *         starts_at:
 *           type: string
 *           format: date-time
 *         ends_at:
 *           type: string
 *           format: date-time
 *
 *     UpdateAuctionStatusRequest:
 *       type: object
 *       required:
 *         - status
 *       properties:
 *         status:
 *           type: string
 *           enum: ["draft", "live", "closed", "cancelled"]
 *
 *     PlaceBidRequest:
 *       type: object
 *       required:
 *         - amount
 *       properties:
 *         amount:
 *           type: number
 *           minimum: 0
 *
 *     Bid:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         auction:
 *           type: string
 *         bidder_user:
 *           $ref: '#/components/schemas/User'
 *         amount:
 *           type: number
 *         placed_at:
 *           type: string
 *           format: date-time
 *         payment_status:
 *           type: string
 *           enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"]
 *         dispute:
 *           type: object
 *           properties:
 *             status:
 *               type: string
 *               enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"]
 */

/**
 * @swagger
 * /api/v1/auctions:
 *   post:
 *     summary: Create a new auction
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAuctionRequest'
 *     responses:
 *       201:
 *         description: Auction created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Auction'
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
  AuctionController.createAuction
);

/**
 * @swagger
 * /api/v1/auctions:
 *   get:
 *     summary: Get auctions with pagination and filters
 *     tags: [Auctions]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["draft", "live", "closed", "cancelled"]
 *         description: Filter by status
 *       - in: query
 *         name: auction_type
 *         schema:
 *           type: string
 *           enum: ["online", "in_person"]
 *         description: Filter by auction type
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: ["electronics", "vehicle", "jewellery"]
 *         description: Filter by asset category
 *       - in: query
 *         name: asset_id
 *         schema:
 *           type: string
 *         description: Filter by specific asset
 *       - in: query
 *         name: created_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date from
 *       - in: query
 *         name: created_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by creation date to
 *       - in: query
 *         name: starts_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by start date from
 *       - in: query
 *         name: starts_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by start date to
 *       - in: query
 *         name: ends_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by end date from
 *       - in: query
 *         name: ends_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by end date to
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search auction number
 *       - in: query
 *         name: sort_by
 *         schema:
 *           type: string
 *           default: created_at
 *           enum: [created_at, updated_at, starts_at, ends_at]
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
 *         description: Auctions retrieved successfully
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
 *                     auctions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Auction'
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
router.get("/", AuctionController.getAuctions);

/**
 * @swagger
 * /api/v1/auctions/live:
 *   get:
 *     summary: Get live auctions
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: ["electronics", "vehicle", "jewellery"]
 *         description: Filter by asset category
 *     responses:
 *       200:
 *         description: Live auctions retrieved successfully
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
 *                     $ref: '#/components/schemas/Auction'
 *       401:
 *         description: Unauthorized
 */
router.get("/live", AuctionController.getLiveAuctions);

/**
 * @swagger
 * /api/v1/auctions/{id}:
 *   get:
 *     summary: Get auction by ID with details
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     responses:
 *       200:
 *         description: Auction details with asset images
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
 *                     auction:
 *                       $ref: '#/components/schemas/Auction'
 *                     current_bid:
 *                       $ref: '#/components/schemas/Bid'
 *       404:
 *         description: Auction not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id", AuctionController.getAuction);

/**
 * @swagger
 * /api/v1/auctions/{id}:
 *   put:
 *     summary: Update auction
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAuctionRequest'
 *     responses:
 *       200:
 *         description: Auction updated successfully
 *       400:
 *         description: Invalid input data or cannot update auction
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Auction not found
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
  AuctionController.updateAuction
);

/**
 * @swagger
 * /api/v1/auctions/{id}/status:
 *   put:
 *     summary: Update auction status
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAuctionStatusRequest'
 *     responses:
 *       200:
 *         description: Auction status updated successfully
 *       400:
 *         description: Invalid status or status transition
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Auction not found
 */
router.put(
  "/:id/status",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management",
    "super_admin_vendor"
  ),
  AuctionController.updateAuctionStatus
);

/**
 * @swagger
 * /api/v1/auctions/{id}/bids:
 *   post:
 *     summary: Place a bid on auction
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlaceBidRequest'
 *     responses:
 *       201:
 *         description: Bid placed successfully
 *       400:
 *         description: Invalid bid amount or auction not eligible
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Cannot bid on own asset or has pending dispute
 *       404:
 *         description: Auction not found
 */
router.post("/:id/bids", AuctionController.placeBid);

/**
 * @swagger
 * /api/v1/auctions/{id}/bids:
 *   get:
 *     summary: Get bids for an auction
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
router.get("/:id/bids", AuctionController.getAuctionBids);

/**
 * @swagger
 * /api/v1/auctions/stats:
 *   get:
 *     summary: Get auction statistics
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Auction statistics
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
 *                     draft:
 *                       type: integer
 *                     live:
 *                       type: integer
 *                     closed:
 *                       type: integer
 *                     cancelled:
 *                       type: integer
 *                     total_starting_value:
 *                       type: number
 *                     total_winning_value:
 *                       type: number
 *                     todays_auctions:
 *                       type: integer
 *                     upcoming_auctions:
 *                       type: integer
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
  AuctionController.getAuctionStats
);

/**
 * @swagger
 * /api/v1/auctions/{id}:
 *   delete:
 *     summary: Delete auction
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Auction ID
 *     responses:
 *       200:
 *         description: Auction deleted successfully
 *       400:
 *         description: Cannot delete auction with bids or live auction
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Auction not found
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited", "management", "super_admin_vendor"),
  AuctionController.deleteAuction
);

/**
 * @swagger
 * /api/v1/auctions/users/{userId}/bids:
 *   get:
 *     summary: Get user's bidding history
 *     tags: [Auctions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["draft", "live", "closed", "cancelled"]
 *         description: Filter by auction status
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
 *     responses:
 *       200:
 *         description: User's bidding history
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
 *       403:
 *         description: Cannot view other user's bidding history
 */
router.get("/users/:userId/bids", AuctionController.getUserBiddingHistory);

/**
 * @swagger
 * /api/v1/auctions/search:
 *   get:
 *     summary: Search auctions
 *     tags: [Auctions]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["draft", "live", "closed", "cancelled"]
 *         description: Filter by auction status
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
 *                     $ref: '#/components/schemas/Auction'
 *       400:
 *         description: Search term too short
 *       401:
 *         description: Unauthorized
 */
router.get("/search", AuctionController.searchAuctions);

module.exports = router;
