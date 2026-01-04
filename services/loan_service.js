const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Attachment = require("../models/attachment.model");

class LoanService {
  /**
   * Create a new loan
   */
  async createLoan(loanData, userId) {
    try {
      // Generate loan number if not provided
      if (!loanData.loan_no) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(1000 + Math.random() * 9000);
        loanData.loan_no = `LON${year}${month}${random}`;
      }

      // Set created_by if not provided
      if (!loanData.created_by && userId) {
        loanData.created_by = userId;
      }

      // Set initial current_balance to principal_amount if not provided
      if (!loanData.current_balance && loanData.principal_amount) {
        loanData.current_balance = loanData.principal_amount;
      }

      // Validate required dates
      this.validateLoanDates(loanData);

      const loan = new Loan(loanData);
      await loan.save();

      // Populate necessary fields
      const populatedLoan = await loan.populate([
        {
          path: "customer_user",
          select: "first_name last_name email phone national_id_number address",
        },
        {
          path: "asset",
          select: "asset_no title category evaluated_value status",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_description status",
        },
        {
          path: "created_by",
          select: "first_name last_name email roles",
        },
      ]);

      // Update asset status to 'pawned' if loan is being created
      if (loanData.status === "active" && loanData.asset) {
        await Asset.findByIdAndUpdate(loanData.asset, {
          status: "pawned",
          active_loan: loan._id,
        });
      }

      return {
        success: true,
        data: populatedLoan,
        message: "Loan created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loan by ID with full population
   */
  async getLoanById(loanId) {
    try {
      const loan = await Loan.findById(loanId).populate([
        {
          path: "customer_user",
          select:
            "first_name last_name email phone national_id_number address profile_pic_url",
        },
        {
          path: "asset",
          select:
            "asset_no title category evaluated_value declared_value status storage_location attachments",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_description surety_description status created_at",
        },
        {
          path: "attachments",
          select: "filename url mime_type category signed signed_at",
        },
        {
          path: "created_by",
          select: "first_name last_name email roles",
        },
        {
          path: "processed_by",
          select: "first_name last_name email roles",
        },
        {
          path: "approved_by",
          select: "first_name last_name email roles",
        },
      ]);

      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      return {
        success: true,
        data: loan,
        message: "Loan retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loans with pagination
   */
  async getLoansPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 }
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.customer_user) query.customer_user = filters.customer_user;
      if (filters.status) query.status = filters.status;
      if (filters.collateral_category)
        query.collateral_category = filters.collateral_category;
      if (filters.loan_no)
        query.loan_no = { $regex: filters.loan_no, $options: "i" };

      // Date range filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      // Due date filters
      if (filters.due_from || filters.due_to) {
        query.due_date = {};
        if (filters.due_from) query.due_date.$gte = new Date(filters.due_from);
        if (filters.due_to) query.due_date.$lte = new Date(filters.due_to);
      }

      // Amount range filters
      if (filters.min_amount || filters.max_amount) {
        query.principal_amount = {};
        if (filters.min_amount)
          query.principal_amount.$gte = parseFloat(filters.min_amount);
        if (filters.max_amount)
          query.principal_amount.$lte = parseFloat(filters.max_amount);
      }

      // Execute query with pagination
      const [loans, total] = await Promise.all([
        Loan.find(query)
          .populate([
            {
              path: "customer_user",
              select: "first_name last_name email phone",
            },
            {
              path: "asset",
              select: "asset_no title category evaluated_value",
            },
            {
              path: "application",
              select: "application_no requested_loan_amount",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Loan.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          loans,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Loans retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all loans without pagination (for exports, reports, etc.)
   */
  async getAllLoans(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.customer_user) query.customer_user = filters.customer_user;
      if (filters.status) query.status = filters.status;
      if (filters.collateral_category)
        query.collateral_category = filters.collateral_category;

      const loans = await Loan.find(query)
        .populate([
          {
            path: "customer_user",
            select: "first_name last_name email phone national_id_number",
          },
          {
            path: "asset",
            select: "asset_no title category evaluated_value",
          },
          {
            path: "application",
            select: "application_no requested_loan_amount",
          },
        ])
        .sort(sort)
        .lean();

      return {
        success: true,
        data: loans,
        message: "All loans retrieved successfully",
        count: loans.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan
   */
  async updateLoan(loanId, updateData, userId) {
    try {
      // Check if loan exists
      const existingLoan = await Loan.findById(loanId);
      if (!existingLoan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Prevent updating loan_no if provided
      if (updateData.loan_no && updateData.loan_no !== existingLoan.loan_no) {
        throw {
          status: 400,
          message: "Loan number cannot be changed",
        };
      }

      // Check if loan status allows updates
      if (
        existingLoan.status === "closed" ||
        existingLoan.status === "cancelled"
      ) {
        throw {
          status: 400,
          message: `Cannot update loan with status: ${existingLoan.status}`,
        };
      }

      // Add audit trail
      updateData.updated_at = new Date();

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        {
          path: "customer_user",
          select: "first_name last_name email phone",
        },
        {
          path: "asset",
          select: "asset_no title category",
        },
      ]);

      return {
        success: true,
        data: updatedLoan,
        message: "Loan updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan status with business logic
   */
  async updateLoanStatus(loanId, status, notes = "", userId) {
    try {
      const validStatuses = [
        "draft",
        "active",
        "overdue",
        "in_grace",
        "auction",
        "sold",
        "redeemed",
        "closed",
        "cancelled",
      ];

      if (!validStatuses.includes(status)) {
        throw {
          status: 400,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        };
      }

      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Status transition validations
      this.validateStatusTransition(loan.status, status, loan);

      const updateData = {
        status,
        updated_at: new Date(),
        $push: {
          status_history: {
            from: loan.status,
            to: status,
            changed_by: userId,
            changed_at: new Date(),
            notes,
          },
        },
      };

      // Set approval/processing user based on status
      if (status === "active" && !loan.processed_by && userId) {
        updateData.processed_by = userId;
        updateData.disbursed_at = new Date();
      }

      if (status === "active" && !loan.approved_by && userId) {
        updateData.approved_by = userId;
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
      }).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
      ]);

      // Update associated asset status
      await this.updateAssetStatusBasedOnLoan(updatedLoan);

      return {
        success: true,
        data: updatedLoan,
        message: `Loan status updated to ${status}`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete loan (soft delete)
   */
  async deleteLoan(loanId, userId) {
    try {
      const loan = await Loan.findById(loanId);

      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Check if loan can be deleted
      if (loan.status === "active" || loan.status === "overdue") {
        throw {
          status: 400,
          message:
            "Cannot delete active or overdue loan. Close or cancel it first.",
        };
      }

      // Soft delete by changing status
      loan.status = "cancelled";
      loan.updated_at = new Date();
      await loan.save();

      // Remove loan reference from asset
      if (loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          $unset: { active_loan: "" },
          status: "closed",
        });
      }

      return {
        success: true,
        message: "Loan cancelled successfully",
        data: { loanId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loans by customer
   */
  async getLoansByCustomer(customerId, page = 1, limit = 10) {
    try {
      const user = await User.findById(customerId);
      if (!user) {
        throw {
          status: 404,
          message: `Customer with ID ${customerId} not found`,
        };
      }

      return this.getLoansPaginated({ customer_user: customerId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Search loans
   */
  async searchLoans(searchTerm, page = 1, limit = 10) {
    try {
      const query = {
        $or: [
          { loan_no: { $regex: searchTerm, $options: "i" } },
          { "customer_user.name": { $regex: searchTerm, $options: "i" } },
          { "customer_user.email": { $regex: searchTerm, $options: "i" } },
          {
            "customer_user.national_id_number": {
              $regex: searchTerm,
              $options: "i",
            },
          },
        ],
      };

      // Try to find users matching search term
      const users = await User.find({
        $or: [
          { first_name: { $regex: searchTerm, $options: "i" } },
          { last_name: { $regex: searchTerm, $options: "i" } },
          { email: { $regex: searchTerm, $options: "i" } },
          { national_id_number: { $regex: searchTerm, $options: "i" } },
          { phone: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      if (users.length > 0) {
        query.$or.push({ customer_user: { $in: users.map((u) => u._id) } });
      }

      return this.getLoansPaginated(query, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate loan summary/statistics
   */
  async getLoanStats() {
    try {
      const total = await Loan.countDocuments();

      const byStatus = await Loan.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const byCategory = await Loan.aggregate([
        { $group: { _id: "$collateral_category", count: { $sum: 1 } } },
      ]);

      const totalPrincipal = await Loan.aggregate([
        { $match: { principal_amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$principal_amount" } } },
      ]);

      const totalBalance = await Loan.aggregate([
        { $match: { current_balance: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$current_balance" } } },
      ]);

      const overdueLoans = await Loan.countDocuments({
        status: "overdue",
        due_date: { $lt: new Date() },
      });

      // Convert aggregates to objects
      const statusStats = {};
      byStatus.forEach((item) => {
        statusStats[item._id] = item.count;
      });

      const categoryStats = {};
      byCategory.forEach((item) => {
        categoryStats[item._id] = item.count;
      });

      return {
        total,
        by_status: statusStats,
        by_category: categoryStats,
        total_principal_amount: totalPrincipal[0]?.total || 0,
        total_current_balance: totalBalance[0]?.total || 0,
        overdue_count: overdueLoans,
        active_loans_count: statusStats.active || 0,
        closed_loans_count: statusStats.closed || 0,
        redeemed_loans_count: statusStats.redeemed || 0,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate interest and charges
   */
  async calculateLoanCharges(loanId) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      const now = new Date();
      const startDate = new Date(loan.start_date);
      const dueDate = new Date(loan.due_date);

      // Calculate days elapsed
      const daysElapsed = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
      const totalLoanDays = Math.ceil(
        (dueDate - startDate) / (1000 * 60 * 60 * 24)
      );

      // Calculate interest
      const dailyInterestRate = loan.interest_rate_percent / 100 / 365;
      const interestAccrued =
        loan.principal_amount * dailyInterestRate * daysElapsed;

      // Calculate storage charge
      const storageCharge =
        (loan.principal_amount * loan.storage_charge_percent) / 100;

      // Calculate penalty if overdue
      let penalty = 0;
      if (now > dueDate && loan.status === "overdue") {
        const overdueDays = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
        penalty =
          loan.current_balance * (loan.penalty_percent / 100) * overdueDays;
      }

      const totalDue =
        loan.current_balance + interestAccrued + storageCharge + penalty;

      return {
        success: true,
        data: {
          principal: loan.principal_amount,
          current_balance: loan.current_balance,
          days_elapsed: daysElapsed,
          total_loan_days: totalLoanDays,
          interest_rate: loan.interest_rate_percent,
          interest_accrued: parseFloat(interestAccrued.toFixed(2)),
          storage_charge_percent: loan.storage_charge_percent,
          storage_charge: parseFloat(storageCharge.toFixed(2)),
          penalty_percent: loan.penalty_percent,
          penalty: parseFloat(penalty.toFixed(2)),
          total_due: parseFloat(totalDue.toFixed(2)),
          due_date: loan.due_date,
          is_overdue: now > dueDate,
          overdue_days:
            now > dueDate
              ? Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24))
              : 0,
        },
        message: "Loan charges calculated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Process loan payment
   */
  async processPayment(loanId, paymentData) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      if (loan.status !== "active" && loan.status !== "overdue") {
        throw {
          status: 400,
          message: `Cannot process payment for loan with status: ${loan.status}`,
        };
      }

      const { amount, payment_method, notes } = paymentData;

      if (!amount || amount <= 0) {
        throw {
          status: 400,
          message: "Payment amount must be greater than 0",
        };
      }

      // Calculate charges first
      const charges = await this.calculateLoanCharges(loanId);

      // Update loan balance
      const newBalance = Math.max(0, loan.current_balance - amount);

      const updateData = {
        current_balance: newBalance,
        updated_at: new Date(),
        $push: {
          payment_history: {
            amount,
            payment_method,
            notes,
            paid_at: new Date(),
            previous_balance: loan.current_balance,
            new_balance: newBalance,
          },
        },
      };

      // Update status if fully paid
      if (newBalance === 0) {
        updateData.status = "redeemed";
        updateData.closed_at = new Date();
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
      });

      // Update asset status if loan is redeemed
      if (newBalance === 0 && loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          status: "redeemed",
          $unset: { active_loan: "" },
        });
      }

      return {
        success: true,
        data: {
          loan: updatedLoan,
          payment: {
            amount,
            payment_method,
            previous_balance: loan.current_balance,
            new_balance: newBalance,
            remaining_balance: newBalance,
            fully_paid: newBalance === 0,
          },
        },
        message: `Payment of ${amount} processed successfully`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Validate loan status transition
   */
  validateStatusTransition(currentStatus, newStatus, loan) {
    const validTransitions = {
      draft: ["active", "cancelled"],
      active: ["overdue", "in_grace", "redeemed", "closed"],
      overdue: ["in_grace", "auction", "redeemed", "closed"],
      in_grace: ["auction", "redeemed", "closed"],
      auction: ["sold", "closed"],
      sold: ["closed"],
      redeemed: ["closed"],
      closed: [], // Cannot change from closed
      cancelled: [], // Cannot change from cancelled
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw {
        status: 400,
        message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
      };
    }

    // Additional business rules
    if (newStatus === "redeemed" && loan.current_balance > 0) {
      throw {
        status: 400,
        message: "Cannot redeem loan with outstanding balance",
      };
    }
  }

  /**
   * Update asset status based on loan status
   */
  async updateAssetStatusBasedOnLoan(loan) {
    const assetStatusMap = {
      active: "pawned",
      overdue: "overdue",
      in_grace: "overdue",
      auction: "auction",
      sold: "sold",
      redeemed: "redeemed",
      closed: "closed",
      cancelled: "closed",
    };

    if (assetStatusMap[loan.status] && loan.asset) {
      await Asset.findByIdAndUpdate(loan.asset, {
        status: assetStatusMap[loan.status],
      });
    }
  }

  /**
   * Validate loan dates
   */
  validateLoanDates(loanData) {
    if (loanData.start_date && loanData.due_date) {
      const startDate = new Date(loanData.start_date);
      const dueDate = new Date(loanData.due_date);

      if (dueDate <= startDate) {
        throw {
          status: 400,
          message: "Due date must be after start date",
        };
      }
    }
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Loan Service Error:", error);

    // If it's already a custom error, return it
    if (error.status && error.message) {
      return error;
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        status: 409,
        message: `${field.replace("_", " ")} already exists`,
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

module.exports = new LoanService();
