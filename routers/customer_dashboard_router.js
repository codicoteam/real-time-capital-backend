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
 *   name: Customer Dashboard
 *   description: Comprehensive customer analytics dashboard
 */

/**
 * @swagger
 * /api/v1/customer/dashboard:
 *   get:
 *     summary: Get full dashboard data for the authenticated customer
 *     tags: [Customer Dashboard]
 *     security:
 *       - bearerAuth: []
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
 *         description: Forbidden – not a customer
 */
router.get(
  "/dashboard",
  authMiddleware,
  requireRoles("customer"),
  customerDashboardController.getDashboard,
);

module.exports = router;
