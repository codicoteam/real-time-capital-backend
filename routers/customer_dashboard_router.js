const express = require("express");
const router = express.Router();
const customerDashboardController = require("../controllers/customerDashboard.controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Customer Dashboard (Staff)
 *   description: Staff endpoints to view any customer's dashboard
 */

/**
 * @swagger
 * /api/v1/customer/dashboard/{userId}:
 *   get:
 *     summary: Get full dashboard data for a specific customer (staff only)
 *     tags: [Customer Dashboard (Staff)]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the customer to fetch dashboard for
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
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
 *                     profile:
 *                       type: object
 *                     assets:
 *                       type: array
 *                     auctions:
 *                       type: array
 *                     bids:
 *                       type: array
 *                     bid_payments:
 *                       type: array
 *                     debtor_records:
 *                       type: array
 *                     loans:
 *                       type: array
 *                     loan_applications:
 *                       type: array
 *                     loan_payments:
 *                       type: array
 *                     metrics:
 *                       type: object
 *                     graphs:
 *                       type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request / error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden – insufficient role
 */
router.get(
  "/dashboard/:userId",
  authMiddleware,
  // Allow all roles except 'customer'
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_approval",
    "loan_officer_processor",
    "call_centre_support",
  ),
  customerDashboardController.getDashboard,
);

module.exports = router;
