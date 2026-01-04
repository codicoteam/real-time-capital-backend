const loanService = require("../services/loan_service");

class LoanController {
  /**
   * Create a new loan
   */
  async createLoan(req, res) {
    try {
      const loanData = req.body;
      const userId = req.user?.id;

      const result = await loanService.createLoan(loanData, userId);
      
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create loan",
        errors: error.errors,
        detail: error.detail
      });
    }
  }

  /**
   * Get loan by ID
   */
  async getLoan(req, res) {
    try {
      const { id } = req.params;
      
      const result = await loanService.getLoanById(id);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan",
        detail: error.detail
      });
    }
  }

  /**
   * Get loans with pagination
   */
  async getLoans(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        customer_user,
        status,
        collateral_category,
        loan_no,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount,
        sort_by = 'created_at',
        sort_order = 'desc'
      } = req.query;

      // Parse page and limit
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      
      // Validate pagination params
      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100"
        });
      }

      // Build sort object
      const sort = { [sort_by]: sort_order === 'asc' ? 1 : -1 };

      // Build filters
      const filters = {
        customer_user,
        status,
        collateral_category,
        loan_no,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount
      };

      const result = await loanService.getLoansPaginated(
        filters,
        pageNum,
        limitNum,
        sort
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loans",
        detail: error.detail
      });
    }
  }

  /**
   * Get all loans without pagination
   */
  async getAllLoans(req, res) {
    try {
      const {
        customer_user,
        status,
        collateral_category,
        sort_by = 'created_at',
        sort_order = 'desc'
      } = req.query;

      // Build sort object
      const sort = { [sort_by]: sort_order === 'asc' ? 1 : -1 };

      // Build filters
      const filters = { customer_user, status, collateral_category };

      const result = await loanService.getAllLoans(filters, sort);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        count: result.count
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loans",
        detail: error.detail
      });
    }
  }

  /**
   * Update loan
   */
  async updateLoan(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      const result = await loanService.updateLoan(id, updateData, userId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan",
        errors: error.errors,
        detail: error.detail
      });
    }
  }

  /**
   * Update loan status
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const userId = req.user?.id;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required"
        });
      }

      const result = await loanService.updateLoanStatus(id, status, notes, userId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan status",
        detail: error.detail
      });
    }
  }

  /**
   * Delete loan (soft delete)
   */
  async deleteLoan(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const result = await loanService.deleteLoan(id, userId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete loan",
        detail: error.detail
      });
    }
  }

  /**
   * Get loans by customer
   */
  async getLoansByCustomer(req, res) {
    try {
      const { customerId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await loanService.getLoansByCustomer(customerId, pageNum, limitNum);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loans by customer",
        detail: error.detail
      });
    }
  }

  /**
   * Search loans
   */
  async searchLoans(req, res) {
    try {
      const { q } = req.query;
      const { page = 1, limit = 10 } = req.query;

      if (!q || q.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search term must be at least 2 characters long"
        });
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await loanService.searchLoans(q.trim(), pageNum, limitNum);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to search loans",
        detail: error.detail
      });
    }
  }

  /**
   * Get loan statistics
   */
  async getLoanStats(req, res) {
    try {
      const result = await loanService.getLoanStats();
      
      res.status(200).json({
        success: true,
        message: "Loan statistics retrieved successfully",
        data: result
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan statistics",
        detail: error.detail
      });
    }
  }

  /**
   * Calculate loan charges
   */
  async calculateCharges(req, res) {
    try {
      const { id } = req.params;
      
      const result = await loanService.calculateLoanCharges(id);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to calculate loan charges",
        detail: error.detail
      });
    }
  }

  /**
   * Process loan payment
   */
  async processPayment(req, res) {
    try {
      const { id } = req.params;
      const paymentData = req.body;

      if (!paymentData.amount || paymentData.amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Payment amount is required and must be greater than 0"
        });
      }

      const result = await loanService.processPayment(id, paymentData);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to process payment",
        detail: error.detail
      });
    }
  }

  /**
   * Get loan application by ID (populated)
   */
  async getLoanApplication(req, res) {
    try {
      const { id } = req.params;
      
      const loanApplication = await require("../models/loan_application_model")
        .findById(id)
        .populate([
          { 
            path: 'customer_user', 
            select: 'first_name last_name email phone national_id_number address profile_pic_url' 
          },
          { 
            path: 'attachments',
            select: 'filename url mime_type category'
          },
          { 
            path: 'debtor_check.matched_debtor_records',
            select: 'debtor_name amount status'
          },
          { 
            path: 'debtor_check.checked_by',
            select: 'first_name last_name email roles'
          }
        ]);

      if (!loanApplication) {
        return res.status(404).json({
          success: false,
          message: `Loan application with ID ${id} not found`
        });
      }

      res.status(200).json({
        success: true,
        message: "Loan application retrieved successfully",
        data: loanApplication
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan application",
        detail: error.message
      });
    }
  }

  /**
   * Update loan application status
   */
  async updateLoanApplicationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, internal_notes } = req.body;
      const userId = req.user?.id;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required"
        });
      }

      const validStatuses = ["draft", "submitted", "processing", "approved", "rejected", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
      }

      const LoanApplication = require("../models/loan_application_model");
      const loanApplication = await LoanApplication.findById(id);
      
      if (!loanApplication) {
        return res.status(404).json({
          success: false,
          message: `Loan application with ID ${id} not found`
        });
      }

      // Update status and notes
      loanApplication.status = status;
      if (internal_notes) {
        loanApplication.internal_notes = internal_notes;
      }
      loanApplication.updated_at = new Date();
      
      // Add status history
      loanApplication.status_history = loanApplication.status_history || [];
      loanApplication.status_history.push({
        from: loanApplication.status,
        to: status,
        changed_by: userId,
        changed_at: new Date(),
        notes: internal_notes
      });

      await loanApplication.save();

      // Populate before returning
      await loanApplication.populate([
        { path: 'customer_user', select: 'first_name last_name email phone' }
      ]);

      res.status(200).json({
        success: true,
        message: `Loan application status updated to ${status}`,
        data: loanApplication
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan application status",
        detail: error.message
      });
    }
  }
}

module.exports = new LoanController();