const SupportTicket = require("../models/supportTicket.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");
(async () => {
  ({ v4: uuidv4 } = await import("uuid"));
})();
/**
 * Support Ticket Service
 * Contains all business logic for support tickets
 */
class SupportTicketService {
  /**
   * Generate unique ticket number
   */
  static async generateTicketNumber() {
    const date = new Date();
    const dateStr = date.toISOString().slice(2, 10).replace(/-/g, "");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `TICKET-${dateStr}-${random}`;
  }

  /**
   * Create a new support ticket
   */
  static async createTicket(ticketData, createdBy) {
    try {
      const ticketNo = await this.generateTicketNumber();
      
      const ticket = new SupportTicket({
        ...ticketData,
        ticket_no: ticketNo,
        created_by_user: createdBy,
        customer_user: ticketData.customer_user || createdBy,
        status: "open"
      });

      await ticket.save();
      await ticket.populate("created_by_user", "name email phone");
      await ticket.populate("customer_user", "name email phone");
      await ticket.populate("assigned_to", "name email");

      return {
        success: true,
        data: ticket,
        message: "Support ticket created successfully"
      };
    } catch (error) {
      console.error("Create ticket error:", error);
      throw new Error(error.message || "Failed to create support ticket");
    }
  }

  /**
   * Get tickets with pagination and filters
   */
  static async getTickets(filters = {}, pagination = {}, user) {
    try {
      const {
        page = 1,
        limit = 10,
        sort_by = "created_at",
        sort_order = "desc",
        search
      } = pagination;

      const {
        status,
        priority,
        category,
        customer_user,
        assigned_to,
        created_from,
        created_to,
        updated_from,
        updated_to
      } = filters;

      // Build query
      let query = {};

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.$or = [
          { customer_user: user._id },
          { created_by_user: user._id }
        ];
      }

      // Apply filters
      if (status) query.status = status;
      if (priority) query.priority = priority;
      if (category) query.category = category;
      if (customer_user) query.customer_user = customer_user;
      if (assigned_to) query.assigned_to = assigned_to;

      // Date filters
      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      if (updated_from || updated_to) {
        query.updated_at = {};
        if (updated_from) query.updated_at.$gte = new Date(updated_from);
        if (updated_to) query.updated_at.$lte = new Date(updated_to);
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [
          { ticket_no: { $regex: search, $options: "i" } },
          { subject: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } }
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [tickets, total] = await Promise.all([
        SupportTicket.find(query)
          .populate("created_by_user", "name email phone")
          .populate("customer_user", "name email phone")
          .populate("assigned_to", "name email role")
          .populate("attachments", "filename originalname url")
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        SupportTicket.countDocuments(query)
      ]);

      return {
        success: true,
        data: {
          tickets,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };
    } catch (error) {
      console.error("Get tickets error:", error);
      throw new Error(error.message || "Failed to fetch tickets");
    }
  }

  /**
   * Get ticket by ID
   */
  static async getTicketById(id, user) {
    try {
      const ticket = await SupportTicket.findById(id)
        .populate("created_by_user", "name email phone")
        .populate("customer_user", "name email phone")
        .populate("assigned_to", "name email role")
        .populate("attachments", "filename originalname url");

      if (!ticket) {
        return {
          success: false,
          message: "Ticket not found",
          statusCode: 404
        };
      }

      // Check permission
      if (user.roles.includes("customer")) {
        const isOwner = ticket.customer_user._id.equals(user._id) || 
                       ticket.created_by_user._id.equals(user._id);
        if (!isOwner) {
          return {
            success: false,
            message: "Access denied to this ticket",
            statusCode: 403
          };
        }
      }

      return {
        success: true,
        data: ticket
      };
    } catch (error) {
      console.error("Get ticket error:", error);
      throw new Error(error.message || "Failed to fetch ticket");
    }
  }

  /**
   * Update ticket
   */
  static async updateTicket(id, updateData, user) {
    try {
      const ticket = await SupportTicket.findById(id);
      
      if (!ticket) {
        return {
          success: false,
          message: "Ticket not found",
          statusCode: 404
        };
      }

      // Permission check
      const isAdmin = user.roles.some(role => 
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
      );
      
      const isAssignedStaff = ticket.assigned_to && 
                            ticket.assigned_to.equals(user._id);
      
      const isOwner = ticket.customer_user.equals(user._id) || 
                     ticket.created_by_user.equals(user._id);

      // Determine allowed updates based on role
      if (user.roles.includes("customer")) {
        // Customers can only update subject, description, category
        const allowedFields = ["subject", "description", "category"];
        Object.keys(updateData).forEach(key => {
          if (!allowedFields.includes(key)) {
            delete updateData[key];
          }
        });
      } else if (user.roles.includes("loan_officer_processor")) {
        // Loan officers can update most fields but not status to closed/resolved
        if (updateData.status === "closed" || updateData.status === "resolved") {
          delete updateData.status;
        }
      }

      // Update ticket
      Object.assign(ticket, updateData);
      await ticket.save();

      await ticket.populate("created_by_user", "name email phone");
      await ticket.populate("customer_user", "name email phone");
      await ticket.populate("assigned_to", "name email role");
      await ticket.populate("attachments", "filename originalname url");

      return {
        success: true,
        data: ticket,
        message: "Ticket updated successfully"
      };
    } catch (error) {
      console.error("Update ticket error:", error);
      throw new Error(error.message || "Failed to update ticket");
    }
  }

  /**
   * Update ticket status
   */
  static async updateTicketStatus(id, status, user) {
    try {
      const ticket = await SupportTicket.findById(id);
      
      if (!ticket) {
        return {
          success: false,
          message: "Ticket not found",
          statusCode: 404
        };
      }

      // Validate status transition
      const validTransitions = {
        "open": ["in_progress", "closed"],
        "in_progress": ["resolved", "closed"],
        "resolved": ["closed", "reopened"],
        "closed": ["reopened"]
      };

      if (validTransitions[ticket.status] && 
          !validTransitions[ticket.status].includes(status)) {
        return {
          success: false,
          message: `Invalid status transition from ${ticket.status} to ${status}`,
          statusCode: 400
        };
      }

      // Check permission
      if (user.roles.includes("customer")) {
        if (status !== "closed" && status !== "reopened") {
          return {
            success: false,
            message: "Customers can only close or reopen tickets",
            statusCode: 403
          };
        }
      }

      // Update status
      ticket.status = status;
      await ticket.save();

      return {
        success: true,
        data: ticket,
        message: `Ticket status updated to ${status}`
      };
    } catch (error) {
      console.error("Update status error:", error);
      throw new Error(error.message || "Failed to update ticket status");
    }
  }

  /**
   * Assign ticket to staff
   */
  static async assignTicket(id, assigneeId, user) {
    try {
      const ticket = await SupportTicket.findById(id);
      
      if (!ticket) {
        return {
          success: false,
          message: "Ticket not found",
          statusCode: 404
        };
      }

      // Check if assignee exists and is staff
      const assignee = await User.findById(assigneeId);
      if (!assignee || assignee.roles.includes("customer")) {
        return {
          success: false,
          message: "Assignee must be a staff member",
          statusCode: 400
        };
      }

      // Update assignment
      ticket.assigned_to = assigneeId;
      ticket.status = "in_progress"; // Auto move to in progress when assigned
      await ticket.save();

      await ticket.populate("assigned_to", "name email role");

      return {
        success: true,
        data: ticket,
        message: "Ticket assigned successfully"
      };
    } catch (error) {
      console.error("Assign ticket error:", error);
      throw new Error(error.message || "Failed to assign ticket");
    }
  }

  /**
   * Add attachment to ticket
   */
  static async addAttachment(id, attachmentId, user) {
    try {
      const ticket = await SupportTicket.findById(id);
      
      if (!ticket) {
        return {
          success: false,
          message: "Ticket not found",
          statusCode: 404
        };
      }

      // Check permission
      const isOwner = ticket.customer_user.equals(user._id) || 
                     ticket.created_by_user.equals(user._id);
      const isStaff = !user.roles.includes("customer");

      if (!isOwner && !isStaff) {
        return {
          success: false,
          message: "Access denied to add attachment",
          statusCode: 403
        };
      }

      // Add attachment
      if (!ticket.attachments.includes(attachmentId)) {
        ticket.attachments.push(attachmentId);
        await ticket.save();
      }

      return {
        success: true,
        data: ticket,
        message: "Attachment added successfully"
      };
    } catch (error) {
      console.error("Add attachment error:", error);
      throw new Error(error.message || "Failed to add attachment");
    }
  }

  /**
   * Get ticket statistics
   */
  static async getTicketStats(user) {
    try {
      let query = {};

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.$or = [
          { customer_user: user._id },
          { created_by_user: user._id }
        ];
      }

      const stats = await SupportTicket.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            open: {
              $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] }
            },
            in_progress: {
              $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] }
            },
            resolved: {
              $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
            },
            closed: {
              $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] }
            },
            byPriority: {
              $push: {
                priority: "$priority",
                status: "$status"
              }
            }
          }
        }
      ]);

      // Format stats
      const result = stats[0] || {
        total: 0,
        open: 0,
        in_progress: 0,
        resolved: 0,
        closed: 0,
        byPriority: []
      };

      // Calculate priority breakdown
      const priorityStats = {
        urgent: 0,
        high: 0,
        medium: 0,
        low: 0
      };

      result.byPriority.forEach(item => {
        if (priorityStats[item.priority] !== undefined) {
          priorityStats[item.priority]++;
        }
      });

      delete result.byPriority;

      return {
        success: true,
        data: {
          ...result,
          priority: priorityStats
        }
      };
    } catch (error) {
      console.error("Get stats error:", error);
      throw new Error(error.message || "Failed to fetch ticket statistics");
    }
  }

  /**
   * Get tickets by customer
   */
  static async getTicketsByCustomer(customerId, user) {
    try {
      // Check permission
      if (user.roles.includes("customer") && !user._id.equals(customerId)) {
        return {
          success: false,
          message: "Access denied to view other customer's tickets",
          statusCode: 403
        };
      }

      const query = { customer_user: customerId };
      
      const tickets = await SupportTicket.find(query)
        .populate("created_by_user", "name email")
        .populate("assigned_to", "name email")
        .sort({ created_at: -1 });

      return {
        success: true,
        data: tickets
      };
    } catch (error) {
      console.error("Get customer tickets error:", error);
      throw new Error(error.message || "Failed to fetch customer tickets");
    }
  }

  /**
   * Get my assigned tickets (for staff)
   */
  static async getMyAssignedTickets(user, filters = {}) {
    try {
      const query = {
        assigned_to: user._id,
        ...filters
      };

      const tickets = await SupportTicket.find(query)
        .populate("customer_user", "name email phone")
        .populate("created_by_user", "name email")
        .sort({ priority: -1, created_at: -1 });

      return {
        success: true,
        data: tickets
      };
    } catch (error) {
      console.error("Get assigned tickets error:", error);
      throw new Error(error.message || "Failed to fetch assigned tickets");
    }
  }
}

module.exports = SupportTicketService;