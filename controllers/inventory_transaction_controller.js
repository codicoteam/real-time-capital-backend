const InventoryTransactionService = require("../services/inventory_transaction_service");

/**
 * Inventory Transaction Controller
 * Handles HTTP requests and responses for financial transactions
 */
class InventoryTransactionController {
  /**
   * Create a new inventory transaction
   */
  async createTransaction(req, res) {
    try {
      const transactionData = req.body;
      const userId = req.user?.id;

      const result = await InventoryTransactionService.createTransaction(
        transactionData,
        userId
      );

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create loan disbursement transaction
   */
  async createLoanDisbursementTransaction(req, res) {
    try {
      const { loanId } = req.params;
      const userId = req.user?.id;

      if (!loanId) {
        return res.status(400).json({
          success: false,
          message: "Loan ID is required",
        });
      }

      const result =
        await InventoryTransactionService.createLoanDisbursementTransaction(
          loanId,
          userId
        );

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message:
          error.message || "Failed to create loan disbursement transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create repayment transaction from payment
   */
  async createRepaymentTransaction(req, res) {
    try {
      const { paymentId } = req.params;
      const userId = req.user?.id;

      if (!paymentId) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result =
        await InventoryTransactionService.createRepaymentTransaction(
          paymentId,
          userId
        );

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create repayment transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create asset sale transaction
   */
  async createAssetSaleTransaction(req, res) {
    try {
      const { assetId } = req.params;
      const { sale_price, ...meta } = req.body;
      const userId = req.user?.id;

      if (!assetId || !sale_price) {
        return res.status(400).json({
          success: false,
          message: "Asset ID and sale price are required",
        });
      }

      const result =
        await InventoryTransactionService.createAssetSaleTransaction(
          assetId,
          parseFloat(sale_price),
          userId,
          meta
        );

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create asset sale transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create expense transaction
   */
  async createExpenseTransaction(req, res) {
    try {
      const expenseData = req.body;
      const userId = req.user?.id;

      const result = await InventoryTransactionService.createExpenseTransaction(
        expenseData,
        userId
      );

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create expense transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransaction(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID is required",
        });
      }

      const result = await InventoryTransactionService.getTransactionById(id);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 404).json(result);
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve transaction",
        detail: error.detail,
      });
    }
  }

  /**
   * Get transactions with pagination
   */
  async getTransactions(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        currency,
        asset,
        loan,
        payment,
        account_code,
        created_from,
        created_to,
        occurred_from,
        occurred_to,
        min_amount,
        max_amount,
        search,
        sort_by = "occurred_at",
        sort_order = "desc",
      } = req.query;

      // Parse page and limit
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Validate pagination params
      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        });
      }

      // Build filters
      const filters = {
        type,
        currency,
        asset,
        loan,
        payment,
        account_code,
        created_from,
        created_to,
        occurred_from,
        occurred_to,
        min_amount,
        max_amount,
        search,
      };

      const pagination = {
        page: pageNum,
        limit: limitNum,
        sort_by,
        sort_order,
      };

      const result = await InventoryTransactionService.getTransactions(
        filters,
        pagination
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve transactions",
        detail: error.detail,
      });
    }
  }

  /**
   * Get all transactions without pagination
   */
  async getAllTransactions(req, res) {
    try {
      const { type, currency, created_from, created_to } = req.query;

      const filters = { type, currency, created_from, created_to };

      const result = await InventoryTransactionService.getAllTransactions(
        filters
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        count: result.count,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve all transactions",
        detail: error.detail,
      });
    }
  }

  /**
   * Update transaction
   */
  async updateTransaction(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID is required",
        });
      }

      const result = await InventoryTransactionService.updateTransaction(
        id,
        updateData,
        userId
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Delete transaction
   */
  async deleteTransaction(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Transaction ID is required",
        });
      }

      const result = await InventoryTransactionService.deleteTransaction(
        id,
        userId
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete transaction",
        detail: error.detail,
      });
    }
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(req, res) {
    try {
      const filters = {
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        type: req.query.type,
        currency: req.query.currency,
      };

      const result = await InventoryTransactionService.getTransactionStats(
        filters
      );

      res.status(200).json({
        success: true,
        message: "Transaction statistics retrieved successfully",
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve transaction statistics",
        detail: error.detail,
      });
    }
  }

  /**
   * Get financial report
   */
  async getFinancialReport(req, res) {
    try {
      const { report_type = "profit_loss" } = req.params;
      const { start_date, end_date, format = "json" } = req.query;

      if (!start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: "Start date and end date are required",
        });
      }

      const result = await InventoryTransactionService.getFinancialReport(
        report_type,
        start_date,
        end_date
      );

      // Return in different formats
      if (format === "csv") {
        const csv = this.convertReportToCSV(result.data);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=financial-report-${Date.now()}.csv`
        );
        return res.send(csv);
      }

      // Default JSON response
      res.status(200).json({
        success: true,
        message: "Financial report generated successfully",
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to generate financial report",
        detail: error.detail,
      });
    }
  }

  /**
   * Get transaction summary for dashboard
   */
  async getTransactionSummary(req, res) {
    try {
      // Get stats for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const filters = {
        created_from: thirtyDaysAgo.toISOString(),
        created_to: new Date().toISOString(),
      };

      const statsResult = await InventoryTransactionService.getTransactionStats(
        filters
      );
      const stats = statsResult.data;

      // Get recent transactions
      const recentResult = await InventoryTransactionService.getTransactions(
        { created_from: thirtyDaysAgo.toISOString() },
        { page: 1, limit: 10 }
      );

      // Calculate daily averages
      const dailyIncome = stats.summary.total_positive / 30;
      const dailyExpenses = Math.abs(stats.summary.total_negative) / 30;

      res.status(200).json({
        success: true,
        message: "Transaction summary retrieved successfully",
        data: {
          period: "last_30_days",
          summary: {
            total_transactions: stats.summary.total_count,
            total_income: stats.summary.total_positive,
            total_expenses: Math.abs(stats.summary.total_negative),
            net_cash_flow: stats.net_cash_flow,
            daily_avg_income: dailyIncome,
            daily_avg_expenses: dailyExpenses,
            profit_margin:
              stats.summary.total_positive > 0
                ? (
                    (stats.net_cash_flow / stats.summary.total_positive) *
                    100
                  ).toFixed(2) + "%"
                : "0%",
          },
          top_income_sources: stats.income_types.slice(0, 5),
          top_expense_categories: stats.expense_types.slice(0, 5),
          recent_transactions: recentResult.data.transactions,
          daily_trends: stats.daily_trends,
        },
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve transaction summary",
        detail: error.message,
      });
    }
  }

  /**
   * Export transactions
   */
  async exportTransactions(req, res) {
    try {
      const {
        created_from,
        created_to,
        type,
        currency,
        format = "csv",
      } = req.query;

      const filters = {
        created_from,
        created_to,
        type,
        currency,
      };

      const result = await InventoryTransactionService.getAllTransactions(
        filters
      );

      if (format === "csv") {
        const csv = this.convertTransactionsToCSV(result.data);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=transactions-export-${Date.now()}.csv`
        );
        return res.send(csv);
      }

      // JSON export
      res.status(200).json({
        success: true,
        message: "Transactions exported successfully",
        data: result.data,
        count: result.count,
        filters,
        exported_at: new Date(),
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to export transactions",
        detail: error.detail,
      });
    }
  }

  /**
   * Helper: Convert transactions to CSV
   */
  convertTransactionsToCSV(transactions) {
    if (!transactions || transactions.length === 0) {
      return "No transactions available";
    }

    const headers = [
      "Transaction No",
      "Date",
      "Type",
      "Amount",
      "Currency",
      "Account Code",
      "Notes",
      "Related Asset",
      "Related Loan",
      "Related Payment",
      "Created By",
    ];

    const rows = transactions.map((tx) => [
      tx.tx_no || "",
      tx.occurred_at ? new Date(tx.occurred_at).toLocaleDateString() : "",
      tx.type_label || tx.type || "",
      tx.amount || 0,
      tx.currency || "USD",
      tx.account_code || "",
      tx.notes || "",
      tx.asset ? `${tx.asset.asset_no} - ${tx.asset.title}` : "",
      tx.loan ? tx.loan.loan_no : "",
      tx.payment ? tx.payment.receipt_no : "",
      tx.created_by
        ? `${tx.created_by.first_name} ${tx.created_by.last_name}`
        : "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }

  /**
   * Helper: Convert report to CSV
   */
  convertReportToCSV(reportData) {
    const headers = ["Category", "Amount", "Percentage", "Details"];

    const rows = [
      ["Total Income", reportData.profit_loss.income, "100%", ""],
      [
        "Total Expenses",
        reportData.profit_loss.expenses,
        (
          (reportData.profit_loss.expenses / reportData.profit_loss.income) *
          100
        ).toFixed(2) + "%",
        "",
      ],
      [
        "Net Profit",
        reportData.profit_loss.net_profit,
        reportData.profit_loss.margin_percentage + "%",
        "",
      ],
      ["", "", "", ""],
      ["Cash Flow", "", "", ""],
      ["Operating Activities", reportData.cash_flow.operating, "", ""],
      ["Investing Activities", reportData.cash_flow.investing, "", ""],
      ["Financing Activities", reportData.cash_flow.financing, "", ""],
      ["Net Cash Flow", reportData.cash_flow.net_cash_flow, "", ""],
    ];

    const csvContent = [
      `Financial Report - ${reportData.report_type}`,
      `Period: ${new Date(
        reportData.period.start_date
      ).toLocaleDateString()} to ${new Date(
        reportData.period.end_date
      ).toLocaleDateString()}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }
}

module.exports = new InventoryTransactionController();
