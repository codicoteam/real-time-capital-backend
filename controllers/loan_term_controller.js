const loanTermService = require("../services/loan_term_service");
class LoanTermController {
  /**
   * Create a new loan term
   */
  async createLoanTerm(req, res) {
    try {
      const termData = req.body;
      const userId = req.user?.id;

      const result = await loanTermService.createLoanTerm(termData, userId);
      
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create loan term",
        errors: error.errors,
        detail: error.detail
      });
    }
  }

  /**
   * Get loan term by ID
   */
  async getLoanTerm(req, res) {
    try {
      const { id } = req.params;
      
      const result = await loanTermService.getLoanTermById(id);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan term",
        detail: error.detail
      });
    }
  }

  /**
   * Get loan terms with pagination
   */
  async getLoanTerms(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        loan,
        term_no,
        renewal_type,
        approved_by,
        start_date_from,
        start_date_to,
        due_date_from,
        due_date_to,
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
        loan,
        term_no,
        renewal_type,
        approved_by,
        start_date_from,
        start_date_to,
        due_date_from,
        due_date_to
      };

      const result = await loanTermService.getLoanTermsPaginated(
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
        message: error.message || "Failed to retrieve loan terms",
        detail: error.detail
      });
    }
  }

  /**
   * Get all loan terms without pagination
   */
  async getAllLoanTerms(req, res) {
    try {
      const {
        loan,
        renewal_type,
        approved_by,
        sort_by = 'created_at',
        sort_order = 'desc'
      } = req.query;

      // Build sort object
      const sort = { [sort_by]: sort_order === 'asc' ? 1 : -1 };

      // Build filters
      const filters = { loan, renewal_type, approved_by };

      const result = await loanTermService.getAllLoanTerms(filters, sort);

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
        message: error.message || "Failed to retrieve loan terms",
        detail: error.detail
      });
    }
  }

  /**
   * Get loan terms by loan ID
   */
  async getLoanTermsByLoan(req, res) {
    try {
      const { loanId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await loanTermService.getLoanTermsByLoanId(loanId, pageNum, limitNum);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan terms",
        detail: error.detail
      });
    }
  }

  /**
   * Update loan term
   */
  async updateLoanTerm(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      const result = await loanTermService.updateLoanTerm(id, updateData, userId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan term",
        errors: error.errors,
        detail: error.detail
      });
    }
  }

  /**
   * Approve loan term
   */
  async approveLoanTerm(req, res) {
    try {
      const { id } = req.params;
      const approvalData = req.body;
      const userId = req.user?.id;

      const result = await loanTermService.approveLoanTerm(id, approvalData, userId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to approve loan term",
        detail: error.detail
      });
    }
  }

  /**
   * Delete loan term
   */
  async deleteLoanTerm(req, res) {
    try {
      const { id } = req.params;

      const result = await loanTermService.deleteLoanTerm(id);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete loan term",
        detail: error.detail
      });
    }
  }

  /**
   * Get loan term statistics
   */
  async getLoanTermStats(req, res) {
    try {
      const result = await loanTermService.getLoanTermStats();
      
      res.status(200).json({
        success: true,
        message: "Loan term statistics retrieved successfully",
        data: result
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan term statistics",
        detail: error.detail
      });
    }
  }

  /**
   * Get next term number for a loan
   */
  async getNextTermNumber(req, res) {
    try {
      const { loanId } = req.params;
      
      const result = await loanTermService.getNextTermNumber(loanId);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to get next term number",
        detail: error.detail
      });
    }
  }

  /**
   * Create renewal term
   */
  async createRenewalTerm(req, res) {
    try {
      const { loanId } = req.params;
      const renewalData = req.body;
      const userId = req.user?.id;

      // Validate renewal type
      const validRenewalTypes = ["interest_only_renewal", "partial_principal_renewal", "full_settlement"];
      if (!validRenewalTypes.includes(renewalData.renewal_type)) {
        return res.status(400).json({
          success: false,
          message: `Invalid renewal type. Must be one of: ${validRenewalTypes.join(', ')}`
        });
      }

      const result = await loanTermService.createRenewalTerm(loanId, renewalData, userId);
      
      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create renewal term",
        detail: error.detail
      });
    }
  }

  /**
   * Get current active term for a loan
   */
  async getCurrentTerm(req, res) {
    try {
      const { loanId } = req.params;
      
      const currentTerm = await require("../models/loanTerm.model")
        .findOne({ loan: loanId })
        .sort({ term_no: -1 })
        .limit(1)
        .populate([
          { 
            path: 'loan', 
            select: 'loan_no customer_user principal_amount current_balance status' 
          },
          { 
            path: 'approved_by',
            select: 'first_name last_name email'
          }
        ]);

      if (!currentTerm) {
        return res.status(404).json({
          success: false,
          message: `No terms found for loan with ID ${loanId}`
        });
      }

      // Populate customer_user if exists
      if (currentTerm.loan && currentTerm.loan.customer_user) {
        await currentTerm.loan.populate({
          path: 'customer_user',
          select: 'first_name last_name email phone'
        });
      }

      res.status(200).json({
        success: true,
        message: "Current loan term retrieved successfully",
        data: currentTerm
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve current loan term",
        detail: error.message
      });
    }
  }

  /**
   * Get loan term timeline
   */
  async getLoanTermTimeline(req, res) {
    try {
      const { loanId } = req.params;
      
      const timeline = await require("../models/loanTerm.model")
        .find({ loan: loanId })
        .sort({ term_no: 1 })
        .populate([
          { 
            path: 'approved_by',
            select: 'first_name last_name'
          }
        ])
        .lean();

      // Add loan details
      const loan = await require("../models/loan_model")
        .findById(loanId)
        .select('loan_no customer_user principal_amount status')
        .populate('customer_user', 'first_name last_name')
        .lean();

      res.status(200).json({
        success: true,
        message: "Loan term timeline retrieved successfully",
        data: {
          loan,
          timeline,
          total_terms: timeline.length,
          current_term: timeline.length > 0 ? timeline[timeline.length - 1] : null
        }
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan term timeline",
        detail: error.message
      });
    }
  }
}

module.exports = new LoanTermController();