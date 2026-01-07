const InventoryTransaction = require("../models/inventoryTransaction.model");
const Loan = require("../models/loan.model");
const Asset = require("../models/asset.model");
const Payment = require("../models/payment.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * Inventory Transaction Service
 * Handles all financial transactions tracking for the pawn shop
 */
class InventoryTransactionService {
  /**
   * Generate unique transaction number
   */
  static async generateTransactionNumber(prefix = "TXN") {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");

    // Get today's count for sequential numbering
    const todayStart = new Date(date.setHours(0, 0, 0, 0));
    const tomorrowStart = new Date(date.setDate(date.getDate() + 1));

    const countToday = await InventoryTransaction.countDocuments({
      created_at: { $gte: todayStart, $lt: tomorrowStart },
    });

    const sequential = (countToday + 1).toString().padStart(4, "0");
    return `${prefix}${year}${month}${day}${sequential}`;
  }

  /**
   * Create a new inventory transaction
   */
  async createTransaction(transactionData, userId) {
    try {
      const {
        type,
        amount,
        currency = "USD",
        asset,
        loan,
        payment,
        account_code,
        notes,
        occurred_at = new Date(),
        meta = {},
      } = transactionData;

      // Validate required fields
      if (!type || !amount) {
        throw this.handleError(400, "Transaction type and amount are required");
      }

      if (amount <= 0) {
        throw this.handleError(
          400,
          "Transaction amount must be greater than 0"
        );
      }

      // Validate transaction type
      const validTypes = [
        "loan_disbursement",
        "repayment",
        "interest_income",
        "storage_income",
        "penalty_income",
        "asset_sale",
        "asset_purchase",
        "expense",
        "adjustment",
      ];

      if (!validTypes.includes(type)) {
        throw this.handleError(400, "Invalid transaction type");
      }

      // Generate transaction number
      const tx_no =
        await InventoryTransactionService.generateTransactionNumber();

      // Create transaction
      const transaction = new InventoryTransaction({
        tx_no,
        type,
        amount,
        currency,
        asset,
        loan,
        payment,
        account_code,
        notes,
        occurred_at: new Date(occurred_at),
        created_by: userId,
        meta,
      });

      await transaction.save();

      // Populate related data
      const populatedTransaction = await this.populateTransaction(
        transaction._id
      );

      return {
        success: true,
        data: populatedTransaction,
        message: "Transaction created successfully",
      };
    } catch (error) {
      console.error("Create transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create transaction for loan disbursement
   */
  async createLoanDisbursementTransaction(loanId, userId) {
    try {
      const loan = await Loan.findById(loanId)
        .populate("customer_user", "first_name last_name email")
        .populate("asset", "asset_no title");

      if (!loan) {
        throw this.handleError(404, `Loan with ID ${loanId} not found`);
      }

      if (loan.status !== "active") {
        throw this.handleError(400, "Only active loans can be disbursed");
      }

      // Check if disbursement transaction already exists
      const existingDisbursement = await InventoryTransaction.findOne({
        type: "loan_disbursement",
        loan: loanId,
      });

      if (existingDisbursement) {
        throw this.handleError(
          400,
          "Disbursement transaction already exists for this loan"
        );
      }

      const transactionData = {
        type: "loan_disbursement",
        amount: -loan.principal_amount, // Negative for cash outflow
        currency: loan.currency,
        asset: loan.asset,
        loan: loanId,
        account_code: "1100", // Example: Cash/Loan Disbursement
        notes: `Loan disbursement for ${loan.loan_no} - ${loan.customer_user.first_name} ${loan.customer_user.last_name}`,
        meta: {
          loan_no: loan.loan_no,
          customer_name: `${loan.customer_user.first_name} ${loan.customer_user.last_name}`,
          customer_email: loan.customer_user.email,
          asset_no: loan.asset?.asset_no,
          asset_title: loan.asset?.title,
        },
      };

      const result = await this.createTransaction(transactionData, userId);

      // Update loan with disbursement date if not set
      if (!loan.disbursed_at) {
        loan.disbursed_at = new Date();
        await loan.save();
      }

      return result;
    } catch (error) {
      console.error("Create loan disbursement transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create transaction for loan repayment
   */
  async createRepaymentTransaction(paymentId, userId) {
    try {
      const payment = await Payment.findById(paymentId).populate({
        path: "loan",
        populate: {
          path: "customer_user",
          select: "first_name last_name email",
        },
      });

      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      if (payment.payment_status !== "paid") {
        throw this.handleError(
          400,
          "Only paid payments can create repayment transactions"
        );
      }

      const loan = payment.loan;
      if (!loan) {
        throw this.handleError(404, "Associated loan not found");
      }

      // Create separate transactions for each component
      const transactions = [];

      // Principal repayment (positive inflow)
      if (payment.principal_component > 0) {
        const principalTx = {
          type: "repayment",
          amount: payment.principal_component,
          currency: payment.currency,
          loan: loan._id,
          payment: paymentId,
          account_code: "1200", // Principal Repayment
          notes: `Principal repayment for loan ${loan.loan_no}`,
          meta: {
            loan_no: loan.loan_no,
            payment_receipt: payment.receipt_no,
            component: "principal",
          },
        };
        transactions.push(principalTx);
      }

      // Interest income (positive inflow)
      if (payment.interest_component > 0) {
        const interestTx = {
          type: "interest_income",
          amount: payment.interest_component,
          currency: payment.currency,
          loan: loan._id,
          payment: paymentId,
          account_code: "2100", // Interest Income
          notes: `Interest income from loan ${loan.loan_no}`,
          meta: {
            loan_no: loan.loan_no,
            payment_receipt: payment.receipt_no,
            component: "interest",
          },
        };
        transactions.push(interestTx);
      }

      // Storage income (positive inflow)
      if (payment.storage_component > 0) {
        const storageTx = {
          type: "storage_income",
          amount: payment.storage_component,
          currency: payment.currency,
          loan: loan._id,
          payment: paymentId,
          account_code: "2200", // Storage Income
          notes: `Storage charges from loan ${loan.loan_no}`,
          meta: {
            loan_no: loan.loan_no,
            payment_receipt: payment.receipt_no,
            component: "storage",
          },
        };
        transactions.push(storageTx);
      }

      // Penalty income (positive inflow)
      if (payment.penalty_component > 0) {
        const penaltyTx = {
          type: "penalty_income",
          amount: payment.penalty_component,
          currency: payment.currency,
          loan: loan._id,
          payment: paymentId,
          account_code: "2300", // Penalty Income
          notes: `Penalty charges from loan ${loan.loan_no}`,
          meta: {
            loan_no: loan.loan_no,
            payment_receipt: payment.receipt_no,
            component: "penalty",
          },
        };
        transactions.push(penaltyTx);
      }

      // Create all transactions
      const createdTransactions = [];
      for (const txData of transactions) {
        const result = await this.createTransaction(txData, userId);
        createdTransactions.push(result.data);
      }

      return {
        success: true,
        data: createdTransactions,
        message: "Repayment transactions created successfully",
      };
    } catch (error) {
      console.error("Create repayment transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create transaction for asset sale
   */
  async createAssetSaleTransaction(assetId, salePrice, userId, meta = {}) {
    try {
      const asset = await Asset.findById(assetId).populate(
        "owner_user",
        "first_name last_name email"
      );

      if (!asset) {
        throw this.handleError(404, `Asset with ID ${assetId} not found`);
      }

      if (asset.status !== "sold") {
        throw this.handleError(
          400,
          "Only sold assets can have sale transactions"
        );
      }

      // Check if sale transaction already exists
      const existingSale = await InventoryTransaction.findOne({
        type: "asset_sale",
        asset: assetId,
      });

      if (existingSale) {
        throw this.handleError(
          400,
          "Sale transaction already exists for this asset"
        );
      }

      const transactionData = {
        type: "asset_sale",
        amount: salePrice,
        currency: "USD",
        asset: assetId,
        account_code: "3100", // Asset Sale Income
        notes: `Sale of asset ${asset.asset_no} - ${asset.title}`,
        meta: {
          ...meta,
          asset_no: asset.asset_no,
          asset_title: asset.title,
          category: asset.category,
          evaluated_value: asset.evaluated_value,
          customer_name: asset.owner_user
            ? `${asset.owner_user.first_name} ${asset.owner_user.last_name}`
            : "N/A",
        },
      };

      return await this.createTransaction(transactionData, userId);
    } catch (error) {
      console.error("Create asset sale transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create expense transaction
   */
  async createExpenseTransaction(expenseData, userId) {
    try {
      const {
        amount,
        currency,
        category,
        description,
        notes,
        meta = {},
      } = expenseData;

      if (!amount || !category || !description) {
        throw this.handleError(
          400,
          "Amount, category, and description are required for expenses"
        );
      }

      if (amount <= 0) {
        throw this.handleError(400, "Expense amount must be greater than 0");
      }

      // Map category to account code
      const accountCodes = {
        rent: "4100",
        utilities: "4200",
        salaries: "4300",
        maintenance: "4400",
        marketing: "4500",
        insurance: "4600",
        other: "4700",
      };

      const account_code = accountCodes[category] || "4700";

      const transactionData = {
        type: "expense",
        amount: -amount, // Negative for outflow
        currency: currency || "USD",
        account_code,
        notes: `${category.toUpperCase()}: ${description}. ${notes || ""}`,
        meta: {
          ...meta,
          expense_category: category,
          expense_description: description,
        },
      };

      return await this.createTransaction(transactionData, userId);
    } catch (error) {
      console.error("Create expense transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(transactionId) {
    try {
      const transaction = await this.populateTransaction(transactionId);

      if (!transaction) {
        throw this.handleError(
          404,
          `Transaction with ID ${transactionId} not found`
        );
      }

      return {
        success: true,
        data: transaction,
        message: "Transaction retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get transactions with pagination and filters
   */
  async getTransactions(filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "occurred_at",
        sort_order = "desc",
      } = pagination;

      const {
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
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (type) query.type = type;
      if (currency) query.currency = currency;
      if (asset) query.asset = asset;
      if (loan) query.loan = loan;
      if (payment) query.payment = payment;
      if (account_code) query.account_code = account_code;

      // Amount filters
      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

      // Date filters
      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      if (occurred_from || occurred_to) {
        query.occurred_at = {};
        if (occurred_from) query.occurred_at.$gte = new Date(occurred_from);
        if (occurred_to) query.occurred_at.$lte = new Date(occurred_to);
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [
          { tx_no: { $regex: search, $options: "i" } },
          { notes: { $regex: search, $options: "i" } },
          { account_code: { $regex: search, $options: "i" } },
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [transactions, total] = await Promise.all([
        InventoryTransaction.find(query)
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        InventoryTransaction.countDocuments(query),
      ]);

      // Populate transactions
      const populatedTransactions = await Promise.all(
        transactions.map((tx) => this.populateTransaction(tx._id))
      );

      return {
        success: true,
        data: {
          transactions: populatedTransactions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get transactions error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all transactions without pagination
   */
  async getAllTransactions(filters = {}) {
    try {
      const { type, currency, created_from, created_to } = filters;

      let query = {};

      if (type) query.type = type;
      if (currency) query.currency = currency;

      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      const transactions = await InventoryTransaction.find(query)
        .sort({ occurred_at: -1 })
        .lean();

      const populatedTransactions = await Promise.all(
        transactions.map((tx) => this.populateTransaction(tx._id))
      );

      return {
        success: true,
        data: populatedTransactions,
        count: populatedTransactions.length,
      };
    } catch (error) {
      console.error("Get all transactions error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update transaction
   */
  async updateTransaction(transactionId, updateData, userId) {
    try {
      const transaction = await InventoryTransaction.findById(transactionId);

      if (!transaction) {
        throw this.handleError(
          404,
          `Transaction with ID ${transactionId} not found`
        );
      }

      // Prevent updating certain fields for certain transaction types
      if (
        ["loan_disbursement", "repayment", "asset_sale"].includes(
          transaction.type
        )
      ) {
        const restrictedFields = ["type", "amount", "asset", "loan", "payment"];
        for (const field of restrictedFields) {
          if (
            updateData[field] !== undefined &&
            updateData[field] !== transaction[field]
          ) {
            throw this.handleError(
              400,
              `Cannot update ${field} for ${transaction.type} transaction`
            );
          }
        }
      }

      // Update transaction
      Object.assign(transaction, updateData);
      transaction.updated_at = new Date();

      // Add audit trail to meta
      transaction.meta = {
        ...transaction.meta,
        updated_by: userId,
        updated_at: new Date(),
        update_notes: updateData.update_notes || "Transaction updated",
      };

      await transaction.save();

      const populatedTransaction = await this.populateTransaction(
        transaction._id
      );

      return {
        success: true,
        data: populatedTransaction,
        message: "Transaction updated successfully",
      };
    } catch (error) {
      console.error("Update transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete transaction
   */
  async deleteTransaction(transactionId, userId) {
    try {
      const transaction = await InventoryTransaction.findById(transactionId);

      if (!transaction) {
        throw this.handleError(
          404,
          `Transaction with ID ${transactionId} not found`
        );
      }

      // Prevent deletion of certain transaction types
      const nonDeletableTypes = [
        "loan_disbursement",
        "repayment",
        "asset_sale",
      ];
      if (nonDeletableTypes.includes(transaction.type)) {
        throw this.handleError(
          400,
          `Cannot delete ${transaction.type} transaction`
        );
      }

      // Log deletion in audit trail (optional)
      console.log(`Transaction ${transactionId} deleted by user ${userId}`);

      await InventoryTransaction.findByIdAndDelete(transactionId);

      return {
        success: true,
        message: "Transaction deleted successfully",
      };
    } catch (error) {
      console.error("Delete transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get transaction statistics
   */
  async getTransactionStats(filters = {}) {
    try {
      let query = {};

      // Apply filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      if (filters.type) query.type = filters.type;
      if (filters.currency) query.currency = filters.currency;

      // Get total counts and amounts
      const totalStats = await InventoryTransaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total_count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            total_positive: {
              $sum: {
                $cond: [{ $gt: ["$amount", 0] }, "$amount", 0],
              },
            },
            total_negative: {
              $sum: {
                $cond: [{ $lt: ["$amount", 0] }, "$amount", 0],
              },
            },
          },
        },
      ]);

      // Get stats by type
      const typeStats = await InventoryTransaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_amount: { $avg: "$amount" },
          },
        },
        { $sort: { total_amount: -1 } },
      ]);

      // Get stats by currency
      const currencyStats = await InventoryTransaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$currency",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
          },
        },
      ]);

      // Get daily totals for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyStats = await InventoryTransaction.aggregate([
        {
          $match: {
            ...query,
            occurred_at: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$occurred_at" },
              month: { $month: "$occurred_at" },
              day: { $dayOfMonth: "$occurred_at" },
            },
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            date: { $first: "$occurred_at" },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        { $limit: 30 },
      ]);

      // Format daily stats
      const formattedDailyStats = dailyStats.map((stat) => ({
        date: new Date(stat.date).toISOString().split("T")[0],
        count: stat.count,
        total_amount: stat.total_amount,
      }));

      // Get top transactions
      const topTransactions = await InventoryTransaction.find(query)
        .sort({ amount: -1 })
        .limit(10)
        .lean();

      const populatedTopTransactions = await Promise.all(
        topTransactions.map((tx) => this.populateTransaction(tx._id))
      );

      // Calculate net cash flow
      const netCashFlow = totalStats[0] ? totalStats[0].total_amount : 0;

      // Get today's transactions
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysTransactions = await InventoryTransaction.countDocuments({
        ...query,
        occurred_at: { $gte: today, $lt: tomorrow },
      });

      return {
        success: true,
        data: {
          summary: totalStats[0] || {
            total_count: 0,
            total_amount: 0,
            total_positive: 0,
            total_negative: 0,
          },
          by_type: typeStats,
          by_currency: currencyStats,
          daily_trends: formattedDailyStats,
          top_transactions: populatedTopTransactions,
          net_cash_flow: netCashFlow,
          todays_transactions: todaysTransactions,
          income_types: typeStats.filter((t) => t.total_amount > 0),
          expense_types: typeStats.filter((t) => t.total_amount < 0),
        },
      };
    } catch (error) {
      console.error("Get transaction stats error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get financial report (Profit & Loss, Cash Flow)
   */
  async getFinancialReport(reportType, startDate, endDate) {
    try {
      const query = {
        occurred_at: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      const transactions = await InventoryTransaction.find(query)
        .sort({ occurred_at: 1 })
        .lean();

      // Categorize transactions
      const categorized = {
        income: [],
        expenses: [],
        assets: [],
        liabilities: [],
      };

      transactions.forEach((tx) => {
        if (tx.amount > 0) {
          // Positive amounts are income
          categorized.income.push(tx);
        } else {
          // Negative amounts are expenses
          categorized.expenses.push(tx);
        }

        // Additional categorization by type
        if (tx.type.includes("income")) {
          categorized.income.push(tx);
        } else if (
          tx.type.includes("expense") ||
          tx.type === "loan_disbursement"
        ) {
          categorized.expenses.push(tx);
        }
      });

      // Calculate totals
      const totals = {
        total_income: categorized.income.reduce(
          (sum, tx) => sum + tx.amount,
          0
        ),
        total_expenses: categorized.expenses.reduce(
          (sum, tx) => sum + tx.amount,
          0
        ),
        net_profit: 0,
      };

      totals.net_profit = totals.total_income + totals.total_expenses; // Expenses are negative

      // Group by type for detailed breakdown
      const incomeByType = {};
      const expensesByType = {};

      transactions.forEach((tx) => {
        if (tx.amount > 0) {
          if (!incomeByType[tx.type]) {
            incomeByType[tx.type] = { total: 0, count: 0 };
          }
          incomeByType[tx.type].total += tx.amount;
          incomeByType[tx.type].count += 1;
        } else {
          if (!expensesByType[tx.type]) {
            expensesByType[tx.type] = { total: 0, count: 0 };
          }
          expensesByType[tx.type].total += tx.amount;
          expensesByType[tx.type].count += 1;
        }
      });

      // Cash flow statement
      const cashFlow = {
        operating_activities: transactions.filter((tx) =>
          [
            "repayment",
            "interest_income",
            "storage_income",
            "penalty_income",
            "expense",
          ].includes(tx.type)
        ),
        investing_activities: transactions.filter((tx) =>
          ["asset_sale", "asset_purchase"].includes(tx.type)
        ),
        financing_activities: transactions.filter((tx) =>
          ["loan_disbursement", "adjustment"].includes(tx.type)
        ),
      };

      // Calculate cash flow totals
      const cashFlowTotals = {
        operating: cashFlow.operating_activities.reduce(
          (sum, tx) => sum + tx.amount,
          0
        ),
        investing: cashFlow.investing_activities.reduce(
          (sum, tx) => sum + tx.amount,
          0
        ),
        financing: cashFlow.financing_activities.reduce(
          (sum, tx) => sum + tx.amount,
          0
        ),
      };

      cashFlowTotals.net_cash_flow =
        cashFlowTotals.operating +
        cashFlowTotals.investing +
        cashFlowTotals.financing;

      return {
        success: true,
        data: {
          report_type: reportType,
          period: {
            start_date: new Date(startDate),
            end_date: new Date(endDate),
          },
          profit_loss: {
            income: totals.total_income,
            expenses: Math.abs(totals.total_expenses), // Convert to positive for display
            net_profit: totals.net_profit,
            margin_percentage:
              totals.total_income > 0
                ? ((totals.net_profit / totals.total_income) * 100).toFixed(2)
                : 0,
          },
          breakdown: {
            income_by_type: incomeByType,
            expenses_by_type: expensesByType,
          },
          cash_flow: {
            ...cashFlowTotals,
            activities: cashFlow,
          },
          transactions_count: transactions.length,
          generated_at: new Date(),
        },
      };
    } catch (error) {
      console.error("Get financial report error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Populate transaction with related data
   */
  async populateTransaction(transactionId) {
    try {
      const transaction = await InventoryTransaction.findById(transactionId)
        .populate({
          path: "asset",
          select: "asset_no title category status evaluated_value",
          populate: {
            path: "owner_user",
            select: "first_name last_name email",
          },
        })
        .populate({
          path: "loan",
          select: "loan_no principal_amount currency status",
          populate: {
            path: "customer_user",
            select: "first_name last_name email",
          },
        })
        .populate({
          path: "payment",
          select: "receipt_no amount currency payment_status",
        })
        .populate({
          path: "created_by",
          select: "first_name last_name email roles",
        })
        .lean();

      if (!transaction) return null;

      // Format the transaction for response
      return {
        ...transaction,
        formatted_amount: transaction.amount.toLocaleString("en-US", {
          style: "currency",
          currency: transaction.currency || "USD",
          minimumFractionDigits: 2,
        }),
        is_income: transaction.amount > 0,
        is_expense: transaction.amount < 0,
        type_label: this.getTypeLabel(transaction.type),
      };
    } catch (error) {
      console.error("Populate transaction error:", error);
      return null;
    }
  }

  /**
   * Get type label for display
   */
  getTypeLabel(type) {
    const labels = {
      loan_disbursement: "Loan Disbursement",
      repayment: "Loan Repayment",
      interest_income: "Interest Income",
      storage_income: "Storage Income",
      penalty_income: "Penalty Income",
      asset_sale: "Asset Sale",
      asset_purchase: "Asset Purchase",
      expense: "Expense",
      adjustment: "Adjustment",
    };
    return labels[type] || type;
  }

  /**
   * Handle custom errors
   */
  handleError(status, message) {
    return {
      status,
      message,
      timestamp: new Date(),
    };
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Inventory Transaction Service Error:", error);

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

module.exports = new InventoryTransactionService();
