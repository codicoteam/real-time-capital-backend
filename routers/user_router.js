const express = require("express");
const router = express.Router();
const userController = require("../controllers/user_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

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
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *           minLength: 6
 *           description: Required for self-registration, optional for admin-created users
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
 *               - agent
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
 *     UpdatePassword:
 *       type: object
 *       required:
 *         - current_password
 *         - new_password
 *       properties:
 *         current_password:
 *           type: string
 *         new_password:
 *           type: string
 *           minLength: 6
 *     UpdateProfilePicture:
 *       type: object
 *       required:
 *         - profile_pic_url
 *       properties:
 *         profile_pic_url:
 *           type: string
 *     NextOfKin:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *         relationship:
 *           type: string
 *         phone_number:
 *           type: string
 *         email:
 *           type: string
 *         address:
 *           type: string
 *     KYCUpdate:
 *       type: object
 *       properties:
 *         national_id_number:
 *           type: string
 *         date_of_birth:
 *           type: string
 *           format: date
 *         address:
 *           type: string
 *         location:
 *           type: string
 *         gender:
 *           type: string
 *         marital_status:
 *           type: string
 *         alternative_phone:
 *           type: string
 *         national_id_image_url:
 *           type: string
 *         passport_image_url:
 *           type: string
 *         proof_of_address_url:
 *           type: string
 *         passport_expiry_date:
 *           type: string
 *           format: date
 *         driving_license_expiry_date:
 *           type: string
 *           format: date
 *         national_id_expiry_date:
 *           type: string
 *           format: date
 *         is_employed:
 *           type: boolean
 *         employment_details:
 *           type: object
 *           properties:
 *             employer_name:
 *               type: string
 *             job_title:
 *               type: string
 *             duration:
 *               type: string
 *             location:
 *               type: string
 *             contacts:
 *               type: string
 *     PersonalDetails:
 *       type: object
 *       properties:
 *         first_name:
 *           type: string
 *         last_name:
 *           type: string
 *         phone:
 *           type: string
 *         date_of_birth:
 *           type: string
 *           format: date
 *         address:
 *           type: string
 *         location:
 *           type: string
 *         gender:
 *           type: string
 *         marital_status:
 *           type: string
 *         alternative_phone:
 *           type: string
 *     FCMToken:
 *       type: object
 *       required:
 *         - fcm_token
 *       properties:
 *         fcm_token:
 *           type: string
 *     MyUsersResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             users:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 *             pagination:
 *               type: object
 *               properties:
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 pages:
 *                   type: integer
 *     MyUsersStatsResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             totals:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 active:
 *                   type: integer
 *                 pending:
 *                   type: integer
 *                 suspended:
 *                   type: integer
 *                 verified:
 *                   type: integer
 *                 unverified:
 *                   type: integer
 *             byRole:
 *               type: object
 *               additionalProperties:
 *                 type: integer
 */

/**
 * @swagger
 * /api/v1/users/register:
 *   post:
 *     summary: Register a new user (self-registration)
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
 *     summary: Login user (requires email verification)
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
 *         description: Account not active or email not verified
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
 * /api/v1/users/profile/picture:
 *   put:
 *     summary: Update profile picture (standalone)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProfilePicture'
 *     responses:
 *       200:
 *         description: Profile picture updated successfully
 *       400:
 *         description: Profile picture URL is required
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/profile/picture",
  authMiddleware,
  userController.updateProfilePicture,
);

/**
 * @swagger
 * /api/v1/users/next-of-kin:
 *   put:
 *     summary: Update next of kin details (standalone)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NextOfKin'
 *     responses:
 *       200:
 *         description: Next of kin details updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put("/next-of-kin", authMiddleware, userController.updateNextOfKin);

/**
 * @swagger
 * /api/v1/users/kyc:
 *   put:
 *     summary: Update KYC documents and details (standalone)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/KYCUpdate'
 *     responses:
 *       200:
 *         description: KYC details updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put("/kyc", authMiddleware, userController.updateKycDetails);

/**
 * @swagger
 * /api/v1/users/update-password:
 *   put:
 *     summary: Update password for logged-in user (standalone)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePassword'
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Current password is incorrect or unauthorized
 */
router.put("/update-password", authMiddleware, userController.updatePassword);

/**
 * @swagger
 * /api/v1/users/personal-details:
 *   put:
 *     summary: Update personal details (standalone)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PersonalDetails'
 *     responses:
 *       200:
 *         description: Personal details updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put(
  "/personal-details",
  authMiddleware,
  userController.updatePersonalDetails,
);

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
router.delete(
  "/documents/:documentId",
  authMiddleware,
  userController.removeDocument,
);

/**
 * @swagger
 * /api/v1/users/request-deletion:
 *   post:
 *     summary: Request account deletion (user initiated)
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
 *     summary: Confirm account deletion with OTP (user initiated)
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

// =========== FCM TOKEN ROUTES (PUSH NOTIFICATIONS) ===========

/**
 * @swagger
 * /api/v1/users/fcm-token:
 *   post:
 *     summary: Register FCM token for push notifications
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FCMToken'
 *     responses:
 *       200:
 *         description: FCM token registered successfully
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: FCM token is required
 */
router.post("/fcm-token", authMiddleware, userController.addFcmToken);

/**
 * @swagger
 * /api/v1/users/fcm-token:
 *   delete:
 *     summary: Remove FCM token (logout from current device)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FCMToken'
 *     responses:
 *       200:
 *         description: FCM token removed successfully
 *       401:
 *         description: Unauthorized
 */
router.delete("/fcm-token", authMiddleware, userController.removeFcmToken);

/**
 * @swagger
 * /api/v1/users/fcm-tokens/all:
 *   delete:
 *     summary: Remove all FCM tokens (logout from all devices)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All FCM tokens removed successfully
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/fcm-tokens/all",
  authMiddleware,
  userController.removeAllFcmTokens,
);

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
 *             - agent
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: boolean
 *         description: Include soft-deleted users in results
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
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_processor",
    "loan_officer_approval",
  ),
  userController.getAllUsers,
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
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "agent",
    "loan_officer_processor",
    "loan_officer_approval",
    "management",
  ),
  userController.register,
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
  userController.updateUserStatus,
);

/**
 * @swagger
 * /api/v1/users/{userId}/delete:
 *   delete:
 *     summary: Delete user permanently (Admin only)
 *     description: |
 *       Permanently deletes a user account.
 *       - No notification sent to the customer
 *       - Cannot delete super admin users
 *       - User data is anonymized and marked as deleted
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required or cannot delete super admin
 *       404:
 *         description: User not found
 */
router.delete(
  "/:userId/delete",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "loan_officer_processor",
    "loan_officer_approval",
    "management",
  ),
  userController.adminDeleteUser,
);

/**
 * @swagger
 * /api/v1/users/customers:
 *   post:
 *     summary: Add a new customer (Agent, Loan Officer, Admin)
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
 *               - email
 *               - first_name
 *               - last_name
 *             properties:
 *               email:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 *                 description: Optional – if not provided, user must use email verification flow.
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               address:
 *                 type: string
 *     responses:
 *       201:
 *         description: Customer created, verification OTP sent
 *       403:
 *         description: Not authorized to create customers
 */
router.post(
  "/customers",
  authMiddleware,
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "agent",
    "loan_officer_processor",
    "loan_officer_approval",
  ),
  userController.addCustomer,
);

// =========== AGENT/STAFF ROUTES (Users added by them) ===========

/**
 * @swagger
 * /api/v1/users/my-users:
 *   get:
 *     summary: Get users added by the current agent/staff member
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Returns all users that were added by the authenticated agent, loan officer,
 *       or support staff member. This allows staff to only see customers they have personally onboarded.
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
 *           enum: [customer, agent]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by email, name, or phone
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: boolean
 *         description: Include soft-deleted users
 *     responses:
 *       200:
 *         description: List of users added by the staff member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MyUsersResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Staff access required
 */
router.get(
  "/my-users",
  authMiddleware,
  requireRoles(
    "agent",
    "loan_officer_processor",
    "loan_officer_approval",
    "call_centre_support",
    "management",
  ),
  userController.getMyAddedUsers,
);

/**
 * @swagger
 * /api/v1/users/my-users/stats:
 *   get:
 *     summary: Get statistics about users added by the current agent/staff member
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     description: |
 *       Returns statistical breakdown of users added by the authenticated staff member,
 *       including totals by status, verification status, and roles.
 *     responses:
 *       200:
 *         description: Statistics of users added by the staff member
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MyUsersStatsResponse'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Staff access required
 */
router.get(
  "/my-users/stats",
  authMiddleware,
  requireRoles(
    "agent",
    "loan_officer_processor",
    "loan_officer_approval",
    "call_centre_support",
    "management",
  ),
  userController.getMyAddedUsersStats,
);

/**
 * @swagger
 * /api/v1/users/my-users/{userId}:
 *   get:
 *     summary: Get a specific user added by the current agent/staff member
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to retrieve
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - You don't have permission to view this user
 *       404:
 *         description: User not found
 */
router.get(
  "/my-users/:userId",
  authMiddleware,
  requireRoles(
    "agent",
    "loan_officer_processor",
    "loan_officer_approval",
    "call_centre_support",
    "management",
  ),
  userController.getMyAddedUserById,
);

module.exports = router;
