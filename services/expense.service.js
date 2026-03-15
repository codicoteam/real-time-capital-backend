const Expense = require("../models/expense.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

// For generating unique expense number
let uuidv4;
(async () => {
  ({ v4: uuidv4 } = await import("uuid"));
})();

/**
 * Expense Service
 * Contains all business logic for expenses
 */
class ExpenseService {
  /**
   * Generate unique expense number
   */
  static async generateExpenseNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `EXP-${year}${month}-${random}`;
  }

  /**
   * Create a new expense
   */
  static async createExpense(expenseData, createdBy) {
    try {
      // Validate required fields
      if (!expenseData.category || !expenseData.amount || !expenseData.expense_date) {
        return {
          success: false,
          message: "Category, amount, and expense date are required",
          statusCode: 400,
        };
      }

      // Generate expense number
      const expenseNo = await this.generateExpenseNumber();

      const expense = new Expense({
        ...expenseData,
        expense_no: expenseNo,
        created_by: createdBy,
      });

      await expense.save();

      // Populate created_by and approved_by for response
      const populatedExpense = await this.getExpenseWithDetails(expense._id);

      return {
        success: true,
        data: populatedExpense,
        message: "Expense recorded successfully",
      };
    } catch (error) {
      console.error("Create expense error:", error);
      throw new Error(error.message || "Failed to create expense");
    }
  }

  /**
   * Get expense with populated fields
   */
  static async getExpenseWithDetails(expenseId) {
    return await Expense.findById(expenseId)
      .populate("created_by", "name email")
      .populate("approved_by", "name email")
      .populate("attachments"); // if Attachment model exists
  }

  /**
   * Get expenses with pagination and filters
   */
  static async getExpenses(filters = {}, pagination = {}, user) {
    try {
      const {
        page = 1,
        limit = 10,
        sort_by = "created_at",
        sort_order = "desc",
        search,
      } = pagination;

      const {
        category,
        status,
        payment_method,
        from_date,
        to_date,
        min_amount,
        max_amount,
        created_by,
      } = filters;

      // Build query
      let query = {};

      if (category) query.category = category;
      if (status) query.status = status;
      if (payment_method) query.payment_method = payment_method;
      if (created_by) query.created_by = created_by;

      // Date range filter
      if (from_date || to_date) {
        query.expense_date = {};
        if (from_date) query.expense_date.$gte = new Date(from_date);
        if (to_date) query.expense_date.$lte = new Date(to_date);
      }

      // Amount range
      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

      // Search by expense_no or description
      if (search && search.length >= 2) {
        query.$or = [
          { expense_no: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { notes: { $regex: search, $options: "i" } },
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [expenses, total] = await Promise.all([
        Expense.find(query)
          .populate("created_by", "name email")
          .populate("approved_by", "name email")
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Expense.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          expenses,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get expenses error:", error);
      throw new Error(error.message || "Failed to fetch expenses");
    }
  }

  /**
   * Get expense by ID
   */
  static async getExpenseById(id, user) {
    try {
      const expense = await this.getExpenseWithDetails(id);

      if (!expense) {
        return {
          success: false,
          message: "Expense not found",
          statusCode: 404,
        };
      }

      return {
        success: true,
        data: expense,
      };
    } catch (error) {
      console.error("Get expense error:", error);
      throw new Error(error.message || "Failed to fetch expense");
    }
  }

  /**
   * Update expense
   */
  static async updateExpense(id, updateData, user) {
    try {
      const expense = await Expense.findById(id);

      if (!expense) {
        return {
          success: false,
          message: "Expense not found",
          statusCode: 404,
        };
      }

      // Only allow updates if status is draft or pending (not approved/rejected)
      if (expense.status === "approved" || expense.status === "rejected") {
        return {
          success: false,
          message: `Cannot update an expense that is ${expense.status}`,
          statusCode: 400,
        };
      }

      // Update expense
      Object.assign(expense, updateData);
      await expense.save();

      const populatedExpense = await this.getExpenseWithDetails(expense._id);

      return {
        success: true,
        data: populatedExpense,
        message: "Expense updated successfully",
      };
    } catch (error) {
      console.error("Update expense error:", error);
      throw new Error(error.message || "Failed to update expense");
    }
  }

  /**
   * Approve or reject expense (status update)
   */
  static async updateExpenseStatus(id, status, approvedBy) {
    try {
      const expense = await Expense.findById(id);

      if (!expense) {
        return {
          success: false,
          message: "Expense not found",
          statusCode: 404,
        };
      }

      // Validate status transition
      const validTransitions = {
        draft: ["pending", "approved", "rejected"],
        pending: ["approved", "rejected"],
        approved: [],
        rejected: ["pending"], // allow re-submit
      };

      if (
        !validTransitions[expense.status] ||
        !validTransitions[expense.status].includes(status)
      ) {
        return {
          success: false,
          message: `Invalid status transition from ${expense.status} to ${status}`,
          statusCode: 400,
        };
      }

      // Update status and approval info
      expense.status = status;
      if (status === "approved" || status === "rejected") {
        expense.approved_by = approvedBy;
        expense.approved_at = new Date();
      } else {
        // Clear approval info if moving back
        expense.approved_by = null;
        expense.approved_at = null;
      }

      await expense.save();

      const populatedExpense = await this.getExpenseWithDetails(expense._id);

      return {
        success: true,
        data: populatedExpense,
        message: `Expense ${status} successfully`,
      };
    } catch (error) {
      console.error("Update expense status error:", error);
      throw new Error(error.message || "Failed to update expense status");
    }
  }

  /**
   * Delete expense (soft delete or permanent)
   * For simplicity, we'll allow deletion only if not approved
   */
  static async deleteExpense(id, user) {
    try {
      const expense = await Expense.findById(id);

      if (!expense) {
        return {
          success: false,
          message: "Expense not found",
          statusCode: 404,
        };
      }

      // Prevent deletion of approved expenses
      if (expense.status === "approved") {
        return {
          success: false,
          message: "Cannot delete an approved expense",
          statusCode: 400,
        };
      }

      await Expense.findByIdAndDelete(id);

      return {
        success: true,
        message: "Expense deleted successfully",
      };
    } catch (error) {
      console.error("Delete expense error:", error);
      throw new Error(error.message || "Failed to delete expense");
    }
  }

  /**
   * Get expense statistics
   */
  static async getExpenseStats(user) {
    try {
      const stats = await Expense.aggregate([
        {
          $group: {
            _id: null,
            total_expenses: { $sum: "$amount" },
            count: { $sum: 1 },
            avg_amount: { $avg: "$amount" },
            min_amount: { $min: "$amount" },
            max_amount: { $max: "$amount" },
          },
        },
      ]);

      // Count by status
      const statusCounts = await Expense.aggregate([
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
      ]);

      // Count by category
      const categoryCounts = await Expense.aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { total: -1 } },
      ]);

      // This month's expenses
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const thisMonth = await Expense.aggregate([
        {
          $match: {
            expense_date: { $gte: startOfMonth, $lte: endOfMonth },
            status: "approved", // only count approved expenses
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      const result = stats[0] || {
        total_expenses: 0,
        count: 0,
        avg_amount: 0,
        min_amount: 0,
        max_amount: 0,
      };

      return {
        success: true,
        data: {
          ...result,
          status_breakdown: statusCounts,
          category_breakdown: categoryCounts,
          this_month: thisMonth[0] || { total: 0, count: 0 },
        },
      };
    } catch (error) {
      console.error("Get expense stats error:", error);
      throw new Error(error.message || "Failed to fetch expense statistics");
    }
  }
}

module.exports = ExpenseService;