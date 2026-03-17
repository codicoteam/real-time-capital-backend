// routes/sms_routes.js
const express = require("express");
const router = express.Router();
const smsController = require("../controllers/sms_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: SMS
 *   description: SMS sending endpoints
 */

/**
 * @swagger
 * /api/v1/sms:
 *   post:
 *     summary: Send an SMS message
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - body
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Recipient phone number (Zimbabwe format, e.g., 0788647705)
 *               body:
 *                 type: string
 *                 description: SMS message content
 *             example:
 *               phoneNumber: "0788647705"
 *               body: "Your verification code is 123456"
 *     responses:
 *       200:
 *         description: SMS sent successfully
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
 *                     sid:
 *                       type: string
 *                     to:
 *                       type: string
 *                     status:
 *                       type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request / validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post("/", authMiddleware, smsController.sendSms);

module.exports = router;