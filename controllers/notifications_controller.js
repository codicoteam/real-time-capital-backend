const NotificationService = require("../services/notification.service");

class NotificationController {
  /**
   * Create a new notification
   */
  static async createNotification(req, res) {
    try {
      const result = await NotificationService.createNotification(
        req.body,
        req.user._id,
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(201).json(result);
    } catch (error) {
      console.error("Create notification controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get notifications for current user (inbox)
   */
  static async getUserNotifications(req, res) {
    try {
      const filters = {
        type: req.query.type,
        priority: req.query.priority,
        is_read: req.query.is_read,
        has_acted: req.query.has_acted,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 20,
        sort_by: req.query.sort_by || "created_at",
        sort_order: req.query.sort_order || "desc",
      };

      const result = await NotificationService.getUserNotifications(
        req.user,
        filters,
        pagination,
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get user notifications error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Admin: Get all notifications with filters
   */
  static async getAllNotifications(req, res) {
    try {
      const filters = {
        type: req.query.type,
        priority: req.query.priority,
        status: req.query.status,
        scope: req.query.scope,
        from_date: req.query.from_date,
        to_date: req.query.to_date,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 20,
        sort_by: req.query.sort_by || "created_at",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search,
      };

      const result = await NotificationService.getAllNotifications(
        filters,
        pagination,
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get all notifications error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get single notification by ID
   */
  static async getNotification(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is required",
        });
      }

      const result = await NotificationService.getNotificationById(
        id,
        req.user,
      );

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get notification error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is required",
        });
      }

      const result = await NotificationService.markAsRead(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Mark as read error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Mark notification as acted (e.g., clicked CTA)
   */
  static async markAsActed(req, res) {
    try {
      const { id } = req.params;
      const { action } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is required",
        });
      }

      const result = await NotificationService.markAsActed(
        id,
        req.user,
        action,
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Mark as acted error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete notification (soft delete)
   */
  static async deleteNotification(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is required",
        });
      }

      const result = await NotificationService.deleteNotification(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Delete notification error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Cancel scheduled notification
   */
  static async cancelNotification(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Notification ID is required",
        });
      }

      const result = await NotificationService.cancelNotification(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Cancel notification error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get notification statistics (admin only)
   */
  static async getNotificationStats(req, res) {
    try {
      const result = await NotificationService.getNotificationStats();

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Notification stats error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = NotificationController;
