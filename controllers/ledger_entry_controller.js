const LedgerEntryService = require("../services/ledger_entry_service");

/**
 * Ledger Entry Controller
 * Handles HTTP requests and responses for accounting ledger entries
 */
class LedgerEntryController {
  /**
   * Create a new ledger entry
   */
  async createLedgerEntry(req, res) {
    try {
      const ledgerData = req.body;
      const userId = req.user?.id;

      const result = await LedgerEntryService.createLedgerEntry(
        ledgerData,
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
        message: error.message || "Failed to create ledger entry",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create ledger entry from inventory transaction
   */
  async createLedgerEntryFromInventoryTransaction(req, res) {
    try {
      const { inventoryTxnId } = req.params;
      const userId = req.user?.id;

      if (!inventoryTxnId) {
        return res.status(400).json({
          success: false,
          message: "Inventory transaction ID is required",
        });
      }

      const result =
        await LedgerEntryService.createLedgerEntryFromInventoryTransaction(
          inventoryTxnId,
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
          error.message ||
          "Failed to create ledger entry from inventory transaction",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Create ledger entries for payment
   */
  async createLedgerEntryForPayment(req, res) {
    try {
      const { paymentId } = req.params;
      const userId = req.user?.id;

      if (!paymentId) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await LedgerEntryService.createLedgerEntryForPayment(
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
        message: error.message || "Failed to create ledger entries for payment",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Get ledger entry by ID
   */
  async getLedgerEntry(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ledger entry ID is required",
        });
      }

      const result = await LedgerEntryService.getLedgerEntryById(id);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 404).json(result);
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve ledger entry",
        detail: error.detail,
      });
    }
  }

  /**
   * Get ledger entries with pagination
   */
  async getLedgerEntries(req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        category,
        currency,
        branch_code,
        created_from,
        created_to,
        entry_from,
        entry_to,
        min_amount,
        max_amount,
        loan_id,
        asset_id,
        payment_id,
        inventory_txn_id,
        search,
        sort_by = "entry_date",
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
        category,
        currency,
        branch_code,
        created_from,
        created_to,
        entry_from,
        entry_to,
        min_amount,
        max_amount,
        loan_id,
        asset_id,
        payment_id,
        inventory_txn_id,
        search,
      };

      const pagination = {
        page: pageNum,
        limit: limitNum,
        sort_by,
        sort_order,
      };

      const result = await LedgerEntryService.getLedgerEntries(
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
        message: error.message || "Failed to retrieve ledger entries",
        detail: error.detail,
      });
    }
  }

  /**
   * Get all ledger entries without pagination
   */
  async getAllLedgerEntries(req, res) {
    try {
      const { category, currency, branch_code, created_from, created_to } =
        req.query;

      const filters = {
        category,
        currency,
        branch_code,
        created_from,
        created_to,
      };

      const result = await LedgerEntryService.getAllLedgerEntries(filters);

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
        message: error.message || "Failed to retrieve all ledger entries",
        detail: error.detail,
      });
    }
  }

  /**
   * Update ledger entry
   */
  async updateLedgerEntry(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ledger entry ID is required",
        });
      }

      const result = await LedgerEntryService.updateLedgerEntry(
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
        message: error.message || "Failed to update ledger entry",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Delete ledger entry
   */
  async deleteLedgerEntry(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Ledger entry ID is required",
        });
      }

      const result = await LedgerEntryService.deleteLedgerEntry(id, userId);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete ledger entry",
        detail: error.detail,
      });
    }
  }

  /**
   * Get ledger summary
   */
  async getLedgerSummary(req, res) {
    try {
      const filters = {
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        entry_from: req.query.entry_from,
        entry_to: req.query.entry_to,
        category: req.query.category,
        currency: req.query.currency,
        branch_code: req.query.branch_code,
      };

      const result = await LedgerEntryService.getLedgerSummary(filters);

      res.status(200).json({
        success: true,
        message: "Ledger summary retrieved successfully",
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve ledger summary",
        detail: error.detail,
      });
    }
  }

  /**
   * Get trial balance
   */
  async getTrialBalance(req, res) {
    try {
      const { start_date, end_date, format = "json" } = req.query;

      if (!start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: "Start date and end date are required",
        });
      }

      const result = await LedgerEntryService.getTrialBalance(
        start_date,
        end_date
      );

      if (format === "csv") {
        const csv = this.convertTrialBalanceToCSV(result.data);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=trial-balance-${Date.now()}.csv`
        );
        return res.send(csv);
      }

      res.status(200).json({
        success: true,
        message: "Trial balance generated successfully",
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to generate trial balance",
        detail: error.detail,
      });
    }
  }

  /**
   * Get profit and loss statement
   */
  async getProfitAndLoss(req, res) {
    try {
      const { start_date, end_date, format = "json" } = req.query;

      if (!start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: "Start date and end date are required",
        });
      }

      const result = await LedgerEntryService.getProfitAndLoss(
        start_date,
        end_date
      );

      if (format === "csv") {
        const csv = this.convertProfitAndLossToCSV(result.data);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=profit-loss-${Date.now()}.csv`
        );
        return res.send(csv);
      }

      res.status(200).json({
        success: true,
        message: "Profit and loss statement generated successfully",
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message:
          error.message || "Failed to generate profit and loss statement",
        detail: error.detail,
      });
    }
  }

  /**
   * Get ledger summary for dashboard
   */
  async getLedgerDashboardSummary(req, res) {
    try {
      // Get stats for last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const filters = {
        entry_from: thirtyDaysAgo.toISOString(),
        entry_to: new Date().toISOString(),
      };

      const statsResult = await LedgerEntryService.getLedgerSummary(filters);
      const stats = statsResult.data;

      // Get recent entries
      const recentResult = await LedgerEntryService.getLedgerEntries(
        { entry_from: thirtyDaysAgo.toISOString() },
        { page: 1, limit: 10 }
      );

      // Calculate metrics
      const averageDailyIncome = stats.summary.total_income / 30;
      const averageDailyExpenses = Math.abs(stats.summary.total_expenses) / 30;

      res.status(200).json({
        success: true,
        message: "Ledger dashboard summary retrieved successfully",
        data: {
          period: "last_30_days",
          summary: {
            total_entries: stats.summary.total_count,
            total_income: stats.summary.total_income,
            total_expenses: Math.abs(stats.summary.total_expenses),
            net_balance: stats.net_balance,
            average_daily_income: averageDailyIncome,
            average_daily_expenses: averageDailyExpenses,
            profit_margin:
              stats.summary.total_income > 0
                ? (
                    (stats.net_balance / stats.summary.total_income) *
                    100
                  ).toFixed(2) + "%"
                : "0%",
          },
          top_income_categories: stats.income_categories.slice(0, 5),
          top_expense_categories: stats.expense_categories.slice(0, 5),
          recent_entries: recentResult.data.entries,
          daily_trends: stats.daily_trends,
        },
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve ledger dashboard summary",
        detail: error.message,
      });
    }
  }

  /**
   * Export ledger entries
   */
  async exportLedgerEntries(req, res) {
    try {
      const {
        created_from,
        created_to,
        category,
        currency,
        branch_code,
        format = "csv",
      } = req.query;

      const filters = {
        created_from,
        created_to,
        category,
        currency,
        branch_code,
      };

      const result = await LedgerEntryService.getAllLedgerEntries(filters);

      if (format === "csv") {
        const csv = this.convertLedgerEntriesToCSV(result.data);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=ledger-entries-export-${Date.now()}.csv`
        );
        return res.send(csv);
      }

      // JSON export
      res.status(200).json({
        success: true,
        message: "Ledger entries exported successfully",
        data: result.data,
        count: result.count,
        filters,
        exported_at: new Date(),
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to export ledger entries",
        detail: error.detail,
      });
    }
  }

  /**
   * Helper: Convert ledger entries to CSV
   */
  convertLedgerEntriesToCSV(entries) {
    if (!entries || entries.length === 0) {
      return "No ledger entries available";
    }

    const headers = [
      "Entry Date",
      "Category",
      "Amount",
      "Currency",
      "Branch Code",
      "Memo",
      "Loan Reference",
      "Payment Reference",
      "Asset Reference",
      "Inventory Transaction Reference",
      "Created By",
      "Created At",
    ];

    const rows = entries.map((entry) => [
      new Date(entry.entry_date).toLocaleDateString(),
      entry.category_label || entry.category,
      entry.amount,
      entry.currency,
      entry.branch_code || "",
      entry.memo || "",
      entry.refs?.loan_id ? entry.refs.loan_id.loan_no : "",
      entry.refs?.payment_id ? entry.refs.payment_id.receipt_no : "",
      entry.refs?.asset_id
        ? `${entry.refs.asset_id.asset_no} - ${entry.refs.asset_id.title}`
        : "",
      entry.refs?.inventory_txn_id ? entry.refs.inventory_txn_id.tx_no : "",
      entry.created_by_user_id
        ? `${entry.created_by_user_id.first_name} ${entry.created_by_user_id.last_name}`
        : "",
      new Date(entry.created_at).toLocaleDateString(),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }

  /**
   * Helper: Convert trial balance to CSV
   */
  convertTrialBalanceToCSV(trialBalanceData) {
    const headers = ["Category", "Debit", "Credit", "Balance", "Count"];

    const rows = trialBalanceData.trial_balance.map((item) => [
      item.category,
      item.debit,
      item.credit,
      item.balance,
      item.count,
    ]);

    // Add totals row
    rows.push([
      "TOTAL",
      trialBalanceData.totals.debit,
      trialBalanceData.totals.credit,
      trialBalanceData.totals.balance,
      trialBalanceData.totals.count,
    ]);

    const csvContent = [
      `Trial Balance - ${new Date(
        trialBalanceData.period.start_date
      ).toLocaleDateString()} to ${new Date(
        trialBalanceData.period.end_date
      ).toLocaleDateString()}`,
      `Balanced: ${trialBalanceData.is_balanced ? "Yes" : "No"}`,
      "",
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }

  /**
   * Helper: Convert profit and loss to CSV
   */
  convertProfitAndLossToCSV(pnlData) {
    const sections = [
      ["REVENUE", "Amount"],
      ...pnlData.sections.revenue.map((item) => [item.category, item.amount]),
      ["", ""],
      ["Total Revenue", pnlData.totals.total_revenue],
      ["", ""],
      ["COST OF GOODS SOLD", ""],
      ...pnlData.sections.cost_of_goods_sold.map((item) => [
        item.category,
        item.amount,
      ]),
      ["", ""],
      ["Total COGS", pnlData.totals.total_cogs],
      ["", ""],
      ["Gross Profit", pnlData.profit_metrics.gross_profit],
      ["Gross Margin", pnlData.profit_metrics.gross_margin],
      ["", ""],
      ["OPERATING EXPENSES", ""],
      ...pnlData.sections.operating_expenses.map((item) => [
        item.category,
        item.amount,
      ]),
      ["", ""],
      ["Total Operating Expenses", pnlData.totals.total_operating_expenses],
      ["", ""],
      ["Operating Profit", pnlData.profit_metrics.operating_profit],
      ["Operating Margin", pnlData.profit_metrics.operating_margin],
      ["", ""],
      ["OTHER INCOME", ""],
      ...pnlData.sections.other_income.map((item) => [
        item.category,
        item.amount,
      ]),
      ["", ""],
      ["Total Other Income", pnlData.totals.total_other_income],
      ["", ""],
      ["OTHER EXPENSES", ""],
      ...pnlData.sections.other_expenses.map((item) => [
        item.category,
        item.amount,
      ]),
      ["", ""],
      ["Total Other Expenses", pnlData.totals.total_other_expenses],
      ["", ""],
      ["NET PROFIT", pnlData.profit_metrics.net_profit],
      ["Net Margin", pnlData.profit_metrics.net_margin],
    ];

    const csvContent = [
      `Profit and Loss Statement - ${new Date(
        pnlData.period.start_date
      ).toLocaleDateString()} to ${new Date(
        pnlData.period.end_date
      ).toLocaleDateString()}`,
      "",
      ...sections.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }
}

module.exports = new LedgerEntryController();
