const AuditLog = require("../models/audit-log.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * Audit Log Service
 * Handles audit trail creation and retrieval for compliance and security
 */
class AuditLogService {
  /**
   * Create an audit log entry
   */
  async createAuditLog(auditData) {
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
        channel = "api",
        meta = {},
      } = auditData;

      // Validate required fields
      if (!action || !entity_type) {
        throw this.handleError(400, "Action and entity_type are required");
      }

      // If entity_id is provided, validate it's a valid ObjectId
      if (entity_id && !mongoose.Types.ObjectId.isValid(entity_id)) {
        throw this.handleError(400, "Invalid entity_id format");
      }

      // Create audit log
      const auditLog = new AuditLog({
        actor_user,
        actor_role_snapshot: actor_roles || [],
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

      await auditLog.save();

      return {
        success: true,
        data: auditLog,
        message: "Audit log created successfully",
      };
    } catch (error) {
      console.error("Create audit log error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Log user authentication/authorization actions
   */
  async logAuthAction(userId, action, ip, userAgent, meta = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        console.warn(`User ${userId} not found for auth log`);
        return null;
      }

      return await this.createAuditLog({
        actor_user: userId,
        actor_roles: user.roles,
        action: `auth.${action}`,
        entity_type: "User",
        entity_id: userId,
        ip,
        user_agent: userAgent,
        channel: "api",
        meta: {
          ...meta,
          email: user.email,
          status: user.status,
        },
      });
    } catch (error) {
      console.error("Auth action logging error:", error);
      return null;
    }
  }

  /**
   * Log user profile changes
   */
  async logUserProfileChange(
    userId,
    actorUserId,
    before,
    after,
    ip,
    userAgent
  ) {
    try {
      const actor = await User.findById(actorUserId);
      const targetUser = await User.findById(userId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: "user.profile_update",
        entity_type: "User",
        entity_id: userId,
        before: this.sanitizeUserData(before),
        after: this.sanitizeUserData(after),
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          target_user_email: targetUser?.email,
          changed_by: actor?.email,
          changed_fields: this.getChangedFields(before, after),
        },
      });
    } catch (error) {
      console.error("User profile change logging error:", error);
      return null;
    }
  }

  /**
   * Log loan application changes
   */
  async logLoanApplicationChange(
    applicationId,
    actorUserId,
    action,
    before,
    after,
    ip,
    userAgent,
    meta = {}
  ) {
    try {
      const actor = await User.findById(actorUserId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: `loan_application.${action}`,
        entity_type: "LoanApplication",
        entity_id: applicationId,
        before,
        after,
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          ...meta,
          changed_by: actor?.email,
        },
      });
    } catch (error) {
      console.error("Loan application logging error:", error);
      return null;
    }
  }

  /**
   * Log loan processing actions
   */
  async logLoanAction(
    loanId,
    actorUserId,
    action,
    before,
    after,
    ip,
    userAgent,
    meta = {}
  ) {
    try {
      const actor = await User.findById(actorUserId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: `loan.${action}`,
        entity_type: "Loan",
        entity_id: loanId,
        before,
        after,
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          ...meta,
          changed_by: actor?.email,
        },
      });
    } catch (error) {
      console.error("Loan action logging error:", error);
      return null;
    }
  }

  /**
   * Log asset management actions
   */
  async logAssetAction(
    assetId,
    actorUserId,
    action,
    before,
    after,
    ip,
    userAgent,
    meta = {}
  ) {
    try {
      const actor = await User.findById(actorUserId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: `asset.${action}`,
        entity_type: "Asset",
        entity_id: assetId,
        before,
        after,
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          ...meta,
          changed_by: actor?.email,
        },
      });
    } catch (error) {
      console.error("Asset action logging error:", error);
      return null;
    }
  }

  /**
   * Log payment actions
   */
  async logPaymentAction(
    paymentId,
    actorUserId,
    action,
    before,
    after,
    ip,
    userAgent,
    meta = {}
  ) {
    try {
      const actor = await User.findById(actorUserId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: `payment.${action}`,
        entity_type: "Payment",
        entity_id: paymentId,
        before,
        after,
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          ...meta,
          changed_by: actor?.email,
          amount: after?.amount || before?.amount,
        },
      });
    } catch (error) {
      console.error("Payment action logging error:", error);
      return null;
    }
  }

  /**
   * Log bid payment actions
   */
  async logBidPaymentAction(
    bidPaymentId,
    actorUserId,
    action,
    before,
    after,
    ip,
    userAgent,
    meta = {}
  ) {
    try {
      const actor = await User.findById(actorUserId);

      return await this.createAuditLog({
        actor_user: actorUserId,
        actor_roles: actor?.roles || [],
        action: `bid_payment.${action}`,
        entity_type: "BidPayment",
        entity_id: bidPaymentId,
        before,
        after,
        ip,
        user_agent: userAgent,
        channel: "web",
        meta: {
          ...meta,
          changed_by: actor?.email,
          amount: after?.amount || before?.amount,
        },
      });
    } catch (error) {
      console.error("Bid payment action logging error:", error);
      return null;
    }
  }

  /**
   * Get audit logs with pagination and filters
   */
  async getAuditLogs(filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "desc",
      } = pagination;

      const {
        actor_user,
        action,
        entity_type,
        entity_id,
        channel,
        created_from,
        created_to,
        search,
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (actor_user) query.actor_user = actor_user;
      if (action) query.action = action;
      if (entity_type) query.entity_type = entity_type;
      if (entity_id) query.entity_id = entity_id;
      if (channel) query.channel = channel;

      // Date range filters
      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [
          { action: { $regex: search, $options: "i" } },
          { entity_type: { $regex: search, $options: "i" } },
          { "meta.changed_by": { $regex: search, $options: "i" } },
          { "meta.target_user_email": { $regex: search, $options: "i" } },
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query with population
      const [logs, total] = await Promise.all([
        AuditLog.find(query)
          .populate("actor_user", "email first_name last_name")
          .populate({
            path: "entity_id",
            select:
              "loan_no application_no asset_no receipt_no email first_name last_name",
            options: { strictPopulate: false },
          })
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        AuditLog.countDocuments(query),
      ]);

      // Format logs for response
      const formattedLogs = logs.map((log) => ({
        ...log,
        actor: log.actor_user
          ? {
              id: log.actor_user._id,
              email: log.actor_user.email,
              name: `${log.actor_user.first_name} ${log.actor_user.last_name}`,
              roles: log.actor_role_snapshot,
            }
          : null,
        entity: log.entity_id
          ? {
              id: log.entity_id._id,
              identifier: this.getEntityIdentifier(
                log.entity_type,
                log.entity_id
              ),
            }
          : null,
        timestamp: log.created_at,
        summary: this.generateActionSummary(log),
      }));

      return {
        success: true,
        data: {
          logs: formattedLogs,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get audit logs error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get audit log by ID
   */
  async getAuditLogById(logId) {
    try {
      const log = await AuditLog.findById(logId)
        .populate("actor_user", "email first_name last_name roles")
        .lean();

      if (!log) {
        throw this.handleError(404, "Audit log not found");
      }

      // Get entity details if entity_id exists
      if (log.entity_id) {
        const entityModel = this.getEntityModel(log.entity_type);
        if (entityModel) {
          const entity = await entityModel.findById(log.entity_id).lean();
          log.entity_details = entity;
        }
      }

      return {
        success: true,
        data: log,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get audit logs for a specific entity
   */
  async getEntityAuditLogs(entityType, entityId, pagination = {}) {
    try {
      if (!mongoose.Types.ObjectId.isValid(entityId)) {
        throw this.handleError(400, "Invalid entity ID format");
      }

      const filters = {
        entity_type: entityType,
        entity_id: entityId,
      };

      return await this.getAuditLogs(filters, pagination);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get audit logs for a specific user (actor)
   */
  async getUserAuditLogs(userId, pagination = {}) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw this.handleError(400, "Invalid user ID format");
      }

      const filters = {
        actor_user: userId,
      };

      return await this.getAuditLogs(filters, pagination);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(filters = {}) {
    try {
      let query = {};

      // Apply filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }
      if (filters.entity_type) query.entity_type = filters.entity_type;

      // Get counts by action type
      const actionStats = await AuditLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$action",
            count: { $sum: 1 },
            last_occurred: { $max: "$created_at" },
          },
        },
        { $sort: { count: -1 } },
      ]);

      // Get counts by entity type
      const entityStats = await AuditLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$entity_type",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]);

      // Get counts by user (top actors)
      const userStats = await AuditLog.aggregate([
        { $match: { ...query, actor_user: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: "$actor_user",
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]);

      // Populate user details
      const populatedUserStats = await Promise.all(
        userStats.map(async (stat) => {
          const user = await User.findById(stat._id)
            .select("email first_name last_name roles")
            .lean();
          return {
            user: user
              ? {
                  id: user._id,
                  email: user.email,
                  name: `${user.first_name} ${user.last_name}`,
                  roles: user.roles,
                }
              : null,
            count: stat.count,
          };
        })
      );

      // Get recent activity
      const recentActivity = await AuditLog.find(query)
        .populate("actor_user", "email first_name last_name")
        .sort({ created_at: -1 })
        .limit(10)
        .lean();

      // Get today's activity count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysCount = await AuditLog.countDocuments({
        ...query,
        created_at: { $gte: today, $lt: tomorrow },
      });

      // Get most common actions
      const commonActions = actionStats.slice(0, 5);

      return {
        success: true,
        data: {
          total: await AuditLog.countDocuments(query),
          todays_activity: todaysCount,
          by_action: actionStats,
          by_entity: entityStats,
          top_users: populatedUserStats,
          recent_activity: recentActivity.map((log) => ({
            id: log._id,
            action: log.action,
            entity_type: log.entity_type,
            timestamp: log.created_at,
            actor: log.actor_user
              ? {
                  email: log.actor_user.email,
                  name: `${log.actor_user.first_name} ${log.actor_user.last_name}`,
                }
              : null,
          })),
          common_actions: commonActions,
        },
      };
    } catch (error) {
      console.error("Get audit stats error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Search audit logs
   */
  async searchAuditLogs(searchTerm, filters = {}, pagination = {}) {
    try {
      if (!searchTerm || searchTerm.length < 2) {
        throw this.handleError(
          400,
          "Search term must be at least 2 characters"
        );
      }

      let query = {
        $or: [
          { action: { $regex: searchTerm, $options: "i" } },
          { entity_type: { $regex: searchTerm, $options: "i" } },
          { "meta.changed_by": { $regex: searchTerm, $options: "i" } },
          { "meta.target_user_email": { $regex: searchTerm, $options: "i" } },
          { "meta.notes": { $regex: searchTerm, $options: "i" } },
        ],
      };

      // Apply additional filters
      if (filters.entity_type) query.entity_type = filters.entity_type;
      if (filters.actor_user) query.actor_user = filters.actor_user;
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      const result = await this.getAuditLogs(query, pagination);

      return {
        success: true,
        data: result.data,
        search_term: searchTerm,
      };
    } catch (error) {
      console.error("Search audit logs error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Export audit logs (for compliance reports)
   */
  async exportAuditLogs(filters = {}, format = "json") {
    try {
      const query = {};

      // Apply filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }
      if (filters.entity_type) query.entity_type = filters.entity_type;
      if (filters.action) query.action = filters.action;
      if (filters.actor_user) query.actor_user = filters.actor_user;

      const logs = await AuditLog.find(query)
        .populate("actor_user", "email first_name last_name")
        .sort({ created_at: -1 })
        .lean();

      // Format logs for export
      const formattedLogs = logs.map((log) => ({
        timestamp: log.created_at,
        action: log.action,
        entity_type: log.entity_type,
        entity_id: log.entity_id,
        actor: log.actor_user
          ? {
              id: log.actor_user._id,
              email: log.actor_user.email,
              name: `${log.actor_user.first_name} ${log.actor_user.last_name}`,
            }
          : null,
        actor_roles: log.actor_role_snapshot,
        ip_address: log.ip,
        user_agent: log.user_agent,
        channel: log.channel,
        changes: {
          before: log.before,
          after: log.after,
        },
        metadata: log.meta,
      }));

      if (format === "csv") {
        return this.convertToCSV(formattedLogs);
      }

      return {
        success: true,
        data: formattedLogs,
        count: formattedLogs.length,
        generated_at: new Date(),
        filters,
      };
    } catch (error) {
      console.error("Export audit logs error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Helper: Get entity model by type
   */
  getEntityModel(entityType) {
    const models = {
      User: require("../models/user.model"),
      LoanApplication: require("../models/loan_application.model"),
      Loan: require("../models/loan.model"),
      Asset: require("../models/asset.model"),
      Payment: require("../models/payment.model"),
      BidPayment: require("../models/bid_payment.model"),
    };
    return models[entityType];
  }

  /**
   * Helper: Get entity identifier
   */
  getEntityIdentifier(entityType, entity) {
    const identifiers = {
      User: entity.email || entity._id,
      LoanApplication: entity.application_no || entity._id,
      Loan: entity.loan_no || entity._id,
      Asset: entity.asset_no || entity.title || entity._id,
      Payment: entity.receipt_no || entity._id,
      BidPayment: entity.receipt_no || entity._id,
    };
    return identifiers[entityType] || entity._id;
  }

  /**
   * Helper: Generate action summary
   */
  generateActionSummary(log) {
    const actionMap = {
      "auth.login": "User logged in",
      "auth.logout": "User logged out",
      "auth.password_reset": "Password reset",
      "user.profile_update": "Profile updated",
      "user.role_change": "User role changed",
      "loan_application.submit": "Loan application submitted",
      "loan_application.approve": "Loan application approved",
      "loan_application.reject": "Loan application rejected",
      "loan.create": "Loan created",
      "loan.approve": "Loan approved",
      "loan.disburse": "Loan disbursed",
      "loan.update_status": "Loan status updated",
      "asset.evaluate": "Asset evaluated",
      "asset.update_status": "Asset status updated",
      "payment.receive": "Payment received",
      "payment.refund": "Payment refunded",
      "bid_payment.initiate": "Bid payment initiated",
      "bid_payment.success": "Bid payment successful",
      "bid_payment.failed": "Bid payment failed",
    };

    return actionMap[log.action] || log.action;
  }

  /**
   * Helper: Sanitize user data (remove sensitive info)
   */
  sanitizeUserData(userData) {
    if (!userData) return userData;

    const sanitized = { ...userData };
    const sensitiveFields = [
      "password_hash",
      "email_verification_otp",
      "reset_password_otp",
      "delete_account_otp",
      "auth_providers",
    ];

    sensitiveFields.forEach((field) => {
      delete sanitized[field];
    });

    return sanitized;
  }

  /**
   * Helper: Get changed fields between before and after
   */
  getChangedFields(before, after) {
    if (!before || !after) return [];

    const changed = [];
    const allKeys = new Set([
      ...Object.keys(before || {}),
      ...Object.keys(after || {}),
    ]);

    for (const key of allKeys) {
      if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
        changed.push(key);
      }
    }

    return changed;
  }

  /**
   * Helper: Convert to CSV
   */
  convertToCSV(logs) {
    if (!logs || logs.length === 0) {
      return "No data available";
    }

    const headers = [
      "Timestamp",
      "Action",
      "Entity Type",
      "Entity ID",
      "Actor Email",
      "Actor Name",
      "Actor Roles",
      "IP Address",
      "User Agent",
      "Channel",
      "Before State",
      "After State",
      "Metadata",
    ];

    const rows = logs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.action,
      log.entity_type,
      log.entity_id || "",
      log.actor?.email || "",
      log.actor?.name || "",
      log.actor_roles?.join(", ") || "",
      log.ip_address || "",
      log.user_agent || "",
      log.channel || "",
      JSON.stringify(log.changes?.before || {}),
      JSON.stringify(log.changes?.after || {}),
      JSON.stringify(log.metadata || {}),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    return csvContent;
  }

  /**
   * Handle custom errors
   */
  handleError(status, message) {
    return {
      status,
      message,
      timestamp: new Date(),
    };
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Audit Log Service Error:", error);

    // If it's already a custom error, return it
    if (error.status && error.message) {
      return error;
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        status: 409,
        message: `Duplicate ${field.replace("_", " ")}`,
        field,
      };
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return {
        status: 400,
        message: "Validation failed",
        errors,
      };
    }

    // Handle CastError (invalid ObjectId)
    if (error.name === "CastError") {
      return {
        status: 400,
        message: `Invalid ${error.path}: ${error.value}`,
      };
    }

    // Default error
    return {
      status: 500,
      message: "Internal server error",
      detail: error.message,
    };
  }
}

module.exports = new AuditLogService();
