"use strict";

const express = require("express");
const router = express.Router();
const loginActivityController = require("../controllers/login_activity_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

// Admin-only visibility into who has logged in — staff, customers, and investors.
router.use(authMiddleware);
router.use(requireRoles("super_admin_vendor", "admin_pawn_limited", "management"));

/**
 * @swagger
 * /api/v1/login-activity:
 *   get:
 *     summary: Paginated login history across staff, customers, and investors
 *     tags: [Login Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: user_type
 *         schema:
 *           type: string
 *           enum: [user, investor]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Filter by a specific role/kind (e.g. loan_officer_processor, customer, individual)
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: start
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Login activity retrieved
 *       401:
 *         description: Unauthorized
 */
router.get("/", loginActivityController.list);

/**
 * @swagger
 * /api/v1/login-activity/stats:
 *   get:
 *     summary: Quick login stats (today's count, unique users, breakdown by population)
 *     tags: [Login Activity]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Login stats retrieved
 *       401:
 *         description: Unauthorized
 */
router.get("/stats", loginActivityController.stats);

module.exports = router;
