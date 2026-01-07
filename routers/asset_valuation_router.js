const express = require("express");
const router = express.Router();
const assetValuationController = require("../controllers/asset_valuation_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Asset Valuations
 *   description: Asset valuation management endpoints
 */

/**
 * @swagger
 * /api/v1/asset-valuations:
 *   post:
 *     summary: Create a new asset valuation request
 *     tags: [Asset Valuations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - asset
 *               - stage
 *             properties:
 *               asset:
 *                 type: string
 *               stage:
 *                 type: string
 *                 enum: [market, final]
 *               status:
 *                 type: string
 *                 enum: [requested, in_progress, completed, rejected]
 *                 default: requested
 *               requested_by:
 *                 type: string
 *               assessment_date:
 *                 type: string
 *                 format: date
 *               method:
 *                 type: string
 *                 enum: [manual, market_trend, hybrid]
 *               estimated_market_value:
 *                 type: number
 *               desired_loan_amount:
 *                 type: number
 *               comments:
 *                 type: string
 *               currency:
 *                 type: string
 *                 enum: [USD, ZWG]
 *     responses:
 *       201:
 *         description: Valuation request created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Asset not found
 */
router.post(
  "/",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited"
  ),
  assetValuationController.createValuation
);

/**
 * @swagger
 * /api/v1/asset-valuations:
 *   get:
 *     summary: Get valuations with pagination
 *     tags: [Asset Valuations]
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
 *         name: asset
 *         schema:
 *           type: string
 *       - in: query
 *         name: stage
 *         schema:
 *           type: string
 *           enum: [market, final]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [requested, in_progress, completed, rejected]
 *       - in: query
 *         name: requested_by
 *         schema:
 *           type: string
 *       - in: query
 *         name: valued_by_user
 *         schema:
 *           type: string
 *       - in: query
 *         name: requested_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: requested_to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: assessment_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: assessment_to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: min_market_value
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_market_value
 *         schema:
 *           type: number
 *       - in: query
 *         name: min_loan_value
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_loan_value
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
 *         description: Valuations retrieved successfully
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
  assetValuationController.getValuations
);

/**
 * @swagger
 * /api/v1/asset-valuations/all:
 *   get:
 *     summary: Get all valuations without pagination
 *     tags: [Asset Valuations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: asset
 *         schema:
 *           type: string
 *       - in: query
 *         name: stage
 *         schema:
 *           type: string
 *           enum: [market, final]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [requested, in_progress, completed, rejected]
 *       - in: query
 *         name: requested_by
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
 *         description: All valuations retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/all",
  requireRoles("admin_pawn_limited", "management"),
  assetValuationController.getAllValuations
);

/**
 * @swagger
 * /api/v1/asset-valuations/search:
 *   get:
 *     summary: Search valuations
 *     tags: [Asset Valuations]
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
  assetValuationController.searchValuations
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}:
 *   get:
 *     summary: Get valuation by ID
 *     tags: [Asset Valuations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Valuation ID
 *     responses:
 *       200:
 *         description: Valuation details
 *       404:
 *         description: Valuation not found
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
  assetValuationController.getValuation
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}:
 *   put:
 *     summary: Update valuation
 *     tags: [Asset Valuations]
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
 *               stage:
 *                 type: string
 *                 enum: [market, final]
 *               status:
 *                 type: string
 *                 enum: [requested, in_progress, completed, rejected]
 *               method:
 *                 type: string
 *                 enum: [manual, market_trend, hybrid]
 *               estimated_market_value:
 *                 type: number
 *               estimated_loan_value:
 *                 type: number
 *               final_value:
 *                 type: number
 *               comments:
 *                 type: string
 *               desired_loan_amount:
 *                 type: number
 *               assessment_date:
 *                 type: string
 *                 format: date
 *               currency:
 *                 type: string
 *                 enum: [USD, ZWG]
 *               credit_check:
 *                 type: object
 *                 properties:
 *                   provider:
 *                     type: string
 *                   reference:
 *                     type: string
 *                   score:
 *                     type: number
 *                   checked_at:
 *                     type: string
 *                     format: date
 *     responses:
 *       200:
 *         description: Valuation updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Valuation not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:id",
  requireRoles("loan_officer_approval", "admin_pawn_limited"),
  assetValuationController.updateValuation
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}/status:
 *   put:
 *     summary: Update valuation status
 *     tags: [Asset Valuations]
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
 *                 enum: [requested, in_progress, completed, rejected]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Valuation not found
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/:id/status",
  requireRoles("loan_officer_approval", "admin_pawn_limited"),
  assetValuationController.updateValuationStatus
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}:
 *   delete:
 *     summary: Delete valuation
 *     tags: [Asset Valuations]
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
 *         description: Valuation deleted successfully
 *       400:
 *         description: Cannot delete completed valuation
 *       404:
 *         description: Valuation not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/:id",
  requireRoles("admin_pawn_limited"),
  assetValuationController.deleteValuation
);

/**
 * @swagger
 * /api/v1/asset-valuations/asset/{assetId}:
 *   get:
 *     summary: Get valuations by asset ID
 *     tags: [Asset Valuations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: assetId
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
 *         description: Asset's valuations retrieved successfully
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/asset/:assetId",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  assetValuationController.getValuationsByAsset
);

/**
 * @swagger
 * /api/v1/asset-valuations/customer/{customerId}:
 *   get:
 *     summary: Get valuations by customer
 *     tags: [Asset Valuations]
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
 *         description: Customer's valuations retrieved successfully
 *       404:
 *         description: Customer not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/customer/:customerId",
  requireRoles(
    "loan_officer_processor",
    "loan_officer_approval",
    "admin_pawn_limited",
    "management"
  ),
  assetValuationController.getValuationsByCustomer
);

/**
 * @swagger
 * /api/v1/asset-valuations/stats:
 *   get:
 *     summary: Get valuation statistics
 *     tags: [Asset Valuations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Valuation statistics
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/stats",
  requireRoles("admin_pawn_limited", "management"),
  assetValuationController.getValuationStats
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}/complete-market:
 *   post:
 *     summary: Complete market valuation and proceed to final stage
 *     tags: [Asset Valuations]
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
 *               - estimated_market_value
 *             properties:
 *               estimated_market_value:
 *                 type: number
 *               comments:
 *                 type: string
 *     responses:
 *       200:
 *         description: Market valuation completed and final valuation requested
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Valuation not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:id/complete-market",
  requireRoles("loan_officer_approval", "admin_pawn_limited"),
  assetValuationController.completeMarketValuation
);

/**
 * @swagger
 * /api/v1/asset-valuations/{id}/complete-final:
 *   post:
 *     summary: Complete final valuation with loan amount decision
 *     tags: [Asset Valuations]
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
 *               - final_value
 *               - desired_loan_amount
 *               - comments
 *             properties:
 *               final_value:
 *                 type: number
 *               desired_loan_amount:
 *                 type: number
 *               comments:
 *                 type: string
 *               credit_check:
 *                 type: object
 *                 properties:
 *                   provider:
 *                     type: string
 *                   reference:
 *                     type: string
 *                   score:
 *                     type: number
 *                   checked_at:
 *                     type: string
 *                     format: date
 *     responses:
 *       200:
 *         description: Final valuation completed successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Valuation not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:id/complete-final",
  requireRoles("loan_officer_approval", "admin_pawn_limited"),
  assetValuationController.completeFinalValuation
);

module.exports = router;
