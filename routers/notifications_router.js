const express = require("express");
const router = express.Router();
const NotificationController = require("../controllers/notifications_controller");
const {
  authMiddleware,
  requireRoles,
} = require("../middlewares/auth_middleware");

// All routes require authentication
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: Notification management and inbox
 */

// ============= USER INBOX ROUTES =============

/**
 * @swagger
 * /api/v1/notifications:
 *   get:
 *     summary: Get current user's notifications (inbox)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: priority
 *         schema: { type: string, enum: [low, normal, high, critical] }
 *       - in: query
 *         name: is_read
 *         schema: { type: boolean }
 *       - in: query
 *         name: has_acted
 *         schema: { type: boolean }
 *       - in: query
 *         name: sort_by
 *         schema: { type: string, default: created_at }
 *       - in: query
 *         name: sort_order
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 */
router.get("/", NotificationController.getUserNotifications);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   get:
 *     summary: Get single notification by ID (user must be in audience)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification details
 *       404:
 *         description: Not found
 *       403:
 *         description: Not authorized to view
 */
router.get("/:id", NotificationController.getNotification);

/**
 * @swagger
 * /api/v1/notifications/{id}/read:
 *   put:
 *     summary: Mark notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Marked as read
 */
router.put("/:id/read", NotificationController.markAsRead);

/**
 * @swagger
 * /api/v1/notifications/{id}/act:
 *   put:
 *     summary: Mark notification as acted (e.g., clicked CTA)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               action:
 *                 type: string
 *     responses:
 *       200:
 *         description: Action recorded
 */
router.put("/:id/act", NotificationController.markAsActed);

// ============= ADMIN ROUTES =============

/**
 * @swagger
 * /api/v1/notifications/admin/all:
 *   get:
 *     summary: Admin - Get all notifications with filters
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: priority
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, scheduled, sent, cancelled] }
 *       - in: query
 *         name: scope
 *         schema: { type: string, enum: [all, user, users, roles] }
 *       - in: query
 *         name: from_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to_date
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notifications retrieved
 */
router.get(
  "/admin/all",
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_approval",
    "loan_officer_processor",
    "call_centre_support",
  ),
  NotificationController.getAllNotifications,
);

/**
 * @swagger
 * /api/v1/notifications:
 *   post:
 *     summary: Create a new notification (admin only)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, message, audience]
 *             properties:
 *               title: { type: string }
 *               message: { type: string }
 *               type: { type: string }
 *               priority: { type: string, enum: [low, normal, high, critical] }
 *               audience:
 *                 type: object
 *                 properties:
 *                   scope: { type: string, enum: [all, user, users, roles] }
 *                   user_id: { type: string }
 *                   user_ids: { type: array, items: { type: string } }
 *                   roles: { type: array, items: { type: string } }
 *               channels: { type: array, items: { type: string, enum: [in_app, email, sms, push] } }
 *               entity_type: { type: string, enum: [loan, loan_application, auction] }
 *               entity_id: { type: string }
 *               send_at: { type: string, format: date-time }
 *               expires_at: { type: string, format: date-time }
 *               action_text: { type: string }
 *               action_url: { type: string }
 *               data: { type: object }
 *     responses:
 *       201:
 *         description: Notification created
 */
router.post(
  "/",
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_approval",
    "loan_officer_processor",
    "call_centre_support",
  ),
  NotificationController.createNotification,
);

/**
 * @swagger
 * /api/v1/notifications/{id}:
 *   delete:
 *     summary: Delete notification (soft delete)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted successfully
 */
router.delete(
  "/:id",
  requireRoles("super_admin_vendor", "admin_pawn_limited", "management"),
  NotificationController.deleteNotification,
);

/**
 * @swagger
 * /api/v1/notifications/{id}/cancel:
 *   post:
 *     summary: Cancel a scheduled notification
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cancelled successfully
 */
router.post(
  "/:id/cancel",
  requireRoles("super_admin_vendor", "admin_pawn_limited", "management"),
  NotificationController.cancelNotification,
);

/**
 * @swagger
 * /api/v1/notifications/stats/overview:
 *   get:
 *     summary: Get notification statistics (admin only)
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved
 */
router.get(
  "/stats/overview",
  requireRoles(
    "super_admin_vendor",
    "admin_pawn_limited",
    "management",
    "loan_officer_approval",
    "loan_officer_processor",
  ),
  NotificationController.getNotificationStats,
);

module.exports = router;
