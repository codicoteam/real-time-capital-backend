const express = require("express");
const router = express.Router();
const assetController = require("../controllers/asset_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

// Apply authentication middleware to all routes
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Assets
 *   description: Asset management endpoints
 */

/**
 * @swagger
 * /api/v1/assets:
 *   post:
 *     summary: Create a new asset
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - category
 *               - title
 *               - owner_user
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [electronics, vehicle, jewellery]
 *               title:
 *                 type: string
 *               owner_user:
 *                 type: string
 *               asset_type:
 *                 type: string
 *                 enum: [ElectronicsAsset, VehicleAsset, JewelleryAsset]
 *               description:
 *                 type: string
 *               condition:
 *                 type: string
 *     responses:
 *       201:
 *         description: Asset created successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Asset number already exists
 */
router.post("/", 
  requireRoles('customer', 'loan_officer_processor', 'admin_pawn_limited'),
  assetController.createAsset
);

/**
 * @swagger
 * /api/v1/assets:
 *   get:
 *     summary: Get assets with pagination
 *     tags: [Assets]
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
 *           enum: [electronics, vehicle, jewellery]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: owner_user
 *         schema:
 *           type: string
 *       - in: query
 *         name: asset_no
 *         schema:
 *           type: string
 *       - in: query
 *         name: title
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
 *         description: Assets retrieved successfully
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
router.get("/", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  assetController.getAssets
);

/**
 * @swagger
 * /api/v1/assets/all:
 *   get:
 *     summary: Get all assets without pagination
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [electronics, vehicle, jewellery]
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [submitted, valuating, pawned, active, overdue, in_repair, auction, sold, redeemed, closed]
 *       - in: query
 *         name: owner_user
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
 *         description: All assets retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/all", 
  requireRoles('admin_pawn_limited', 'management'),
  assetController.getAllAssets
);

/**
 * @swagger
 * /api/v1/assets/search:
 *   get:
 *     summary: Search assets
 *     tags: [Assets]
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
router.get("/search", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  assetController.searchAssets
);

/**
 * @swagger
 * /api/v1/assets/{id}:
 *   get:
 *     summary: Get asset by ID
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Asset ID
 *     responses:
 *       200:
 *         description: Asset details
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.get("/:id", 
  requireRoles('customer', 'loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  assetController.getAsset
);

/**
 * @swagger
 * /api/v1/assets/{id}:
 *   put:
 *     summary: Update asset
 *     tags: [Assets]
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
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               condition:
 *                 type: string
 *               storage_location:
 *                 type: string
 *     responses:
 *       200:
 *         description: Asset updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.put("/:id", 
  requireRoles('loan_officer_processor', 'admin_pawn_limited'),
  assetController.updateAsset
);

/**
 * @swagger
 * /api/v1/assets/{id}/valuation:
 *   put:
 *     summary: Update asset valuation
 *     tags: [Assets]
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
 *               - evaluated_value
 *             properties:
 *               evaluated_value:
 *                 type: number
 *               valuation_notes:
 *                 type: string
 *               declared_value:
 *                 type: number
 *     responses:
 *       200:
 *         description: Valuation updated successfully
 *       400:
 *         description: Invalid input data
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.put("/:id/valuation", 
  requireRoles('loan_officer_approval', 'admin_pawn_limited'),
  assetController.updateValuation
);

/**
 * @swagger
 * /api/v1/assets/{id}/status:
 *   put:
 *     summary: Update asset status
 *     tags: [Assets]
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
 *                 enum: [submitted, valuating, pawned, active, overdue, in_repair, auction, sold, redeemed, closed]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated successfully
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.put("/:id/status", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited'),
  assetController.updateStatus
);

/**
 * @swagger
 * /api/v1/assets/{id}:
 *   delete:
 *     summary: Delete asset (soft delete)
 *     tags: [Assets]
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
 *         description: Asset deleted successfully
 *       400:
 *         description: Cannot delete asset with active loan
 *       404:
 *         description: Asset not found
 *       401:
 *         description: Unauthorized
 */
router.delete("/:id", 
  requireRoles('admin_pawn_limited'),
  assetController.deleteAsset
);

/**
 * @swagger
 * /api/v1/assets/owner/{ownerId}:
 *   get:
 *     summary: Get assets by owner
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ownerId
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
 *         description: Owner's assets retrieved successfully
 *       404:
 *         description: Owner not found
 *       401:
 *         description: Unauthorized
 */
router.get("/owner/:ownerId", 
  requireRoles('loan_officer_processor', 'loan_officer_approval', 'admin_pawn_limited', 'management'),
  assetController.getAssetsByOwner
);

/**
 * @swagger
 * /api/v1/assets/stats:
 *   get:
 *     summary: Get asset statistics
 *     tags: [Assets]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Asset statistics
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", 
  requireRoles('admin_pawn_limited', 'management'),
  assetController.getAssetStats
);

module.exports = router;