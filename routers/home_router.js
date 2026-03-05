const express = require("express");
const router = express.Router();
const homeController = require("../controllers/home_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Home
 *   description: Role-based home page data
 */

/**
 * @swagger
 * /api/v1/home:
 *   get:
 *     summary: Get home data for the authenticated user (based on highest role)
 *     tags: [Home]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Home data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   description: Varies by role
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request / error
 *       401:
 *         description: Unauthorized
 */
router.get("/", authMiddleware, homeController.getHomeData);

module.exports = router;