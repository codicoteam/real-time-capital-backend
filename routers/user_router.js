// routes/user_router.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/user_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: User management endpoints
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - email
 *         - first_name
 *         - last_name
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 6
 *         first_name:
 *           type: string
 *         last_name:
 *           type: string
 *         phone:
 *           type: string
 *         roles:
 *           type: array
 *           items:
 *             type: string
 *             enum:
 *               - super_admin_vendor
 *               - admin_pawn_limited
 *               - call_centre_support
 *               - loan_officer_processor
 *               - loan_officer_approval
 *               - management
 *               - customer
 *     Login:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *         password:
 *           type: string
 *     OTPVerification:
 *       type: object
 *       required:
 *         - email
 *         - otp
 *       properties:
 *         email:
 *           type: string
 *         otp:
 *           type: string
 *     ResetPassword:
 *       type: object
 *       required:
 *         - email
 *         - otp
 *         - newPassword
 *       properties:
 *         email:
 *           type: string
 *         otp:
 *           type: string
 *         newPassword:
 *           type: string
 */

/**
 * @swagger
 * /api/v1/users/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Invalid input
 *       409:
 *         description: User already exists
 */
router.post("/register", userController.register);

/**
 * @swagger
 * /api/v1/users/verify-email:
 *   post:
 *     summary: Verify email with OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/OTPVerification'
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid OTP or expired
 *       404:
 *         description: User not found
 */
router.post("/verify-email", userController.verifyEmail);

/**
 * @swagger
 * /api/v1/users/resend-verification:
 *   post:
 *     summary: Resend verification OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP resent successfully
 *       400:
 *         description: Email already verified
 *       404:
 *         description: User not found
 */
router.post("/resend-verification", userController.resendVerificationOtp);

/**
 * @swagger
 * /api/v1/users/login:
 *   post:
 *     summary: Login user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Login'
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account not active
 */
router.post("/login", userController.login);

/**
 * @swagger
 * /api/v1/users/forgot-password:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent to email
 */
router.post("/forgot-password", userController.forgotPassword);

/**
 * @swagger
 * /api/v1/users/reset-password:
 *   post:
 *     summary: Reset password with OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResetPassword'
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid OTP or expired
 */
router.post("/reset-password", userController.resetPassword);

/**
 * @swagger
 * /api/v1/users/profile:
 *   get:
 *     summary: Get user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
 *       401:
 *         description: Unauthorized
 */
router.get("/profile", authMiddleware, userController.getProfile);

/**
 * @swagger
 * /api/v1/users/profile:
 *   put:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               address:
 *                 type: string
 *               location:
 *                 type: string
 *               profile_pic_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put("/profile", authMiddleware, userController.updateProfile);

/**
 * @swagger
 * /api/v1/users/documents:
 *   post:
 *     summary: Upload a document
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - url
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [national_id, passport, proof_of_address, other]
 *               url:
 *                 type: string
 *               file_name:
 *                 type: string
 *               mime_type:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *       401:
 *         description: Unauthorized
 */
router.post("/documents", authMiddleware, userController.uploadDocument);

/**
 * @swagger
 * /api/v1/users/documents/{documentId}:
 *   delete:
 *     summary: Remove a document
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Document removed successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Document not found
 */
router.delete("/documents/:documentId", authMiddleware, userController.removeDocument);

/**
 * @swagger
 * /api/v1/users/request-deletion:
 *   post:
 *     summary: Request account deletion
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Deletion OTP sent to email
 *       404:
 *         description: User not found
 */
router.post("/request-deletion", userController.requestAccountDeletion);

/**
 * @swagger
 * /api/v1/users/confirm-deletion:
 *   post:
 *     summary: Confirm account deletion with OTP
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account deleted successfully
 *       400:
 *         description: Invalid OTP or expired
 */
router.post("/confirm-deletion", userController.confirmAccountDeletion);

// =========== ADMIN ROUTES ===========

/**
 * @swagger
 * /api/v1/users:
 *   get:
 *     summary: Get all users (Admin only)
 *     tags: [Users]
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
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, suspended, deleted]
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum:
 *             - super_admin_vendor
 *             - admin_pawn_limited
 *             - call_centre_support
 *             - loan_officer_processor
 *             - loan_officer_approval
 *             - management
 *             - customer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/",
  authMiddleware,
  requireRoles("super_admin_vendor", "admin_pawn_limited", "management"),
  userController.getAllUsers
);

/**
 * @swagger
 * /api/v1/users/admin/register:
 *   post:
 *     summary: Register a new user (Admin only)
 *     description: |
 *       Admin can register users with any role.
 *       - For customer roles: sends OTP to customer email
 *       - For staff roles: sends account creation email (no OTP)
 *       - For super_admin: no email sent
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.post(
  "/admin/register",
  authMiddleware,
  requireRoles("super_admin_vendor", "admin_pawn_limited"),
  userController.register
);

/**
 * @swagger
 * /api/v1/users/{userId}/status:
 *   patch:
 *     summary: Update user status (Admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
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
 *                 enum: [pending, active, suspended, deleted]
 *     responses:
 *       200:
 *         description: User status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 *       404:
 *         description: User not found
 */
router.patch(
  "/:userId/status",
  authMiddleware,
  requireRoles("super_admin_vendor", "admin_pawn_limited"),
  userController.updateUserStatus
);

module.exports = router;