// routes/report_routes.js
const express = require("express");
const router = express.Router();
const reportController = require("../controllers/report_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Report
 *   description: System-wide reports and analytics
 */

/**
 * @swagger
 * /api/v1/report:
 *   get:
 *     summary: Get comprehensive system report (admin only)
 *     tags: [Report]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for report data (ISO format)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for report data (ISO format)
 *     responses:
 *       200:
 *         description: Report data retrieved successfully
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
 *                     summary:
 *                       type: object
 *                     charts:
 *                       type: object
 *                     tables:
 *                       type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request / error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (insufficient role)
 */
router.get("/", authMiddleware, reportController.getReportData);

module.exports = router;
