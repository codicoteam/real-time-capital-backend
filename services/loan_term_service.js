const LoanTerm = require("../models/loanTerm.model");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");

class LoanTermService {
  /**
   * Create a new loan term
   */
  async createLoanTerm(termData, userId) {
    try {
      // Validate that loan exists
      const loan = await Loan.findById(termData.loan);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${termData.loan} not found`,
        };
      }

      // Calculate term number if not provided
      if (!termData.term_no) {
        const lastTerm = await LoanTerm.findOne({ loan: termData.loan })
          .sort({ term_no: -1 })
          .limit(1);
        termData.term_no = lastTerm ? lastTerm.term_no + 1 : 1;
      }

      // Set approved_by and approved_at if status indicates approval
      if (termData.status === "approved" && userId) {
        termData.approved_by = userId;
        termData.approved_at = new Date();
      }

      // Validate dates
      this.validateTermDates(termData);

      const loanTerm = new LoanTerm(termData);
      await loanTerm.save();

      // Populate necessary fields
      const populatedTerm = await loanTerm.populate([
        {
          path: "loan",
          select:
            "loan_no customer_user principal_amount current_balance status due_date",
        },
        {
          path: "approved_by",
          select: "first_name last_name email roles",
        },
      ]);

      // If this is an approved renewal, update the loan
      if (loanTerm.renewal_type !== "initial" && loanTerm.approved_by) {
        await this.updateLoanForRenewal(loanTerm);
      }

      return {
        success: true,
        data: populatedTerm,
        message: "Loan term created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loan term by ID with full population
   */
  async getLoanTermById(termId) {
    try {
      const loanTerm = await LoanTerm.findById(termId).populate([
        {
          path: "loan",
          select:
            "loan_no customer_user principal_amount current_balance currency status start_date due_date interest_rate_percent storage_charge_percent",
        },
        {
          path: "approved_by",
          select: "first_name last_name email phone roles",
        },
      ]);

      if (!loanTerm) {
        throw {
          status: 404,
          message: `Loan term with ID ${termId} not found`,
        };
      }

      // Additional population if loan has customer_user
      if (loanTerm.loan && loanTerm.loan.customer_user) {
        await loanTerm.loan.populate({
          path: "customer_user",
          select: "first_name last_name email phone national_id_number",
        });
      }

      return {
        success: true,
        data: loanTerm,
        message: "Loan term retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loan terms with pagination
   */
  async getLoanTermsPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 }
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.loan) query.loan = filters.loan;
      if (filters.term_no) query.term_no = filters.term_no;
      if (filters.renewal_type) query.renewal_type = filters.renewal_type;
      if (filters.approved_by) query.approved_by = filters.approved_by;

      // Date range filters
      if (filters.start_date_from || filters.start_date_to) {
        query.start_date = {};
        if (filters.start_date_from)
          query.start_date.$gte = new Date(filters.start_date_from);
        if (filters.start_date_to)
          query.start_date.$lte = new Date(filters.start_date_to);
      }

      if (filters.due_date_from || filters.due_date_to) {
        query.due_date = {};
        if (filters.due_date_from)
          query.due_date.$gte = new Date(filters.due_date_from);
        if (filters.due_date_to)
          query.due_date.$lte = new Date(filters.due_date_to);
      }

      // Execute query with pagination
      const [loanTerms, total] = await Promise.all([
        LoanTerm.find(query)
          .populate([
            {
              path: "loan",
              select: "loan_no customer_user principal_amount status",
            },
            {
              path: "approved_by",
              select: "first_name last_name email",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        LoanTerm.countDocuments(query),
      ]);

      // Additional population for customer_user in each loan
      const populatedTerms = await Promise.all(
        loanTerms.map(async (term) => {
          if (term.loan && term.loan.customer_user) {
            const customer = await User.findById(term.loan.customer_user)
              .select("first_name last_name email phone")
              .lean();
            term.loan.customer_user = customer;
          }
          return term;
        })
      );

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          loanTerms: populatedTerms,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Loan terms retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all loan terms without pagination (for exports, reports, etc.)
   */
  async getAllLoanTerms(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.loan) query.loan = filters.loan;
      if (filters.renewal_type) query.renewal_type = filters.renewal_type;
      if (filters.approved_by) query.approved_by = filters.approved_by;

      const loanTerms = await LoanTerm.find(query)
        .populate([
          {
            path: "loan",
            select: "loan_no customer_user principal_amount status",
          },
          {
            path: "approved_by",
            select: "first_name last_name email",
          },
        ])
        .sort(sort)
        .lean();

      // Additional population for customer_user in each loan
      const populatedTerms = await Promise.all(
        loanTerms.map(async (term) => {
          if (term.loan && term.loan.customer_user) {
            const customer = await User.findById(term.loan.customer_user)
              .select("first_name last_name email phone")
              .lean();
            term.loan.customer_user = customer;
          }
          return term;
        })
      );

      return {
        success: true,
        data: populatedTerms,
        message: "All loan terms retrieved successfully",
        count: populatedTerms.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loan terms by loan ID
   */
  async getLoanTermsByLoanId(loanId, page = 1, limit = 10) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      return this.getLoanTermsPaginated({ loan: loanId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan term
   */
  async updateLoanTerm(termId, updateData, userId) {
    try {
      // Check if term exists
      const existingTerm = await LoanTerm.findById(termId);
      if (!existingTerm) {
        throw {
          status: 404,
          message: `Loan term with ID ${termId} not found`,
        };
      }

      // Prevent updating term_no if provided and different
      if (updateData.term_no && updateData.term_no !== existingTerm.term_no) {
        throw {
          status: 400,
          message: "Term number cannot be changed",
        };
      }

      // If approving, set approved_by and approved_at
      if (
        updateData.status === "approved" &&
        !existingTerm.approved_by &&
        userId
      ) {
        updateData.approved_by = userId;
        updateData.approved_at = new Date();
      }

      // Validate dates if being updated
      if (updateData.start_date || updateData.due_date) {
        const datesToValidate = {
          start_date: updateData.start_date || existingTerm.start_date,
          due_date: updateData.due_date || existingTerm.due_date,
        };
        this.validateTermDates(datesToValidate);
      }

      const updatedTerm = await LoanTerm.findByIdAndUpdate(termId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        {
          path: "loan",
          select: "loan_no customer_user principal_amount",
        },
        {
          path: "approved_by",
          select: "first_name last_name email",
        },
      ]);

      return {
        success: true,
        data: updatedTerm,
        message: "Loan term updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Approve loan term
   */
  async approveLoanTerm(termId, approvalData, userId) {
    try {
      const loanTerm = await LoanTerm.findById(termId);
      if (!loanTerm) {
        throw {
          status: 404,
          message: `Loan term with ID ${termId} not found`,
        };
      }

      if (loanTerm.approved_by) {
        throw {
          status: 400,
          message: "Loan term is already approved",
        };
      }

      const updateData = {
        approved_by: userId,
        approved_at: new Date(),
        notes: approvalData.notes || loanTerm.notes,
        updated_at: new Date(),
      };

      const approvedTerm = await LoanTerm.findByIdAndUpdate(
        termId,
        updateData,
        { new: true }
      ).populate([
        {
          path: "loan",
          select: "loan_no customer_user principal_amount current_balance",
        },
        {
          path: "approved_by",
          select: "first_name last_name email roles",
        },
      ]);

      // If this is a renewal, update the loan
      if (approvedTerm.renewal_type !== "initial") {
        await this.updateLoanForRenewal(approvedTerm);
      }

      return {
        success: true,
        data: approvedTerm,
        message: "Loan term approved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete loan term
   */
  async deleteLoanTerm(termId) {
    try {
      const loanTerm = await LoanTerm.findById(termId);

      if (!loanTerm) {
        throw {
          status: 404,
          message: `Loan term with ID ${termId} not found`,
        };
      }

      // Check if term is approved - might want to prevent deletion of approved terms
      if (loanTerm.approved_by) {
        throw {
          status: 400,
          message: "Cannot delete an approved loan term",
        };
      }

      await LoanTerm.findByIdAndDelete(termId);

      return {
        success: true,
        message: "Loan term deleted successfully",
        data: { termId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate loan term statistics
   */
  async getLoanTermStats() {
    try {
      const total = await LoanTerm.countDocuments();

      const byRenewalType = await LoanTerm.aggregate([
        { $group: { _id: "$renewal_type", count: { $sum: 1 } } },
      ]);

      const termsByMonth = await LoanTerm.aggregate([
        {
          $group: {
            _id: {
              year: { $year: "$created_at" },
              month: { $month: "$created_at" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },
      ]);

      const approvedCount = await LoanTerm.countDocuments({
        approved_by: { $exists: true },
      });

      const averageTermLength = await LoanTerm.aggregate([
        {
          $addFields: {
            termDays: {
              $divide: [
                { $subtract: ["$due_date", "$start_date"] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            averageDays: { $avg: "$termDays" },
          },
        },
      ]);

      // Convert aggregates to objects
      const renewalStats = {};
      byRenewalType.forEach((item) => {
        renewalStats[item._id] = item.count;
      });

      return {
        total,
        by_renewal_type: renewalStats,
        monthly_terms: termsByMonth,
        approved_count: approvedCount,
        pending_approval_count: total - approvedCount,
        average_term_days: averageTermLength[0]?.averageDays || 0,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get next term number for a loan
   */
  async getNextTermNumber(loanId) {
    try {
      const lastTerm = await LoanTerm.findOne({ loan: loanId })
        .sort({ term_no: -1 })
        .limit(1);

      return {
        success: true,
        data: {
          loan: loanId,
          next_term_no: lastTerm ? lastTerm.term_no + 1 : 1,
          last_term: lastTerm,
        },
        message: "Next term number retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create renewal term
   */
  async createRenewalTerm(loanId, renewalData, userId) {
    try {
      const loan = await Loan.findById(loanId).populate(
        "customer_user",
        "first_name last_name"
      );
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Get the last term
      const lastTerm = await LoanTerm.findOne({ loan: loanId })
        .sort({ term_no: -1 })
        .limit(1);

      if (!lastTerm) {
        throw {
          status: 400,
          message: "No existing term found for this loan",
        };
      }

      const nextTermNo = lastTerm.term_no + 1;

      // Calculate new dates based on renewal type
      const newTermData = this.calculateRenewalTermData(
        lastTerm,
        renewalData,
        nextTermNo
      );

      // Create the renewal term
      const renewalTerm = new LoanTerm({
        ...newTermData,
        loan: loanId,
        term_no: nextTermNo,
        renewal_type: renewalData.renewal_type,
        notes: renewalData.notes,
        created_by: userId,
      });

      await renewalTerm.save();

      // Populate before returning
      await renewalTerm.populate([
        {
          path: "loan",
          select: "loan_no customer_user principal_amount current_balance",
        },
        {
          path: "approved_by",
          select: "first_name last_name email",
        },
      ]);

      return {
        success: true,
        data: renewalTerm,
        message: `Renewal term created successfully (Term ${nextTermNo})`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate renewal term data
   */
  calculateRenewalTermData(lastTerm, renewalData, nextTermNo) {
    const startDate = new Date(lastTerm.due_date);
    const dueDate = new Date(startDate);

    // Calculate new due date based on interest period
    dueDate.setDate(dueDate.getDate() + lastTerm.interest_period_days);

    // Calculate balances based on renewal type
    let openingBalance = lastTerm.closing_balance;
    let closingBalance = lastTerm.closing_balance;

    switch (renewalData.renewal_type) {
      case "interest_only_renewal":
        // Add interest to balance
        const interest =
          lastTerm.closing_balance * (lastTerm.interest_rate_percent / 100);
        closingBalance += interest;
        break;

      case "partial_principal_renewal":
        // Add partial payment
        if (renewalData.payment_amount && renewalData.payment_amount > 0) {
          closingBalance -= renewalData.payment_amount;
        }
        break;

      case "full_settlement":
        closingBalance = 0;
        break;
    }

    return {
      start_date: startDate,
      due_date: dueDate,
      opening_balance: openingBalance,
      closing_balance: closingBalance,
      interest_rate_percent: lastTerm.interest_rate_percent,
      interest_period_days: lastTerm.interest_period_days,
      storage_charge_percent: lastTerm.storage_charge_percent,
    };
  }

  /**
   * Update loan for renewal
   */
  async updateLoanForRenewal(loanTerm) {
    const loanUpdate = {
      current_balance: loanTerm.closing_balance,
      start_date: loanTerm.start_date,
      due_date: loanTerm.due_date,
      updated_at: new Date(),
    };

    // Update loan status if fully settled
    if (
      loanTerm.renewal_type === "full_settlement" &&
      loanTerm.closing_balance === 0
    ) {
      loanUpdate.status = "redeemed";
    }

    await Loan.findByIdAndUpdate(loanTerm.loan._id, loanUpdate);
  }

  /**
   * Validate loan term dates
   */
  validateTermDates(termData) {
    if (termData.start_date && termData.due_date) {
      const startDate = new Date(termData.start_date);
      const dueDate = new Date(termData.due_date);

      if (dueDate <= startDate) {
        throw {
          status: 400,
          message: "Due date must be after start date",
        };
      }
    }

    if (termData.opening_balance < 0 || termData.closing_balance < 0) {
      throw {
        status: 400,
        message: "Balances cannot be negative",
      };
    }
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Loan Term Service Error:", error);

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

module.exports = new LoanTermService();
