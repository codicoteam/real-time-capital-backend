const SupportTicketService = require("../services/support_ticket_service");

/**
 * Support Ticket Controller
 * Handles HTTP requests and responses
 */
class SupportTicketController {
  /**
   * Create a new support ticket
   */
  static async createTicket(req, res) {
    try {
      const { subject, description, category, priority, customer_user, meta } = req.body;
      const createdBy = req.user._id;

      // Validate required fields
      if (!subject) {
        return res.status(400).json({
          success: false,
          message: "Subject is required"
        });
      }

      const result = await SupportTicketService.createTicket(
        {
          subject,
          description,
          category,
          priority,
          customer_user,
          meta
        },
        createdBy
      );

      return res.status(201).json(result);
    } catch (error) {
      console.error("Create ticket controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Get tickets with pagination and filters
   */
  static async getTickets(req, res) {
    try {
      const filters = {
        status: req.query.status,
        priority: req.query.priority,
        category: req.query.category,
        customer_user: req.query.customer_user,
        assigned_to: req.query.assigned_to,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        updated_from: req.query.updated_from,
        updated_to: req.query.updated_to
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by || "created_at",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search
      };

      const result = await SupportTicketService.getTickets(
        filters,
        pagination,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get tickets controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Get ticket by ID
   */
  static async getTicket(req, res) {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ticket ID is required"
        });
      }

      const result = await SupportTicketService.getTicketById(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get ticket controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Update ticket
   */
  static async updateTicket(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ticket ID is required"
        });
      }

      const result = await SupportTicketService.updateTicket(
        id,
        updateData,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update ticket controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Update ticket status
   */
  static async updateTicketStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ticket ID is required"
        });
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required"
        });
      }

      const validStatuses = ["open", "in_progress", "resolved", "closed", "reopened"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`
        });
      }

      const result = await SupportTicketService.updateTicketStatus(
        id,
        status,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update status controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Assign ticket to staff
   */
  static async assignTicket(req, res) {
    try {
      const { id } = req.params;
      const { assignee_id } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ticket ID is required"
        });
      }

      if (!assignee_id) {
        return res.status(400).json({
          success: false,
          message: "Assignee ID is required"
        });
      }

      const result = await SupportTicketService.assignTicket(
        id,
        assignee_id,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Assign ticket controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Add attachment to ticket
   */
  static async addAttachment(req, res) {
    try {
      const { id } = req.params;
      const { attachment_id } = req.body;

      if (!id || !attachment_id) {
        return res.status(400).json({
          success: false,
          message: "Ticket ID and Attachment ID are required"
        });
      }

      const result = await SupportTicketService.addAttachment(
        id,
        attachment_id,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Add attachment controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Get ticket statistics
   */
  static async getTicketStats(req, res) {
    try {
      const result = await SupportTicketService.getTicketStats(req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get stats controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Get tickets by customer
   */
  static async getTicketsByCustomer(req, res) {
    try {
      const { customerId } = req.params;

      if (!customerId) {
        return res.status(400).json({
          success: false,
          message: "Customer ID is required"
        });
      }

      const result = await SupportTicketService.getTicketsByCustomer(
        customerId,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get customer tickets controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Get my assigned tickets (for staff)
   */
  static async getMyAssignedTickets(req, res) {
    try {
      const filters = {
        status: req.query.status,
        priority: req.query.priority,
        category: req.query.category
      };

      const result = await SupportTicketService.getMyAssignedTickets(
        req.user,
        filters
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get assigned tickets controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }

  /**
   * Search tickets
   */
  static async searchTickets(req, res) {
    try {
      const { q } = req.query;

      if (!q || q.length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search query must be at least 2 characters"
        });
      }

      const result = await SupportTicketService.getTickets(
        {},
        { search: q, limit: 20 },
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Search tickets controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  }
}

module.exports = SupportTicketController;