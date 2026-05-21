const loanApplicationService = require("../services/loan_application_service");

class LoanApplicationController {
  /**
   * Create a new loan application – for customers themselves
   */
  async createLoanApplication(req, res) {
    try {
      const applicationData = req.body;
      const user = req.user;

      const result = await loanApplicationService.createLoanApplication(
        applicationData,
        user,
        null,
      );

      res.status(201).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Create a loan application for a specific customer (staff only)
   */
  async createLoanApplicationForCustomer(req, res) {
    try {
      const applicationData = req.body;

      if (!applicationData.customer_user_id) {
        return res.status(400).json({
          success: false,
          error: "customer_user_id is required",
        });
      }

      const user = req.user;
      const customerUserId = applicationData.customer_user_id;

      delete applicationData.customer_user_id;

      const result = await loanApplicationService.createLoanApplication(
        applicationData,
        user,
        customerUserId,
      );

      res.status(201).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get all loan applications with pagination
   */
  async getLoanApplications(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status,
        collateral_category,
        search,
        customer_user,
        startDate,
        endDate,
      } = req.query;

      const userRole = req.user.roles[0];
      const userId = req.user._id;

      const result = await loanApplicationService.getLoanApplications({
        page,
        limit,
        sortBy,
        sortOrder,
        status,
        collateral_category,
        search,
        customer_user,
        startDate,
        endDate,
        userRole,
        userId,
      });

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get loan applications by agent ID
   */
  async getLoanApplicationsByAgentId(req, res) {
    try {
      const { agentId } = req.params;
      const loggedInUser = req.user;
      const userRoles = loggedInUser.roles;

      const isAdmin = userRoles.some((role) =>
        ["super_admin_vendor", "admin_pawn_limited", "management"].includes(
          role,
        ),
      );
      const isSelf =
        loggedInUser._id.toString() === agentId && userRoles.includes("agent");

      if (!isAdmin && !isSelf) {
        return res.status(403).json({
          success: false,
          error: "You are not authorized to view applications for this agent",
        });
      }

      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status,
        collateral_category,
        search,
        startDate,
        endDate,
      } = req.query;

      const result = await loanApplicationService.getLoanApplicationsByAgentId(
        agentId,
        {
          page,
          limit,
          sortBy,
          sortOrder,
          status,
          collateral_category,
          search,
          startDate,
          endDate,
        },
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get loan applications by processor ID
   */
  async getLoanApplicationsByProcessorId(req, res) {
    try {
      const { processorId } = req.params;
      const loggedInUser = req.user;
      const userRoles = loggedInUser.roles;

      const isAdmin = userRoles.some((role) =>
        ["super_admin_vendor", "admin_pawn_limited", "management"].includes(
          role,
        ),
      );
      const isSelf =
        loggedInUser._id.toString() === processorId &&
        userRoles.includes("loan_officer_processor");

      if (!isAdmin && !isSelf) {
        return res.status(403).json({
          success: false,
          error:
            "You are not authorized to view applications for this processor",
        });
      }

      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status,
        collateral_category,
        search,
        startDate,
        endDate,
      } = req.query;

      const result =
        await loanApplicationService.getLoanApplicationsByProcessorId(
          processorId,
          {
            page,
            limit,
            sortBy,
            sortOrder,
            status,
            collateral_category,
            search,
            startDate,
            endDate,
          },
        );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get a single loan application by ID
   */
  async getLoanApplicationById(req, res) {
    try {
      const { id } = req.params;
      const userRole = req.user.roles[0];
      const userId = req.user._id;

      const result = await loanApplicationService.getLoanApplicationById(
        id,
        userRole,
        userId,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Update loan application status
   */
  async updateLoanApplicationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const user = req.user;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: "Status is required",
        });
      }

      const result = await loanApplicationService.updateLoanApplicationStatus(
        id,
        status,
        user,
        notes,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (
        error.message.includes("Invalid status") ||
        error.message.includes("permission")
      ) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Perform debtor check on loan application
   */
  async performDebtorCheck(req, res) {
    try {
      const { id } = req.params;
      const user = req.user;

      const result = await loanApplicationService.performDebtorCheck(id, user);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Update loan application details
   */
  async updateLoanApplication(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userRole = req.user.roles[0];
      const userId = req.user._id;

      const result = await loanApplicationService.updateLoanApplication(
        id,
        updateData,
        userRole,
        userId,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found or cannot be updated") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Add admin note to loan application
   */
  async addAdminNote(req, res) {
    try {
      const { id } = req.params;
      const { note } = req.body;
      const user = req.user;

      if (!note) {
        return res.status(400).json({
          success: false,
          error: "Note text is required",
        });
      }

      const result = await loanApplicationService.addAdminNote(id, note, user);

      res.status(201).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Get all admin notes for a loan application
   */
  async getAdminNotes(req, res) {
    try {
      const { id } = req.params;

      const result = await loanApplicationService.getAdminNotes(id);

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Update an admin note
   */
  async updateAdminNote(req, res) {
    try {
      const { id, noteId } = req.params;
      const { note } = req.body;
      const user = req.user;

      if (!note) {
        return res.status(400).json({
          success: false,
          error: "Note text is required",
        });
      }

      const result = await loanApplicationService.updateAdminNote(
        id,
        noteId,
        note,
        user,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Admin note not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application or note ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else if (
        error.message === "You are not authorized to update this note"
      ) {
        res.status(403).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Delete an admin note
   */
  async deleteAdminNote(req, res) {
    try {
      const { id, noteId } = req.params;
      const user = req.user;

      const result = await loanApplicationService.deleteAdminNote(
        id,
        noteId,
        user,
      );

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Admin note not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application or note ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else if (
        error.message === "You are not authorized to delete this note"
      ) {
        res.status(403).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * Get loan application statistics
   */
  async getStatistics(req, res) {
    try {
      const userRole = req.user.roles[0];
      const userId = req.user._id;

      const result = await loanApplicationService.getStatistics(
        userRole,
        userId,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Send document requirement notification
   */
  async sendDocumentRequirement(req, res) {
    try {
      const { id } = req.params;
      const { requiredDocuments } = req.body;
      const user = req.user;

      if (
        !requiredDocuments ||
        !Array.isArray(requiredDocuments) ||
        requiredDocuments.length === 0
      ) {
        return res.status(400).json({
          success: false,
          error: "Required documents array is required and cannot be empty",
        });
      }

      const result = await loanApplicationService.sendDocumentRequirement(
        id,
        requiredDocuments,
        user,
      );

      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error.message === "Loan application not found") {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application ID") {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  /**
   * GET /:id/status-updates – return the status change timeline
   */
  async getStatusUpdates(req, res) {
    try {
      const { id } = req.params;
      const application = await require("../models/loanApplication.model")
        .findById(id)
        .populate("status_updates.created_by", "first_name last_name email role")
        .lean();

      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }

      const updates = (application.status_updates || [])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      return res.status(200).json({ success: true, data: updates });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Server error" });
    }
  }

  /**
   * POST /:id/status-updates – append a timeline entry (note + optional attachments)
   */
  async addStatusUpdate(req, res) {
    try {
      const { id } = req.params;
      const { status, note, attachments = [] } = req.body;

      const LoanApplication = require("../models/loanApplication.model");
      const application = await LoanApplication.findById(id);

      if (!application) {
        return res.status(404).json({ success: false, message: "Application not found" });
      }

      const entry = {
        status: status || application.status,
        note: note || "",
        created_by: req.user?._id,
        created_at: new Date(),
        attachments: attachments || [],
      };

      application.status_updates = application.status_updates || [];
      application.status_updates.push(entry);
      await application.save();

      return res.status(201).json({ success: true, data: entry, message: "Status update added" });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Server error" });
    }
  }

  /**
   * Delete a loan application (admin/super_admin only)
   */
  async deleteLoanApplication(req, res) {
    try {
      const { id } = req.params;
      const requestingUser = req.user;

      const result = await loanApplicationService.deleteLoanApplication(
        id,
        requestingUser,
      );

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      const status =
        error.message?.includes("not found") ? 404
        : error.message?.includes("authorized") ? 403
        : 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete loan application",
      });
    }
  }
}

module.exports = new LoanApplicationController();
