const ExpenseService = require("../services/expense.service");

/**
 * Expense Controller
 * Handles HTTP requests and responses
 */
class ExpenseController {
  /**
   * Create a new expense
   */
  static async createExpense(req, res) {
    try {
      const {
        category,
        amount,
        expense_date,
        payment_method,
        description,
        attachments,
        notes,
        status, // optional, default will be set in service
      } = req.body;

      // Basic validation
      if (!category || !amount || !expense_date) {
        return res.status(400).json({
          success: false,
          message: "Category, amount, and expense date are required",
        });
      }

      const result = await ExpenseService.createExpense(
        {
          category,
          amount: parseFloat(amount),
          expense_date: new Date(expense_date),
          payment_method,
          description,
          attachments,
          notes,
          status,
        },
        req.user._id,
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(201).json(result);
    } catch (error) {
      console.error("Create expense controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get expenses with pagination and filters
   */
  static async getExpenses(req, res) {
    try {
      const filters = {
        category: req.query.category,
        status: req.query.status,
        payment_method: req.query.payment_method,
        from_date: req.query.from_date,
        to_date: req.query.to_date,
        min_amount: req.query.min_amount,
        max_amount: req.query.max_amount,
        created_by: req.query.created_by,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by || "expense_date",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search,
      };

      const result = await ExpenseService.getExpenses(
        filters,
        pagination,
        req.user,
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get expenses controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get expense by ID
   */
  static async getExpense(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Expense ID is required",
        });
      }

      const result = await ExpenseService.getExpenseById(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get expense controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update expense
   */
  static async updateExpense(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Expense ID is required",
        });
      }

      // Parse numeric fields
      if (updateData.amount) {
        updateData.amount = parseFloat(updateData.amount);
      }
      if (updateData.expense_date) {
        updateData.expense_date = new Date(updateData.expense_date);
      }

      const result = await ExpenseService.updateExpense(
        id,
        updateData,
        req.user,
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update expense controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update expense status (approve/reject)
   */
  static async updateExpenseStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Expense ID is required",
        });
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const validStatuses = ["draft", "pending", "approved", "rejected"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const result = await ExpenseService.updateExpenseStatus(
        id,
        status,
        req.user._id,
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update expense status controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete expense
   */
  static async deleteExpense(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Expense ID is required",
        });
      }

      const result = await ExpenseService.deleteExpense(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Delete expense controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get expense statistics
   */
  static async getExpenseStats(req, res) {
    try {
      const result = await ExpenseService.getExpenseStats(req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get expense stats controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = ExpenseController;
