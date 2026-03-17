// routes/email_routes.js
const express = require("express");
const router = express.Router();
const emailController = require("../controllers/email_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Email
 *   description: Email sending endpoints
 */

/**
 * @swagger
 * /api/v1/email:
 *   post:
 *     summary: Send an email message
 *     tags: [Email]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *             properties:
 *               to:
 *                 type: string
 *                 description: Recipient email address
 *               subject:
 *                 type: string
 *                 description: Email subject line
 *               text:
 *                 type: string
 *                 description: Plain text version of the email
 *               html:
 *                 type: string
 *                 description: HTML version of the email
 *             example:
 *               to: "customer@example.com"
 *               subject: "Welcome to Real Time Capital"
 *               text: "Hello, welcome to our service!"
 *               html: "<h1>Welcome</h1><p>Hello, welcome to our service!</p>"
 *     responses:
 *       200:
 *         description: Email sent successfully
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
 *                     to:
 *                       type: string
 *                     subject:
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
router.post("/", authMiddleware, emailController.sendEmail);

module.exports = router;
