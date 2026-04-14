const loanApplicationService = require("../services/loan_application_service");

class LoanApplicationController {
  /**
   * Create a new loan application (draft) – for customers themselves
   */
  async createLoanApplication(req, res) {
    try {
      const applicationData = req.body;
      const user = req.user; // full user object with roles

      const result = await loanApplicationService.createLoanApplication(
        applicationData,
        user,
        null, // no separate customer – it's self‑service
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

      const user = req.user; // staff user (agent/processor)
      const customerUserId = applicationData.customer_user_id;

      // Remove the separate field from the data that goes into the application
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
   * Submit a draft loan application
   */
  async submitLoanApplication(req, res) {
    try {
      const { id } = req.params;
      const user = req.user;

      const result = await loanApplicationService.submitLoanApplication(
        id,
        user,
      );

      res.status(200).json({
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
   * Access: Only the agent themselves or admins
   */
  async getLoanApplicationsByAgentId(req, res) {
    try {
      const { agentId } = req.params;
      const loggedInUser = req.user;
      const userRoles = loggedInUser.roles;

      // Allow if user is an admin/manager or the agent themselves
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
   * Access: Only the processor themselves or admins
   */
  async getLoanApplicationsByProcessorId(req, res) {
    try {
      const { processorId } = req.params;
      const loggedInUser = req.user;
      const userRoles = loggedInUser.roles;

      // Allow if user is an admin/manager or the processor themselves
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
   * Add attachment to loan application
   */
  async addAttachment(req, res) {
    try {
      const { id } = req.params;
      const { attachmentId } = req.body;
      const userRole = req.user.roles[0];
      const userId = req.user._id;

      if (!attachmentId) {
        return res.status(400).json({
          success: false,
          error: "Attachment ID is required",
        });
      }

      const result = await loanApplicationService.addAttachment(
        id,
        attachmentId,
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
      } else if (error.message === "Invalid application or attachment ID") {
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
   * Remove attachment from loan application
   */
  async removeAttachment(req, res) {
    try {
      const { id, attachmentId } = req.params;
      const userRole = req.user.roles[0];
      const userId = req.user._id;

      const result = await loanApplicationService.removeAttachment(
        id,
        attachmentId,
        userRole,
        userId,
      );

      res.status(200).json({
        success: true,
        data: result.data,
        message: result.message,
      });
    } catch (error) {
      if (
        error.message === "Loan application not found or cannot be modified"
      ) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else if (error.message === "Invalid application or attachment ID") {
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
}

module.exports = new LoanApplicationController();
