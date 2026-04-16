const Notification = require("../models/notifications_model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

class NotificationService {
  /**
   * Create a new notification with audience resolution
   */
  static async createNotification(data, createdBy) {
    try {
      const {
        title,
        message,
        type = "system_notice",
        priority = "normal",
        audience = { scope: "all" },
        channels = ["in_app"],
        entity_type = null,
        entity_id = null,
        send_at = null,
        expires_at = null,
        action_text = null,
        action_url = null,
        data: payload = {},
      } = data;

      // Basic validation
      if (!title || !message) {
        return {
          success: false,
          message: "Title and message are required",
          statusCode: 400,
        };
      }

      // Validate audience structure
      if (!audience.scope) {
        return {
          success: false,
          message: "Audience scope is required",
          statusCode: 400,
        };
      }

      // For specific scopes, ensure required fields are provided
      if (audience.scope === "user" && !audience.user_id) {
        return {
          success: false,
          message: "user_id is required when scope is 'user'",
          statusCode: 400,
        };
      }
      if (audience.scope === "users" && (!audience.user_ids || audience.user_ids.length === 0)) {
        return {
          success: false,
          message: "user_ids array is required when scope is 'users'",
          statusCode: 400,
        };
      }
      if (audience.scope === "roles" && (!audience.roles || audience.roles.length === 0)) {
        return {
          success: false,
          message: "roles array is required when scope is 'roles'",
          statusCode: 400,
        };
      }

      // Determine initial status based on send_at
      let status = "draft";
      if (send_at && new Date(send_at) > new Date()) {
        status = "scheduled";
      } else if (!send_at || new Date(send_at) <= new Date()) {
        status = "sent";
        send_at = new Date(); // sent now
      }

      const notification = new Notification({
        title,
        message,
        type,
        priority,
        audience,
        channels,
        entity_type,
        entity_id,
        send_at,
        sent_at: status === "sent" ? new Date() : null,
        expires_at,
        status,
        action_text,
        action_url,
        data: payload,
        created_by: createdBy,
      });

      await notification.save();

      // Optionally populate created_by for response
      const populated = await Notification.findById(notification._id).populate(
        "created_by",
        "first_name last_name email"
      );

      return {
        success: true,
        data: populated,
        message: `Notification ${status === "scheduled" ? "scheduled" : "sent"} successfully`,
      };
    } catch (error) {
      console.error("Create notification error:", error);
      throw new Error(error.message || "Failed to create notification");
    }
  }

  /**
   * Build query to find notifications for a specific user based on audience rules
   */
  static buildUserAudienceQuery(userId, userRoles) {
    const now = new Date();
    return {
      $and: [
        { is_active: true },
        { status: "sent" },
        {
          $or: [
            { "audience.scope": "all" },
            { "audience.scope": "user", "audience.user_id": userId },
            { "audience.scope": "users", "audience.user_ids": userId },
            {
              "audience.scope": "roles",
              "audience.roles": { $in: userRoles },
            },
          ],
        },
        {
          $or: [
            { expires_at: null },
            { expires_at: { $gt: now } },
          ],
        },
      ],
    };
  }

  /**
   * Get notifications for the authenticated user (inbox)
   */
  static async getUserNotifications(user, filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "desc",
      } = pagination;

      const { type, priority, is_read, has_acted } = filters;

      const baseQuery = this.buildUserAudienceQuery(user._id, user.roles);

      // Additional filters
      if (type) baseQuery.type = type;
      if (priority) baseQuery.priority = priority;

      // Read/unread filter (based on acknowledgements array)
      if (is_read === "true" || is_read === true) {
        baseQuery["acknowledgements"] = {
          $elemMatch: { user_id: user._id, read_at: { $ne: null } },
        };
      } else if (is_read === "false" || is_read === false) {
        baseQuery.$or = [
          { acknowledgements: { $size: 0 } },
          {
            acknowledgements: {
              $not: {
                $elemMatch: { user_id: user._id, read_at: { $ne: null } },
              },
            },
          },
        ];
      }

      if (has_acted === "true" || has_acted === true) {
        baseQuery["acknowledgements"] = {
          $elemMatch: { user_id: user._id, acted_at: { $ne: null } },
        };
      } else if (has_acted === "false" || has_acted === false) {
        baseQuery.$or = [
          { acknowledgements: { $size: 0 } },
          {
            acknowledgements: {
              $not: {
                $elemMatch: { user_id: user._id, acted_at: { $ne: null } },
              },
            },
          },
        ];
      }

      const skip = (page - 1) * limit;
      const sortOptions = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(baseQuery)
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .populate("created_by", "first_name last_name email")
          .lean(),
        Notification.countDocuments(baseQuery),
        Notification.countDocuments({
          ...baseQuery,
          $or: [
            { acknowledgements: { $size: 0 } },
            {
              acknowledgements: {
                $not: {
                  $elemMatch: { user_id: user._id, read_at: { $ne: null } },
                },
              },
            },
          ],
        }),
      ]);

      // Attach user-specific read/acted status to each notification
      const enhancedNotifications = notifications.map((notif) => {
        const ack = notif.acknowledgements?.find(
          (a) => a.user_id.toString() === user._id.toString()
        );
        return {
          ...notif,
          is_read: !!ack?.read_at,
          read_at: ack?.read_at || null,
          is_acted: !!ack?.acted_at,
          acted_at: ack?.acted_at || null,
          action_taken: ack?.action || null,
        };
      });

      return {
        success: true,
        data: {
          notifications: enhancedNotifications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
          unread_count: unreadCount,
        },
      };
    } catch (error) {
      console.error("Get user notifications error:", error);
      throw new Error(error.message || "Failed to fetch notifications");
    }
  }

  /**
   * Admin: Get all notifications with filters (no user-specific resolution)
   */
  static async getAllNotifications(filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "desc",
        search,
      } = pagination;

      const { type, priority, status, scope, from_date, to_date } = filters;

      const query = { is_active: true };

      if (type) query.type = type;
      if (priority) query.priority = priority;
      if (status) query.status = status;
      if (scope) query["audience.scope"] = scope;

      if (from_date || to_date) {
        query.created_at = {};
        if (from_date) query.created_at.$gte = new Date(from_date);
        if (to_date) query.created_at.$lte = new Date(to_date);
      }

      if (search && search.length >= 2) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { message: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (page - 1) * limit;
      const sortOptions = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      const [notifications, total] = await Promise.all([
        Notification.find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .populate("created_by", "first_name last_name email")
          .lean(),
        Notification.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          notifications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get all notifications error:", error);
      throw new Error(error.message || "Failed to fetch notifications");
    }
  }

  /**
   * Get a single notification by ID (with user-specific read status)
   */
  static async getNotificationById(id, user) {
    try {
      const notification = await Notification.findOne({
        _id: id,
        is_active: true,
      }).populate("created_by", "first_name last_name email");

      if (!notification) {
        return {
          success: false,
          message: "Notification not found",
          statusCode: 404,
        };
      }

      // Check if user is in audience (for non-admin users)
      // Admin roles can see any notification
      const adminRoles = [
        "super_admin_vendor",
        "admin_pawn_limited",
        "management",
        "loan_officer_approval",
        "loan_officer_processor",
      ];
      const isAdmin = user.roles.some((r) => adminRoles.includes(r));

      if (!isAdmin) {
        const isInAudience = await this.isUserInAudience(notification, user);
        if (!isInAudience) {
          return {
            success: false,
            message: "You don't have permission to view this notification",
            statusCode: 403,
          };
        }
      }

      // Attach user-specific read/acted status
      const ack = notification.acknowledgements.find(
        (a) => a.user_id.toString() === user._id.toString()
      );

      const result = notification.toObject();
      result.is_read = !!ack?.read_at;
      result.read_at = ack?.read_at || null;
      result.is_acted = !!ack?.acted_at;
      result.acted_at = ack?.acted_at || null;
      result.action_taken = ack?.action || null;

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error("Get notification error:", error);
      throw new Error(error.message || "Failed to fetch notification");
    }
  }

  /**
   * Check if a user belongs to the notification audience
   */
  static async isUserInAudience(notification, user) {
    const audience = notification.audience;
    const userId = user._id;
    const userRoles = user.roles;

    switch (audience.scope) {
      case "all":
        return true;
      case "user":
        return audience.user_id?.toString() === userId.toString();
      case "users":
        return audience.user_ids?.some(
          (id) => id.toString() === userId.toString()
        );
      case "roles":
        return audience.roles?.some((role) => userRoles.includes(role));
      default:
        return false;
    }
  }

  /**
   * Mark notification as read for current user
   */
  static async markAsRead(id, user) {
    try {
      const notification = await Notification.findOne({
        _id: id,
        is_active: true,
      });

      if (!notification) {
        return {
          success: false,
          message: "Notification not found",
          statusCode: 404,
        };
      }

      // Check audience
      const inAudience = await this.isUserInAudience(notification, user);
      if (!inAudience) {
        return {
          success: false,
          message: "You don't have permission to access this notification",
          statusCode: 403,
        };
      }

      // Update or add acknowledgement
      const existingAck = notification.acknowledgements.find(
        (a) => a.user_id.toString() === user._id.toString()
      );

      if (existingAck) {
        if (!existingAck.read_at) {
          existingAck.read_at = new Date();
        }
      } else {
        notification.acknowledgements.push({
          user_id: user._id,
          read_at: new Date(),
          acted_at: null,
          action: null,
        });
      }

      await notification.save();

      return {
        success: true,
        message: "Notification marked as read",
      };
    } catch (error) {
      console.error("Mark as read error:", error);
      throw new Error(error.message || "Failed to mark notification as read");
    }
  }

  /**
   * Mark notification as acted (e.g., clicked CTA)
   */
  static async markAsActed(id, user, action = null) {
    try {
      const notification = await Notification.findOne({
        _id: id,
        is_active: true,
      });

      if (!notification) {
        return {
          success: false,
          message: "Notification not found",
          statusCode: 404,
        };
      }

      const inAudience = await this.isUserInAudience(notification, user);
      if (!inAudience) {
        return {
          success: false,
          message: "You don't have permission to access this notification",
          statusCode: 403,
        };
      }

      const existingAck = notification.acknowledgements.find(
        (a) => a.user_id.toString() === user._id.toString()
      );

      if (existingAck) {
        existingAck.acted_at = new Date();
        if (action) existingAck.action = action;
      } else {
        notification.acknowledgements.push({
          user_id: user._id,
          read_at: new Date(), // act implies read
          acted_at: new Date(),
          action: action,
        });
      }

      await notification.save();

      return {
        success: true,
        message: "Action recorded",
      };
    } catch (error) {
      console.error("Mark as acted error:", error);
      throw new Error(error.message || "Failed to record action");
    }
  }

  /**
   * Delete notification (soft delete by setting is_active = false)
   */
  static async deleteNotification(id, user) {
    try {
      const notification = await Notification.findById(id);

      if (!notification) {
        return {
          success: false,
          message: "Notification not found",
          statusCode: 404,
        };
      }

      // Optional: Only allow deletion by creator or admin
      const adminRoles = ["super_admin_vendor", "admin_pawn_limited", "management"];
      const isAdmin = user.roles.some((r) => adminRoles.includes(r));
      const isCreator =
        notification.created_by?.toString() === user._id.toString();

      if (!isAdmin && !isCreator) {
        return {
          success: false,
          message: "You don't have permission to delete this notification",
          statusCode: 403,
        };
      }

      notification.is_active = false;
      await notification.save();

      return {
        success: true,
        message: "Notification deleted successfully",
      };
    } catch (error) {
      console.error("Delete notification error:", error);
      throw new Error(error.message || "Failed to delete notification");
    }
  }

  /**
   * Cancel a scheduled notification
   */
  static async cancelNotification(id, user) {
    try {
      const notification = await Notification.findById(id);

      if (!notification) {
        return {
          success: false,
          message: "Notification not found",
          statusCode: 404,
        };
      }

      if (notification.status !== "scheduled") {
        return {
          success: false,
          message: "Only scheduled notifications can be cancelled",
          statusCode: 400,
        };
      }

      // Permission check similar to delete
      const adminRoles = ["super_admin_vendor", "admin_pawn_limited", "management"];
      const isAdmin = user.roles.some((r) => adminRoles.includes(r));
      const isCreator =
        notification.created_by?.toString() === user._id.toString();

      if (!isAdmin && !isCreator) {
        return {
          success: false,
          message: "You don't have permission to cancel this notification",
          statusCode: 403,
        };
      }

      notification.status = "cancelled";
      await notification.save();

      return {
        success: true,
        message: "Notification cancelled successfully",
      };
    } catch (error) {
      console.error("Cancel notification error:", error);
      throw new Error(error.message || "Failed to cancel notification");
    }
  }

  /**
   * Get notification statistics (admin)
   */
  static async getNotificationStats() {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));

      const [totalSent, totalScheduled, totalRead, totalActed, byType, byPriority] =
        await Promise.all([
          Notification.countDocuments({ status: "sent", is_active: true }),
          Notification.countDocuments({ status: "scheduled", is_active: true }),
          Notification.aggregate([
            { $match: { is_active: true, status: "sent" } },
            { $unwind: "$acknowledgements" },
            { $match: { "acknowledgements.read_at": { $ne: null } } },
            { $count: "total" },
          ]),
          Notification.aggregate([
            { $match: { is_active: true, status: "sent" } },
            { $unwind: "$acknowledgements" },
            { $match: { "acknowledgements.acted_at": { $ne: null } } },
            { $count: "total" },
          ]),
          Notification.aggregate([
            { $match: { is_active: true, status: "sent" } },
            { $group: { _id: "$type", count: { $sum: 1 } } },
          ]),
          Notification.aggregate([
            { $match: { is_active: true, status: "sent" } },
            { $group: { _id: "$priority", count: { $sum: 1 } } },
          ]),
        ]);

      return {
        success: true,
        data: {
          total_sent: totalSent,
          total_scheduled: totalScheduled,
          total_read: totalRead.length > 0 ? totalRead[0].total : 0,
          total_acted: totalActed.length > 0 ? totalActed[0].total : 0,
          by_type: byType,
          by_priority: byPriority,
        },
      };
    } catch (error) {
      console.error("Notification stats error:", error);
      throw new Error(error.message || "Failed to fetch notification statistics");
    }
  }
}

module.exports = NotificationService;