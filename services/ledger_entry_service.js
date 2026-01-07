const LedgerEntry = require("../models/ledger-entry.model");
const InventoryTransaction = require("../models/inventoryTransaction.model");
const Loan = require("../models/loan.model");
const Asset = require("../models/asset.model");
const Payment = require("../models/payment.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * Ledger Entry Service
 * Handles accounting ledger entries for financial tracking and reporting
 */
class LedgerEntryService {
  /**
   * Create a new ledger entry
   */
  async createLedgerEntry(ledgerData, userId) {
    try {
      const {
        entry_date = new Date(),
        branch_code,
        category,
        amount,
        currency = "USD",
        refs = {},
        memo,
      } = ledgerData;

      // Validate required fields
      if (!category || !amount) {
        throw this.handleError(400, "Category and amount are required");
      }

      // Validate category
      const validCategories = [
        "interest_income",
        "storage_income",
        "penalty_income",
        "loan_disbursement",
        "loan_principal_repayment",
        "asset_sale_revenue",
        "asset_sale_cogs",
        "write_off",
        "adjustment",
        "other",
      ];

      if (!validCategories.includes(category)) {
        throw this.handleError(400, "Invalid ledger category");
      }

      // Validate amount sign based on category
      const incomeCategories = [
        "interest_income",
        "storage_income",
        "penalty_income",
        "asset_sale_revenue",
      ];

      const expenseCategories = [
        "loan_disbursement",
        "asset_sale_cogs",
        "write_off",
      ];

      // Income categories should have positive amounts
      if (incomeCategories.includes(category) && amount <= 0) {
        throw this.handleError(400, "Income categories must have positive amounts");
      }

      // Expense categories should have negative amounts
      if (expenseCategories.includes(category) && amount >= 0) {
        throw this.handleError(400, "Expense categories must have negative amounts");
      }

      // Validate references if provided
      if (refs.loan_id && !mongoose.Types.ObjectId.isValid(refs.loan_id)) {
        throw this.handleError(400, "Invalid loan ID format");
      }

      if (refs.payment_id && !mongoose.Types.ObjectId.isValid(refs.payment_id)) {
        throw this.handleError(400, "Invalid payment ID format");
      }

      if (refs.asset_id && !mongoose.Types.ObjectId.isValid(refs.asset_id)) {
        throw this.handleError(400, "Invalid asset ID format");
      }

      if (refs.inventory_txn_id && !mongoose.Types.ObjectId.isValid(refs.inventory_txn_id)) {
        throw this.handleError(400, "Invalid inventory transaction ID format");
      }

      // Create ledger entry
      const ledgerEntry = new LedgerEntry({
        entry_date: new Date(entry_date),
        branch_code,
        category,
        amount: parseFloat(amount),
        currency,
        refs,
        memo,
        created_by_user_id: userId,
      });

      await ledgerEntry.save();

      // Populate the entry with related data
      const populatedEntry = await this.populateLedgerEntry(ledgerEntry._id);

      return {
        success: true,
        data: populatedEntry,
        message: "Ledger entry created successfully"
      };
    } catch (error) {
      console.error("Create ledger entry error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create ledger entry from inventory transaction
   */
  async createLedgerEntryFromInventoryTransaction(inventoryTxnId, userId) {
    try {
      const inventoryTxn = await InventoryTransaction.findById(inventoryTxnId)
        .populate("loan", "loan_no principal_amount currency")
        .populate("asset", "asset_no title evaluated_value")
        .populate("payment", "receipt_no amount currency");

      if (!inventoryTxn) {
        throw this.handleError(404, `Inventory transaction with ID ${inventoryTxnId} not found`);
      }

      // Map inventory transaction type to ledger category
      const categoryMap = {
        "loan_disbursement": "loan_disbursement",
        "repayment": "loan_principal_repayment",
        "interest_income": "interest_income",
        "storage_income": "storage_income",
        "penalty_income": "penalty_income",
        "asset_sale": "asset_sale_revenue",
        "asset_purchase": "asset_sale_cogs",
        "expense": "other",
        "adjustment": "adjustment"
      };

      const category = categoryMap[inventoryTxn.type];
      if (!category) {
        throw this.handleError(400, `Cannot map inventory transaction type ${inventoryTxn.type} to ledger category`);
      }

      // For asset sale, we need to create two entries: revenue and COGS
      if (inventoryTxn.type === "asset_sale") {
        return await this.createAssetSaleLedgerEntries(inventoryTxn, userId);
      }

      // For other transactions, create single entry
      const ledgerData = {
        entry_date: inventoryTxn.occurred_at,
        category,
        amount: inventoryTxn.amount,
        currency: inventoryTxn.currency,
        refs: {
          loan_id: inventoryTxn.loan?._id,
          payment_id: inventoryTxn.payment?._id,
          asset_id: inventoryTxn.asset?._id,
          inventory_txn_id: inventoryTxn._id
        },
        memo: inventoryTxn.notes || `Ledger entry for ${inventoryTxn.type} - ${inventoryTxn.tx_no}`
      };

      const result = await this.createLedgerEntry(ledgerData, userId);

      // Update inventory transaction with ledger reference
      inventoryTxn.meta = {
        ...inventoryTxn.meta,
        ledger_entry_id: result.data._id,
        ledger_processed: true,
        ledger_processed_at: new Date()
      };
      await inventoryTxn.save();

      return result;
    } catch (error) {
      console.error("Create ledger from inventory transaction error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create ledger entries for asset sale (revenue and COGS)
   */
  async createAssetSaleLedgerEntries(inventoryTxn, userId) {
    try {
      const asset = inventoryTxn.asset;
      if (!asset) {
        throw this.handleError(400, "Asset sale transaction must have an associated asset");
      }

      // Create revenue entry (positive)
      const revenueEntry = {
        entry_date: inventoryTxn.occurred_at,
        category: "asset_sale_revenue",
        amount: inventoryTxn.amount,
        currency: inventoryTxn.currency,
        refs: {
          asset_id: asset._id,
          inventory_txn_id: inventoryTxn._id
        },
        memo: `Asset sale revenue for ${asset.asset_no} - ${asset.title}`
      };

      // Create COGS entry (negative)
      const cogsEntry = {
        entry_date: inventoryTxn.occurred_at,
        category: "asset_sale_cogs",
        amount: -asset.evaluated_value || -inventoryTxn.amount * 0.6, // Default to 60% of sale price if no evaluated value
        currency: inventoryTxn.currency,
        refs: {
          asset_id: asset._id,
          inventory_txn_id: inventoryTxn._id
        },
        memo: `Cost of goods sold for ${asset.asset_no} - ${asset.title}`
      };

      // Create both entries
      const [revenueResult, cogsResult] = await Promise.all([
        this.createLedgerEntry(revenueEntry, userId),
        this.createLedgerEntry(cogsEntry, userId)
      ]);

      // Update inventory transaction
      inventoryTxn.meta = {
        ...inventoryTxn.meta,
        ledger_entry_ids: [revenueResult.data._id, cogsResult.data._id],
        ledger_processed: true,
        ledger_processed_at: new Date()
      };
      await inventoryTxn.save();

      return {
        success: true,
        data: {
          revenue_entry: revenueResult.data,
          cogs_entry: cogsResult.data,
          gross_profit: revenueEntry.amount + cogsEntry.amount
        },
        message: "Asset sale ledger entries created successfully"
      };
    } catch (error) {
      console.error("Create asset sale ledger entries error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create ledger entry for loan payment
   */
  async createLedgerEntryForPayment(paymentId, userId) {
    try {
      const payment = await Payment.findById(paymentId)
        .populate({
          path: "loan",
          populate: {
            path: "customer_user",
            select: "first_name last_name email"
          }
        });

      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      if (payment.payment_status !== "paid") {
        throw this.handleError(400, "Only paid payments can create ledger entries");
      }

      const loan = payment.loan;
      if (!loan) {
        throw this.handleError(404, "Associated loan not found");
      }

      const entries = [];

      // Create separate ledger entries for each payment component
      if (payment.principal_component > 0) {
        const principalEntry = {
          entry_date: payment.paid_at,
          category: "loan_principal_repayment",
          amount: payment.principal_component,
          currency: payment.currency,
          refs: {
            loan_id: loan._id,
            payment_id: payment._id
          },
          memo: `Principal repayment for loan ${loan.loan_no}`
        };
        entries.push(principalEntry);
      }

      if (payment.interest_component > 0) {
        const interestEntry = {
          entry_date: payment.paid_at,
          category: "interest_income",
          amount: payment.interest_component,
          currency: payment.currency,
          refs: {
            loan_id: loan._id,
            payment_id: payment._id
          },
          memo: `Interest income from loan ${loan.loan_no}`
        };
        entries.push(interestEntry);
      }

      if (payment.storage_component > 0) {
        const storageEntry = {
          entry_date: payment.paid_at,
          category: "storage_income",
          amount: payment.storage_component,
          currency: payment.currency,
          refs: {
            loan_id: loan._id,
            payment_id: payment._id
          },
          memo: `Storage charges from loan ${loan.loan_no}`
        };
        entries.push(storageEntry);
      }

      if (payment.penalty_component > 0) {
        const penaltyEntry = {
          entry_date: payment.paid_at,
          category: "penalty_income",
          amount: payment.penalty_component,
          currency: payment.currency,
          refs: {
            loan_id: loan._id,
            payment_id: payment._id
          },
          memo: `Penalty income from loan ${loan.loan_no}`
        };
        entries.push(penaltyEntry);
      }

      // Create all ledger entries
      const createdEntries = [];
      for (const entryData of entries) {
        const result = await this.createLedgerEntry(entryData, userId);
        createdEntries.push(result.data);
      }

      // Update payment with ledger reference
      payment.meta = {
        ...payment.meta,
        ledger_entry_ids: createdEntries.map(entry => entry._id),
        ledger_processed: true,
        ledger_processed_at: new Date()
      };
      await payment.save();

      return {
        success: true,
        data: createdEntries,
        message: "Payment ledger entries created successfully"
      };
    } catch (error) {
      console.error("Create ledger for payment error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get ledger entry by ID
   */
  async getLedgerEntryById(entryId) {
    try {
      const entry = await this.populateLedgerEntry(entryId);

      if (!entry) {
        throw this.handleError(404, `Ledger entry with ID ${entryId} not found`);
      }

      return {
        success: true,
        data: entry,
        message: "Ledger entry retrieved successfully"
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get ledger entries with pagination and filters
   */
  async getLedgerEntries(filters = {}, pagination = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "entry_date",
        sort_order = "desc",
      } = pagination;

      const {
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
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (category) query.category = category;
      if (currency) query.currency = currency;
      if (branch_code) query.branch_code = branch_code;

      // Reference filters
      if (loan_id) query["refs.loan_id"] = loan_id;
      if (asset_id) query["refs.asset_id"] = asset_id;
      if (payment_id) query["refs.payment_id"] = payment_id;
      if (inventory_txn_id) query["refs.inventory_txn_id"] = inventory_txn_id;

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

      if (entry_from || entry_to) {
        query.entry_date = {};
        if (entry_from) query.entry_date.$gte = new Date(entry_from);
        if (entry_to) query.entry_date.$lte = new Date(entry_to);
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [
          { memo: { $regex: search, $options: "i" } },
          { branch_code: { $regex: search, $options: "i" } },
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [entries, total] = await Promise.all([
        LedgerEntry.find(query)
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        LedgerEntry.countDocuments(query)
      ]);

      // Populate entries
      const populatedEntries = await Promise.all(
        entries.map(entry => this.populateLedgerEntry(entry._id))
      );

      return {
        success: true,
        data: {
          entries: populatedEntries,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get ledger entries error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all ledger entries without pagination
   */
  async getAllLedgerEntries(filters = {}) {
    try {
      const { category, currency, branch_code, created_from, created_to } = filters;

      let query = {};

      if (category) query.category = category;
      if (currency) query.currency = currency;
      if (branch_code) query.branch_code = branch_code;
      
      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      const entries = await LedgerEntry.find(query)
        .sort({ entry_date: -1 })
        .lean();

      const populatedEntries = await Promise.all(
        entries.map(entry => this.populateLedgerEntry(entry._id))
      );

      return {
        success: true,
        data: populatedEntries,
        count: populatedEntries.length,
      };
    } catch (error) {
      console.error("Get all ledger entries error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update ledger entry
   */
  async updateLedgerEntry(entryId, updateData, userId) {
    try {
      const entry = await LedgerEntry.findById(entryId);

      if (!entry) {
        throw this.handleError(404, `Ledger entry with ID ${entryId} not found`);
      }

      // Prevent updating certain fields for processed entries
      if (entry.category === "loan_principal_repayment" || entry.category === "interest_income") {
        const restrictedFields = ["category", "amount", "currency", "refs.loan_id", "refs.payment_id"];
        for (const field of restrictedFields) {
          const fieldPath = field.split(".");
          const currentValue = fieldPath.reduce((obj, key) => obj?.[key], entry);
          const newValue = fieldPath.reduce((obj, key) => obj?.[key], updateData);
          
          if (newValue !== undefined && JSON.stringify(newValue) !== JSON.stringify(currentValue)) {
            throw this.handleError(400, `Cannot update ${field} for ${entry.category} ledger entry`);
          }
        }
      }

      // Update entry
      Object.assign(entry, updateData);
      await entry.save();

      const populatedEntry = await this.populateLedgerEntry(entry._id);

      return {
        success: true,
        data: populatedEntry,
        message: "Ledger entry updated successfully"
      };
    } catch (error) {
      console.error("Update ledger entry error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete ledger entry
   */
  async deleteLedgerEntry(entryId, userId) {
    try {
      const entry = await LedgerEntry.findById(entryId);

      if (!entry) {
        throw this.handleError(404, `Ledger entry with ID ${entryId} not found`);
      }

      // Prevent deletion of certain entry types
      const nonDeletableCategories = [
        "loan_principal_repayment",
        "interest_income",
        "storage_income",
        "penalty_income",
        "asset_sale_revenue",
        "asset_sale_cogs"
      ];

      if (nonDeletableCategories.includes(entry.category)) {
        throw this.handleError(400, `Cannot delete ${entry.category} ledger entry`);
      }

      await LedgerEntry.findByIdAndDelete(entryId);

      return {
        success: true,
        message: "Ledger entry deleted successfully"
      };
    } catch (error) {
      console.error("Delete ledger entry error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get ledger summary/balance
   */
  async getLedgerSummary(filters = {}) {
    try {
      let query = {};

      // Apply filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from) query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to) query.created_at.$lte = new Date(filters.created_to);
      }

      if (filters.entry_from || filters.entry_to) {
        query.entry_date = {};
        if (filters.entry_from) query.entry_date.$gte = new Date(filters.entry_from);
        if (filters.entry_to) query.entry_date.$lte = new Date(filters.entry_to);
      }

      if (filters.category) query.category = filters.category;
      if (filters.currency) query.currency = filters.currency;
      if (filters.branch_code) query.branch_code = filters.branch_code;

      // Get total counts and amounts
      const totalStats = await LedgerEntry.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total_count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            total_income: {
              $sum: {
                $cond: [{ $gt: ["$amount", 0] }, "$amount", 0]
              }
            },
            total_expenses: {
              $sum: {
                $cond: [{ $lt: ["$amount", 0] }, "$amount", 0]
              }
            }
          }
        }
      ]);

      // Get stats by category
      const categoryStats = await LedgerEntry.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            avg_amount: { $avg: "$amount" }
          }
        },
        { $sort: { total_amount: -1 } }
      ]);

      // Get stats by currency
      const currencyStats = await LedgerEntry.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$currency",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" }
          }
        }
      ]);

      // Get stats by branch
      const branchStats = await LedgerEntry.aggregate([
        { $match: { ...query, branch_code: { $exists: true, $ne: null } } },
        {
          $group: {
            _id: "$branch_code",
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" }
          }
        },
        { $sort: { total_amount: -1 } }
      ]);

      // Get daily totals for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const dailyStats = await LedgerEntry.aggregate([
        {
          $match: {
            ...query,
            entry_date: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: "$entry_date" },
              month: { $month: "$entry_date" },
              day: { $dayOfMonth: "$entry_date" }
            },
            count: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            date: { $first: "$entry_date" }
          }
        },
        { $sort: { "_id.year": -1, "_id.month": -1, "_id.day": -1 } },
        { $limit: 30 }
      ]);

      // Format daily stats
      const formattedDailyStats = dailyStats.map(stat => ({
        date: new Date(stat.date).toISOString().split('T')[0],
        count: stat.count,
        total_amount: stat.total_amount
      }));

      // Get top entries
      const topEntries = await LedgerEntry.find(query)
        .sort({ amount: -1 })
        .limit(10)
        .lean();

      const populatedTopEntries = await Promise.all(
        topEntries.map(entry => this.populateLedgerEntry(entry._id))
      );

      // Calculate net balance
      const netBalance = totalStats[0] ? totalStats[0].total_amount : 0;

      // Get today's entries
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysEntries = await LedgerEntry.countDocuments({
        ...query,
        entry_date: { $gte: today, $lt: tomorrow }
      });

      return {
        success: true,
        data: {
          summary: totalStats[0] || {
            total_count: 0,
            total_amount: 0,
            total_income: 0,
            total_expenses: 0
          },
          by_category: categoryStats,
          by_currency: currencyStats,
          by_branch: branchStats,
          daily_trends: formattedDailyStats,
          top_entries: populatedTopEntries,
          net_balance: netBalance,
          todays_entries: todaysEntries,
          income_categories: categoryStats.filter(c => c.total_amount > 0),
          expense_categories: categoryStats.filter(c => c.total_amount < 0)
        }
      };
    } catch (error) {
      console.error("Get ledger summary error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get trial balance
   */
  async getTrialBalance(startDate, endDate) {
    try {
      const query = {
        entry_date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const entries = await LedgerEntry.find(query)
        .sort({ category: 1, entry_date: 1 })
        .lean();

      // Group by category and calculate debits/credits
      const trialBalance = {};
      entries.forEach(entry => {
        if (!trialBalance[entry.category]) {
          trialBalance[entry.category] = {
            category: entry.category,
            debit: 0,
            credit: 0,
            balance: 0,
            count: 0
          };
        }

        const tb = trialBalance[entry.category];
        tb.count++;

        if (entry.amount < 0) {
          tb.debit += Math.abs(entry.amount);
        } else {
          tb.credit += entry.amount;
        }
        
        tb.balance = tb.credit - tb.debit;
      });

      // Convert to array and calculate totals
      const tbArray = Object.values(trialBalance);
      const totals = tbArray.reduce((acc, curr) => ({
        debit: acc.debit + curr.debit,
        credit: acc.credit + curr.credit,
        balance: acc.balance + curr.balance,
        count: acc.count + curr.count
      }), { debit: 0, credit: 0, balance: 0, count: 0 });

      return {
        success: true,
        data: {
          period: {
            start_date: new Date(startDate),
            end_date: new Date(endDate)
          },
          trial_balance: tbArray,
          totals,
          is_balanced: Math.abs(totals.debit - totals.credit) < 0.01, // Allow small rounding errors
          generated_at: new Date()
        }
      };
    } catch (error) {
      console.error("Get trial balance error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get profit and loss statement
   */
  async getProfitAndLoss(startDate, endDate) {
    try {
      const query = {
        entry_date: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      };

      const entries = await LedgerEntry.find(query)
        .sort({ category: 1 })
        .lean();

      // Categorize entries
      const pnl = {
        revenue: [],
        cost_of_goods_sold: [],
        operating_expenses: [],
        other_income: [],
        other_expenses: []
      };

      entries.forEach(entry => {
        const category = entry.category;
        const amount = entry.amount;

        // Map categories to P&L sections
        if (["interest_income", "storage_income", "penalty_income", "asset_sale_revenue"].includes(category)) {
          pnl.revenue.push({ ...entry, amount: Math.abs(amount) });
        } else if (category === "asset_sale_cogs") {
          pnl.cost_of_goods_sold.push({ ...entry, amount: Math.abs(amount) });
        } else if (["loan_disbursement", "write_off"].includes(category)) {
          pnl.operating_expenses.push({ ...entry, amount: Math.abs(amount) });
        } else if (category === "other") {
          if (amount > 0) {
            pnl.other_income.push(entry);
          } else {
            pnl.other_expenses.push({ ...entry, amount: Math.abs(amount) });
          }
        }
      });

      // Calculate totals
      const calculateTotal = (items) => items.reduce((sum, item) => sum + Math.abs(item.amount), 0);

      const totals = {
        total_revenue: calculateTotal(pnl.revenue),
        total_cogs: calculateTotal(pnl.cost_of_goods_sold),
        total_operating_expenses: calculateTotal(pnl.operating_expenses),
        total_other_income: pnl.other_income.reduce((sum, item) => sum + item.amount, 0),
        total_other_expenses: calculateTotal(pnl.other_expenses)
      };

      // Calculate profit metrics
      const gross_profit = totals.total_revenue - totals.total_cogs;
      const operating_profit = gross_profit - totals.total_operating_expenses;
      const net_profit = operating_profit + totals.total_other_income - totals.total_other_expenses;

      // Calculate margins
      const gross_margin = totals.total_revenue > 0 ? (gross_profit / totals.total_revenue * 100).toFixed(2) : 0;
      const operating_margin = totals.total_revenue > 0 ? (operating_profit / totals.total_revenue * 100).toFixed(2) : 0;
      const net_margin = totals.total_revenue > 0 ? (net_profit / totals.total_revenue * 100).toFixed(2) : 0;

      return {
        success: true,
        data: {
          period: {
            start_date: new Date(startDate),
            end_date: new Date(endDate)
          },
          sections: pnl,
          totals,
          profit_metrics: {
            gross_profit,
            operating_profit,
            net_profit,
            gross_margin: `${gross_margin}%`,
            operating_margin: `${operating_margin}%`,
            net_margin: `${net_margin}%`
          },
          generated_at: new Date()
        }
      };
    } catch (error) {
      console.error("Get profit and loss error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Populate ledger entry with related data
   */
  async populateLedgerEntry(entryId) {
    try {
      const entry = await LedgerEntry.findById(entryId)
        .populate({
          path: "refs.loan_id",
          select: "loan_no principal_amount currency status customer_user",
          populate: {
            path: "customer_user",
            select: "first_name last_name email"
          }
        })
        .populate({
          path: "refs.payment_id",
          select: "receipt_no amount currency payment_status"
        })
        .populate({
          path: "refs.asset_id",
          select: "asset_no title category status evaluated_value",
          populate: {
            path: "owner_user",
            select: "first_name last_name email"
          }
        })
        .populate({
          path: "refs.inventory_txn_id",
          select: "tx_no type amount currency"
        })
        .populate({
          path: "created_by_user_id",
          select: "first_name last_name email roles"
        })
        .lean();

      if (!entry) return null;

      // Format the entry for response
      return {
        ...entry,
        formatted_amount: entry.amount.toLocaleString('en-US', {
          style: 'currency',
          currency: entry.currency || 'USD',
          minimumFractionDigits: 2
        }),
        is_debit: entry.amount < 0,
        is_credit: entry.amount > 0,
        category_label: this.getCategoryLabel(entry.category)
      };
    } catch (error) {
      console.error("Populate ledger entry error:", error);
      return null;
    }
  }

  /**
   * Get category label for display
   */
  getCategoryLabel(category) {
    const labels = {
      "interest_income": "Interest Income",
      "storage_income": "Storage Income",
      "penalty_income": "Penalty Income",
      "loan_disbursement": "Loan Disbursement",
      "loan_principal_repayment": "Loan Principal Repayment",
      "asset_sale_revenue": "Asset Sale Revenue",
      "asset_sale_cogs": "Cost of Goods Sold",
      "write_off": "Write Off",
      "adjustment": "Adjustment",
      "other": "Other"
    };
    return labels[category] || category;
  }

  /**
   * Handle custom errors
   */
  handleError(status, message) {
    return {
      status,
      message,
      timestamp: new Date()
    };
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Ledger Entry Service Error:", error);

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
        field
      };
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map(err => err.message);
      return {
        status: 400,
        message: "Validation failed",
        errors
      };
    }

    // Handle CastError (invalid ObjectId)
    if (error.name === "CastError") {
      return {
        status: 400,
        message: `Invalid ${error.path}: ${error.value}`
      };
    }

    // Default error
    return {
      status: 500,
      message: "Internal server error",
      detail: error.message
    };
  }
}

module.exports = new LedgerEntryService();