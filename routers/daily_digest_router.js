"use strict";

const express = require("express");
const router = express.Router();
const dailyDigestController = require("../controllers/daily_digest_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

router.use(authMiddleware);
router.use(requireRoles("super_admin_vendor", "admin_pawn_limited", "management"));

/**
 * @swagger
 * /api/v1/daily-digest/preview:
 *   get:
 *     summary: Preview the activity digest for a given day without sending an email
 *     tags: [Daily Digest]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Defaults to today (CAT) if omitted
 *     responses:
 *       200:
 *         description: Digest preview generated
 *       401:
 *         description: Unauthorized
 */
router.get("/preview", dailyDigestController.preview);

/**
 * @swagger
 * /api/v1/daily-digest/send-now:
 *   post:
 *     summary: Manually send today's activity digest email to all admins immediately
 *     tags: [Daily Digest]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Digest sent
 *       401:
 *         description: Unauthorized
 */
router.post("/send-now", requireRoles("super_admin_vendor"), dailyDigestController.sendNow);

module.exports = router;
