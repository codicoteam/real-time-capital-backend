const AuditLogService = require("../services/audit_log_service");

/**
 * Audit Log Controller
 * Handles HTTP requests and responses for audit logs
 */
class AuditLogController {
  /**
   * Get audit logs with pagination
   */
  async getAuditLogs(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "desc",
        search,
      } = req.query;

      const filters = {
        actor_user: req.query.actor_user,
        action: req.query.action,
        entity_type: req.query.entity_type,
        entity_id: req.query.entity_id,
        channel: req.query.channel,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        search,
      };

      const pagination = {
        page,
        limit,
        sort_by,
        sort_order,
      };

      const result = await AuditLogService.getAuditLogs(filters, pagination);

      res.status(200).json(result);
    } catch (error) {
      console.error("Get audit logs controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get audit log by ID
   */
  async getAuditLog(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Audit log ID is required",
        });
      }

      const result = await AuditLogService.getAuditLogById(id);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 404).json(result);
      }
    } catch (error) {
      console.error("Get audit log controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityAuditLogs(req, res) {
    try {
      const { entityType, entityId } = req.params;
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      if (!entityType || !entityId) {
        return res.status(400).json({
          success: false,
          message: "Entity type and entity ID are required",
        });
      }

      const pagination = {
        page,
        limit,
        sort_by,
        sort_order,
      };

      const result = await AuditLogService.getEntityAuditLogs(
        entityType,
        entityId,
        pagination
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Get entity audit logs controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(req, res) {
    try {
      const { userId } = req.params;
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const pagination = {
        page,
        limit,
        sort_by,
        sort_order,
      };

      const result = await AuditLogService.getUserAuditLogs(userId, pagination);

      res.status(200).json(result);
    } catch (error) {
      console.error("Get user audit logs controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(req, res) {
    try {
      const filters = {
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        entity_type: req.query.entity_type,
      };

      const result = await AuditLogService.getAuditStats(filters);

      res.status(200).json(result);
    } catch (error) {
      console.error("Get audit stats controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Search audit logs
   */
  async searchAuditLogs(req, res) {
    try {
      const { q } = req.query;
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const filters = {
        entity_type: req.query.entity_type,
        actor_user: req.query.actor_user,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
      };

      const pagination = {
        page,
        limit,
        sort_by,
        sort_order,
      };

      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const result = await AuditLogService.searchAuditLogs(
        q,
        filters,
        pagination
      );

      res.status(200).json(result);
    } catch (error) {
      console.error("Search audit logs controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Export audit logs
   */
  async exportAuditLogs(req, res) {
    try {
      const {
        created_from,
        created_to,
        entity_type,
        action,
        actor_user,
        format = "json",
      } = req.query;

      const filters = {
        created_from,
        created_to,
        entity_type,
        action,
        actor_user,
      };

      const result = await AuditLogService.exportAuditLogs(filters, format);

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=audit-logs-${Date.now()}.csv`
        );
        return res.send(result);
      }

      res.status(200).json(result);
    } catch (error) {
      console.error("Export audit logs controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Create an audit log (for testing or manual logging)
   */
  async createAuditLog(req, res) {
    try {
      const {
        actor_user,
        actor_roles,
        action,
        entity_type,
        entity_id,
        before,
        after,
        ip,
        user_agent,
        channel,
        meta,
      } = req.body;

      // Only allow admins to manually create audit logs
      const userRoles = req.user?.roles || [];
      const allowedRoles = [
        "super_admin_vendor",
        "admin_pawn_limited",
        "management",
      ];
      const hasPermission = userRoles.some((role) =>
        allowedRoles.includes(role)
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: "Insufficient permissions to create audit logs",
        });
      }

      const result = await AuditLogService.createAuditLog({
        actor_user,
        actor_roles,
        action,
        entity_type,
        entity_id,
        before,
        after,
        ip,
        user_agent,
        channel,
        meta,
      });

      res.status(201).json(result);
    } catch (error) {
      console.error("Create audit log controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = new AuditLogController();
