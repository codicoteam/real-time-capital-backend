const mongoose = require("mongoose");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const Payment = require("../models/payment.model");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const SupportTicket = require("../models/supportTicket.model");
const DebtorRecord = require("../models/debtorRecord.model");
const LoanTerm = require("../models/loanTerm.model");
const Attachment = require("../models/attachment.model");
const Expense = require("../models/expense.model");

// ---------------------------------------------------------------------------
// Constants — centralised so they can be updated in one place
// ---------------------------------------------------------------------------

/** Number of days used when no date range is supplied by the caller. */
const DEFAULT_DATE_RANGE_DAYS = 30;

/** Maximum number of recent activity rows returned by default. */
const DEFAULT_RECENT_ACTIVITIES_LIMIT = 10;

/**
 * Roles that are considered "staff" throughout the reporting service.
 * Must stay in sync with the User model's roles enum.
 */
const STAFF_ROLES = [
  "super_admin_vendor",
  "admin_pawn_limited",
  "management",
  "loan_officer_approval",
  "loan_officer_processor",
  "call_centre_support",
];

/**
 * Loan statuses that represent a fully-disbursed (live or settled) loan.
 * Used consistently across ratio calculations and aggregations.
 */
const DISBURSED_LOAN_STATUSES = ["active", "redeemed", "overdue"];

/**
 * Loan application statuses that represent an application which entered the system.
 */
const ENTERED_APPLICATION_STATUSES = ["submitted", "approved", "processing"];

// ---------------------------------------------------------------------------

class ReportService {
  /**
   * Generate comprehensive system report with graphs and analytics.
   * @param {Object} options - { startDate, endDate } optional ISO date strings.
   * @returns {Promise<Object>} Report data.
   */
  async getReportData(options = {}) {
    try {
      const { startDate, endDate } = options;

      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setDate(now.getDate() - DEFAULT_DATE_RANGE_DAYS);

      const start = startDate ? new Date(startDate) : defaultStart;
      const end = endDate ? new Date(endDate) : now;

      const [
        summary,
        userGrowth,
        loanBook,
        loanApplications,
        payments,
        auctions,
        assetDistribution,
        profitLoss,
        supportTickets,
        loanConversion,
        bidWinRatio,
        debtorSummary,
        loanTermStats,
        attachmentStats,
        recentActivities,
        expenseSummary,
        expenseTrend,
        expenseBreakdown,
        businessRatios,
      ] = await Promise.all([
        this._getSummary(),
        this._getUserGrowth(start, end),
        this._getLoanBook(),
        this._getLoanApplicationsOverTime(start, end),
        this._getPaymentsOverTime(start, end),
        this._getAuctionPerformance(start, end),
        this._getAssetDistribution(),
        this._getProfitLoss(start, end),
        this._getSupportTicketsOverTime(start, end),
        this._getLoanConversionRate(start, end),
        this._getBidWinRatio(start, end),
        this._getDebtorSummary(),
        this._getLoanTermStats(),
        this._getAttachmentStats(),
        this._getRecentActivities(DEFAULT_RECENT_ACTIVITIES_LIMIT),
        this._getExpenseSummary(start, end),
        this._getExpenseTrend(start, end),
        this._getExpenseBreakdownByCategory(start, end),
        this._getBusinessRatios(start, end),
      ]);

      return {
        success: true,
        data: {
          summary: {
            ...summary,
            expenses: expenseSummary,
          },
          charts: {
            userGrowth,
            loanBook,
            loanApplications,
            payments,
            auctions: auctions.trend,
            auctionSummary: auctions.summary,
            assetDistribution,
            profitLoss,
            supportTickets,
            loanConversion,
            bidWinRatio,
            debtorSummary,
            loanTermStats,
            attachmentStats,
            expenseTrend,
            expenseBreakdown,
          },
          tables: {
            recentActivities,
          },
          ratios: businessRatios,
        },
        message: "System report generated successfully",
      };
    } catch (error) {
      console.error("ReportService error:", error);
      throw new Error(`Failed to generate report: ${error.message}`);
    }
  }

  // ------------------- Private aggregation methods -------------------

  async _getSummary() {
    const [
      totalUsers,
      totalCustomers,
      totalStaff,
      totalLoans,
      totalActiveLoans,
      totalOverdueLoans,
      totalAssets,
      totalPawnedAssets,
      totalPayments,
      totalPaymentsAmount,
      totalApplications,
      // "Pending Approvals" card = applications still awaiting a decision
      totalPendingApplications,
      totalApprovedApplications,
      totalAuctions,
      totalLiveAuctions,
      totalTicketsOpen,
      totalDebtorRecords,
      totalMatchedDebtors,
      totalAttachments,
      totalExpensesCount,
      totalApprovedExpensesAmount,
      // FIX 1: "Total Bids" card — was never queried in _getSummary before
      totalBids,
      // FIX 2: Auction revenue for "Total Revenue" card
      totalAuctionRevenue,
      // FIX 3: Average loan principal for "Avg. Loan Amount" card
      avgLoanAmountResult,
      // For approval rate denominator
      totalDecidedApps,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ roles: "customer" }),
      User.countDocuments({ roles: { $in: STAFF_ROLES } }),
      Loan.countDocuments(),
      Loan.countDocuments({ status: "active" }),
      Loan.countDocuments({ status: "overdue" }),
      Asset.countDocuments(),
      Asset.countDocuments({ status: "pawned" }),
      Payment.countDocuments({ payment_status: "paid" }),
      Payment.aggregate([
        { $match: { payment_status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      LoanApplication.countDocuments(),
      LoanApplication.countDocuments({ status: "submitted" }),
      LoanApplication.countDocuments({ status: "approved" }),
      Auction.countDocuments(),
      Auction.countDocuments({ status: "live" }),
      SupportTicket.countDocuments({
        status: { $in: ["open", "in_progress"] },
      }),
      DebtorRecord.countDocuments(),
      DebtorRecord.countDocuments({ matched_user: { $ne: null } }),
      Attachment.countDocuments(),
      Expense.countDocuments(),
      Expense.aggregate([
        { $match: { status: "approved" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      // FIX 1: Count all bids across all time for the summary card
      Bid.countDocuments(),

      // FIX 2: Sum winning_bid_amount on all closed auctions that have a winner
      Auction.aggregate([
        {
          $match: {
            status: "closed",
            winner_user: { $exists: true, $ne: null },
          },
        },
        { $group: { _id: null, total: { $sum: "$winning_bid_amount" } } },
      ]),

      // FIX 3: $avg on all disbursed loans — returns 0 only when there are
      // genuinely no loans, not because of a missing query
      Loan.aggregate([
        { $match: { status: { $in: DISBURSED_LOAN_STATUSES } } },
        { $group: { _id: null, avg: { $avg: "$principal_amount" } } },
      ]),

      // Applications that have received a decision (for approval rate denominator)
      LoanApplication.countDocuments({
        status: { $in: ["approved", "rejected", "processing"] },
      }),
    ]);

    // --- Derived metrics (computed after all DB calls) ---

    // FIX 4: Default rate = overdue / all disbursed loans (not total loan docs)
    // Uses totalLoans (already fetched above) as the denominator since every
    // Loan document represents a disbursed loan in this schema.
    const disbursedCount = await Loan.countDocuments({
      status: { $in: DISBURSED_LOAN_STATUSES },
    });
    const default_rate =
      disbursedCount > 0
        ? parseFloat(((totalOverdueLoans / disbursedCount) * 100).toFixed(2))
        : 0;

    // FIX 5: Approval rate = approved apps / apps that reached a decision
    const approval_rate =
      totalDecidedApps > 0
        ? parseFloat(
            ((totalApprovedApplications / totalDecidedApps) * 100).toFixed(2),
          )
        : 0;

    // FIX 6: Total revenue = payment income + auction revenue
    const payment_revenue = totalPaymentsAmount[0]?.total || 0;
    const auction_revenue = totalAuctionRevenue[0]?.total || 0;
    const total_revenue = payment_revenue + auction_revenue;

    return {
      total_users: totalUsers,
      total_customers: totalCustomers,
      total_staff: totalStaff,
      total_loans: totalLoans,
      total_active_loans: totalActiveLoans,
      total_overdue_loans: totalOverdueLoans,
      total_assets: totalAssets,
      total_pawned_assets: totalPawnedAssets,
      total_payments: totalPayments,
      total_payments_amount: payment_revenue,
      total_applications: totalApplications,
      total_pending_applications: totalPendingApplications, // "Pending Approvals" card
      total_approved_applications: totalApprovedApplications,
      total_auctions: totalAuctions,
      total_live_auctions: totalLiveAuctions,
      total_open_tickets: totalTicketsOpen, // "Support Tickets" card
      total_debtor_records: totalDebtorRecords,
      total_matched_debtors: totalMatchedDebtors,
      total_attachments: totalAttachments,
      total_expenses_count: totalExpensesCount,
      total_approved_expenses_amount:
        totalApprovedExpensesAmount[0]?.total || 0,
      // Newly surfaced fields powering the broken dashboard cards:
      total_bids: totalBids, // "Total Bids" card
      total_revenue, // "Total Revenue" card
      auction_revenue,
      avg_loan_amount: parseFloat(
        // "Avg. Loan Amount" card
        (avgLoanAmountResult[0]?.avg || 0).toFixed(2),
      ),
      default_rate, // "Default Rate" card
      approval_rate, // "Approval Rate" card
    };
  }

  async _getBusinessRatios(start, end) {
    const totalApplications = await LoanApplication.countDocuments({
      created_at: { $gte: start, $lte: end },
      status: { $in: ENTERED_APPLICATION_STATUSES },
    });

    const totalLoansDisbursed = await Loan.countDocuments({
      created_at: { $gte: start, $lte: end },
      status: { $in: DISBURSED_LOAN_STATUSES },
    });

    const applicationToLoanRatio =
      totalApplications > 0
        ? (totalLoansDisbursed / totalApplications) * 100
        : 0;

    const totalAssetsCreated = await Asset.countDocuments({
      created_at: { $gte: start, $lte: end },
    });

    const assetInToPawnedRatio =
      totalAssetsCreated > 0
        ? (totalLoansDisbursed / totalAssetsCreated) * 100
        : 0;

    const totalBidsPlaced = await Bid.countDocuments({
      placed_at: { $gte: start, $lte: end },
    });

    const totalWinningBids = await Auction.countDocuments({
      ends_at: { $gte: start, $lte: end },
      winner_user: { $exists: true, $ne: null },
    });

    const bidWinRatioOverall =
      totalBidsPlaced > 0 ? (totalWinningBids / totalBidsPlaced) * 100 : 0;

    const paymentIncome = await Payment.aggregate([
      {
        $match: {
          paid_at: { $gte: start, $lte: end },
          payment_status: "paid",
        },
      },
      {
        $group: {
          _id: null,
          interest: { $sum: "$interest_component" },
          storage: { $sum: "$storage_component" },
          penalty: { $sum: "$penalty_component" },
        },
      },
    ]);

    const auctionRevenue = await Auction.aggregate([
      {
        $match: {
          ends_at: { $gte: start, $lte: end },
          status: "closed",
          winner_user: { $exists: true, $ne: null },
        },
      },
      { $group: { _id: null, total: { $sum: "$winning_bid_amount" } } },
    ]);

    const totalIncome =
      (paymentIncome[0]?.interest || 0) +
      (paymentIncome[0]?.storage || 0) +
      (paymentIncome[0]?.penalty || 0) +
      (auctionRevenue[0]?.total || 0);

    const totalExpensesResult = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
          status: "approved",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalExpenses = totalExpensesResult[0]?.total || 0;

    const incomeExpenseRatio =
      totalExpenses > 0
        ? totalIncome / totalExpenses
        : totalIncome > 0
          ? Infinity
          : 0;

    const loanStats = await Loan.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          status: { $in: DISBURSED_LOAN_STATUSES },
        },
      },
      {
        $group: {
          _id: null,
          avgPrincipal: { $avg: "$principal_amount" },
          avgInterestRate: { $avg: "$interest_rate_percent" },
          avgStorageCharge: { $avg: "$storage_charge_percent" },
          avgPenalty: { $avg: "$penalty_percent" },
        },
      },
    ]);

    // FIX: Explicit Number() cast guards against stored strings or null dates
    const loans = await Loan.find({
      created_at: { $gte: start, $lte: end },
      status: { $in: DISBURSED_LOAN_STATUSES },
    })
      .select("start_date due_date")
      .lean();

    let totalDays = 0;
    let loanCount = 0;
    loans.forEach((loan) => {
      if (loan.start_date && loan.due_date) {
        const days = Math.round(
          (Number(loan.due_date) - Number(loan.start_date)) /
            (1000 * 60 * 60 * 24),
        );
        if (days > 0) {
          totalDays += days;
          loanCount++;
        }
      }
    });
    const avgLoanTermDays = loanCount > 0 ? totalDays / loanCount : 0;

    // Period-scoped default rate and approval rate
    const [periodDisbursed, periodOverdue, periodTotalDecided, periodApproved] =
      await Promise.all([
        Loan.countDocuments({
          created_at: { $gte: start, $lte: end },
          status: { $in: DISBURSED_LOAN_STATUSES },
        }),
        Loan.countDocuments({
          created_at: { $gte: start, $lte: end },
          status: "overdue",
        }),
        LoanApplication.countDocuments({
          created_at: { $gte: start, $lte: end },
          status: { $in: ["approved", "rejected", "processing"] },
        }),
        LoanApplication.countDocuments({
          created_at: { $gte: start, $lte: end },
          status: "approved",
        }),
      ]);

    const periodDefaultRate =
      periodDisbursed > 0
        ? parseFloat(((periodOverdue / periodDisbursed) * 100).toFixed(2))
        : 0;

    const periodApprovalRate =
      periodTotalDecided > 0
        ? parseFloat(((periodApproved / periodTotalDecided) * 100).toFixed(2))
        : 0;

    return {
      application_to_loan_ratio: parseFloat(applicationToLoanRatio.toFixed(2)),
      asset_in_to_pawned_ratio: parseFloat(assetInToPawnedRatio.toFixed(2)),
      bid_win_ratio_overall: parseFloat(bidWinRatioOverall.toFixed(2)),
      income_expense_ratio: parseFloat(incomeExpenseRatio.toFixed(2)),
      total_income: totalIncome,
      total_expenses: totalExpenses,
      net_profit: totalIncome - totalExpenses,
      average_loan_amount: parseFloat(
        (loanStats[0]?.avgPrincipal || 0).toFixed(2),
      ),
      average_interest_rate_percent: parseFloat(
        (loanStats[0]?.avgInterestRate || 0).toFixed(2),
      ),
      average_storage_charge_percent: parseFloat(
        (loanStats[0]?.avgStorageCharge || 0).toFixed(2),
      ),
      average_penalty_percent: parseFloat(
        (loanStats[0]?.avgPenalty || 0).toFixed(2),
      ),
      average_loan_term_days: parseFloat(avgLoanTermDays.toFixed(1)),
      default_rate: periodDefaultRate,
      approval_rate: periodApprovalRate,
    };
  }

  async _getExpenseSummary(start, end) {
    const [totalAmount] = await Expense.aggregate([
      { $match: { expense_date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const byStatus = await Expense.aggregate([
      { $match: { expense_date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$amount" },
        },
      },
    ]);

    const approvedTotal =
      byStatus.find((s) => s._id === "approved")?.total || 0;
    const approvedCount =
      byStatus.find((s) => s._id === "approved")?.count || 0;

    return {
      period_total: totalAmount?.total || 0,
      period_count: totalAmount?.count || 0,
      by_status: byStatus.reduce((acc, s) => {
        acc[s._id] = { count: s.count, total: s.total };
        return acc;
      }, {}),
      approved_total: approvedTotal,
      approved_count: approvedCount,
    };
  }

  async _getExpenseTrend(start, end) {
    const daily = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
          status: "approved",
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$expense_date" },
          },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: daily.map((d) => d._id),
      datasets: [
        { label: "Expense amount", data: daily.map((d) => d.total) },
        { label: "Number of expenses", data: daily.map((d) => d.count) },
      ],
    };
  }

  async _getExpenseBreakdownByCategory(start, end) {
    const byCategory = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$category",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    return {
      labels: byCategory.map((c) => c._id),
      data: byCategory.map((c) => c.total),
      counts: byCategory.map((c) => c.count),
    };
  }

  async _getUserGrowth(start, end) {
    const pipeline = [
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $facet: {
          customers: [
            { $match: { roles: "customer" } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$created_at",
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          staff: [
            { $match: { roles: { $in: STAFF_ROLES } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$created_at",
                  },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
        },
      },
    ];

    const result = await User.aggregate(pipeline);
    const customers = result[0]?.customers || [];
    const staff = result[0]?.staff || [];

    let cumCustomers = 0;
    let cumStaff = 0;
    const labels = [];
    const customerData = [];
    const staffData = [];

    const allDates = new Set([
      ...customers.map((d) => d._id),
      ...staff.map((d) => d._id),
    ]);

    for (const date of Array.from(allDates).sort()) {
      labels.push(date);
      cumCustomers += customers.find((c) => c._id === date)?.count || 0;
      cumStaff += staff.find((s) => s._id === date)?.count || 0;
      customerData.push(cumCustomers);
      staffData.push(cumStaff);
    }

    return {
      labels,
      datasets: [
        { label: "Customers", data: customerData },
        { label: "Staff", data: staffData },
      ],
    };
  }

  async _getLoanBook() {
    const [loanStats] = await Loan.aggregate([
      {
        $group: {
          _id: null,
          total_disbursed: { $sum: "$principal_amount" },
          total_outstanding: { $sum: "$current_balance" },
          active_loans: {
            $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
          },
          overdue_loans: {
            $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] },
          },
          redeemed_loans: {
            $sum: { $cond: [{ $eq: ["$status", "redeemed"] }, 1, 0] },
          },
          avg_principal: { $avg: "$principal_amount" },
        },
      },
    ]);

    return {
      total_disbursed: loanStats?.total_disbursed || 0,
      total_outstanding: loanStats?.total_outstanding || 0,
      active_loans: loanStats?.active_loans || 0,
      overdue_loans: loanStats?.overdue_loans || 0,
      redeemed_loans: loanStats?.redeemed_loans || 0,
      avg_principal: parseFloat((loanStats?.avg_principal || 0).toFixed(2)),
    };
  }

  async _getLoanApplicationsOverTime(start, end) {
    const TRACKED_STATUSES = [
      "submitted",
      "approved",
      "rejected",
      "processing",
      "cancelled",
    ];

    const results = await LoanApplication.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
            },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const labels = Array.from(
      new Set(results.map((item) => item._id.date)),
    ).sort();

    const dataMap = TRACKED_STATUSES.reduce((acc, s) => {
      acc[s] = new Array(labels.length).fill(0);
      return acc;
    }, {});

    results.forEach((item) => {
      const dateIndex = labels.indexOf(item._id.date);
      if (dateIndex !== -1 && dataMap[item._id.status]) {
        dataMap[item._id.status][dateIndex] = item.count;
      }
    });

    return {
      labels,
      datasets: TRACKED_STATUSES.map((status) => ({
        label: status.charAt(0).toUpperCase() + status.slice(1),
        data: dataMap[status],
      })),
    };
  }

  async _getPaymentsOverTime(start, end) {
    const results = await Payment.aggregate([
      {
        $match: {
          paid_at: { $gte: start, $lte: end },
          payment_status: "paid",
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$paid_at" } },
          total: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: results.map((r) => r._id),
      datasets: [
        { label: "Payments collected", data: results.map((r) => r.total) },
      ],
    };
  }

  async _getAuctionPerformance(start, end) {
    const [auctionStats] = await Auction.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $lookup: {
          from: "bids",
          localField: "_id",
          foreignField: "auction",
          as: "bids",
        },
      },
      {
        $group: {
          _id: null,
          total_auctions: { $sum: 1 },
          total_bids: { $sum: { $size: "$bids" } },
          total_revenue: { $sum: "$winning_bid_amount" },
        },
      },
    ]);

    const dailyTrend = await Auction.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      summary: {
        total_auctions: auctionStats?.total_auctions || 0,
        total_bids: auctionStats?.total_bids || 0,
        total_revenue: auctionStats?.total_revenue || 0,
      },
      trend: {
        labels: dailyTrend.map((d) => d._id),
        datasets: [
          {
            label: "Auctions created",
            data: dailyTrend.map((d) => d.count),
          },
        ],
      },
    };
  }

  async _getAssetDistribution() {
    const [byCategory, byStatus] = await Promise.all([
      Asset.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
      Asset.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    return {
      byCategory: {
        labels: byCategory.map((c) => c._id),
        data: byCategory.map((c) => c.count),
      },
      byStatus: {
        labels: byStatus.map((s) => s._id),
        data: byStatus.map((s) => s.count),
      },
    };
  }

  async _getProfitLoss(start, end) {
    const [interestIncome] = await Payment.aggregate([
      {
        $match: {
          paid_at: { $gte: start, $lte: end },
          payment_status: "paid",
        },
      },
      {
        $group: {
          _id: null,
          interest: { $sum: "$interest_component" },
          principal: { $sum: "$principal_component" },
          storage: { $sum: "$storage_component" },
          penalty: { $sum: "$penalty_component" },
        },
      },
    ]);

    const [auctionRevenue] = await Auction.aggregate([
      {
        $match: {
          ends_at: { $gte: start, $lte: end },
          status: "closed",
        },
      },
      { $group: { _id: null, total: { $sum: "$winning_bid_amount" } } },
    ]);

    return {
      interest_income: interestIncome?.interest || 0,
      principal_collected: interestIncome?.principal || 0,
      storage_fees: interestIncome?.storage || 0,
      penalty_fees: interestIncome?.penalty || 0,
      auction_revenue: auctionRevenue?.total || 0,
    };
  }

  async _getSupportTicketsOverTime(start, end) {
    const [opened, resolved] = await Promise.all([
      SupportTicket.aggregate([
        { $match: { created_at: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      SupportTicket.aggregate([
        {
          $match: {
            updated_at: { $gte: start, $lte: end },
            status: "resolved",
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$updated_at" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const labels = Array.from(
      new Set([...opened.map((d) => d._id), ...resolved.map((d) => d._id)]),
    ).sort();

    return {
      labels,
      datasets: [
        {
          label: "Opened",
          data: labels.map(
            (date) => opened.find((o) => o._id === date)?.count || 0,
          ),
        },
        {
          label: "Resolved",
          data: labels.map(
            (date) => resolved.find((r) => r._id === date)?.count || 0,
          ),
        },
      ],
    };
  }

  async _getLoanConversionRate(start, end) {
    const [monthlySubmitted, monthlyLoans] = await Promise.all([
      LoanApplication.aggregate([
        {
          $match: {
            created_at: { $gte: start, $lte: end },
            status: { $in: ["submitted", "approved"] },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$created_at" },
              month: { $month: "$created_at" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Loan.aggregate([
        {
          $match: {
            created_at: { $gte: start, $lte: end },
            status: { $in: DISBURSED_LOAN_STATUSES },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$created_at" },
              month: { $month: "$created_at" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

    const sortedMonths = Array.from(
      new Set([
        ...monthlySubmitted.map((m) => `${m._id.year}-${m._id.month}`),
        ...monthlyLoans.map((m) => `${m._id.year}-${m._id.month}`),
      ]),
    ).sort();

    const months = [];
    const submittedData = [];
    const loanData = [];
    const rateData = [];

    for (const ym of sortedMonths) {
      const [year, month] = ym.split("-").map(Number);
      months.push(`${year}-${month.toString().padStart(2, "0")}`);
      const sub =
        monthlySubmitted.find(
          (m) => m._id.year === year && m._id.month === month,
        )?.count || 0;
      const loan =
        monthlyLoans.find((m) => m._id.year === year && m._id.month === month)
          ?.count || 0;
      submittedData.push(sub);
      loanData.push(loan);
      rateData.push(sub > 0 ? Math.round((loan / sub) * 100) : 0);
    }

    return {
      labels: months,
      datasets: [
        { label: "Submitted applications", data: submittedData },
        { label: "Loans created", data: loanData },
        {
          label: "Conversion rate (%)",
          data: rateData,
          yAxisID: "percentage",
        },
      ],
    };
  }

  async _getBidWinRatio(start, end) {
    const [monthlyBids, monthlyWins] = await Promise.all([
      Bid.aggregate([
        { $match: { placed_at: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: {
              year: { $year: "$placed_at" },
              month: { $month: "$placed_at" },
            },
            total_bids: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
      Auction.aggregate([
        {
          $match: {
            ends_at: { $gte: start, $lte: end },
            winner_user: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$ends_at" },
              month: { $month: "$ends_at" },
            },
            winning_bids: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

    const sortedMonths = Array.from(
      new Set([
        ...monthlyBids.map((m) => `${m._id.year}-${m._id.month}`),
        ...monthlyWins.map((m) => `${m._id.year}-${m._id.month}`),
      ]),
    ).sort();

    const months = [];
    const bidsData = [];
    const winsData = [];
    const ratioData = [];

    for (const ym of sortedMonths) {
      const [year, month] = ym.split("-").map(Number);
      months.push(`${year}-${month.toString().padStart(2, "0")}`);
      const bids =
        monthlyBids.find((m) => m._id.year === year && m._id.month === month)
          ?.total_bids || 0;
      const wins =
        monthlyWins.find((m) => m._id.year === year && m._id.month === month)
          ?.winning_bids || 0;
      bidsData.push(bids);
      winsData.push(wins);
      ratioData.push(bids > 0 ? Math.round((wins / bids) * 100) : 0);
    }

    return {
      labels: months,
      datasets: [
        { label: "Total bids", data: bidsData },
        { label: "Winning bids", data: winsData },
        { label: "Win ratio (%)", data: ratioData, yAxisID: "percentage" },
      ],
    };
  }

  async _getDebtorSummary() {
    const [totalDebtors, matchedDebtors, totalAmountDue] = await Promise.all([
      DebtorRecord.countDocuments(),
      DebtorRecord.countDocuments({ matched_user: { $ne: null } }),
      DebtorRecord.aggregate([
        { $group: { _id: null, total_due: { $sum: "$total_due" } } },
      ]),
    ]);

    const topDebtors = await DebtorRecord.find()
      .sort({ total_due: -1 })
      .limit(5)
      .select("client_name total_due asset_no reg_or_serial_no matched_user")
      .populate("matched_user", "first_name last_name email")
      .lean();

    return {
      total_records: totalDebtors,
      matched_records: matchedDebtors,
      unmatched_records: totalDebtors - matchedDebtors,
      total_amount_due: totalAmountDue[0]?.total_due || 0,
      top_debtors: topDebtors.map((d) => ({
        client_name: d.client_name,
        total_due: d.total_due,
        asset_no: d.asset_no,
        reg_or_serial_no: d.reg_or_serial_no,
        matched_user: d.matched_user
          ? `${d.matched_user.first_name} ${d.matched_user.last_name}`
          : null,
      })),
    };
  }

  async _getLoanTermStats() {
    const [totalTerms, avgInterestRate, renewalsByType] = await Promise.all([
      LoanTerm.countDocuments(),
      LoanTerm.aggregate([
        {
          $group: {
            _id: null,
            avg_interest: { $avg: "$interest_rate_percent" },
          },
        },
      ]),
      LoanTerm.aggregate([
        { $group: { _id: "$renewal_type", count: { $sum: 1 } } },
      ]),
    ]);

    const termsPerLoan = await LoanTerm.aggregate([
      { $group: { _id: "$loan", count: { $sum: 1 } } },
      { $group: { _id: "$count", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    return {
      total_terms: totalTerms,
      average_interest_rate: avgInterestRate[0]?.avg_interest || 0,
      renewals_by_type: renewalsByType.reduce((acc, r) => {
        acc[r._id] = r.count;
        return acc;
      }, {}),
      terms_per_loan_distribution: termsPerLoan.map((t) => ({
        terms: t._id,
        count: t.count,
      })),
    };
  }

  async _getAttachmentStats() {
    const [totalAttachments, byCategory, byEntityType, byStorage] =
      await Promise.all([
        Attachment.countDocuments(),
        Attachment.aggregate([
          { $group: { _id: "$category", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Attachment.aggregate([
          { $group: { _id: "$entity_type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Attachment.aggregate([
          { $group: { _id: "$storage", count: { $sum: 1 } } },
        ]),
      ]);

    return {
      total_attachments: totalAttachments,
      by_category: byCategory.reduce((acc, c) => {
        acc[c._id] = c.count;
        return acc;
      }, {}),
      by_entity_type: byEntityType.reduce((acc, e) => {
        acc[e._id] = e.count;
        return acc;
      }, {}),
      by_storage: byStorage.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {}),
    };
  }

  /**
   * Recent activities across all collections, sorted by timestamp descending.
   * @param {number} limit - Maximum number of entries to return.
   */
  async _getRecentActivities(limit = DEFAULT_RECENT_ACTIVITIES_LIMIT) {
    const ITEMS_PER_SOURCE = 5;
    const activities = [];

    const [
      recentUsers,
      recentApps,
      recentLoans,
      recentPayments,
      recentAuctions,
      recentTickets,
      recentDebtors,
      recentAttachments,
      recentExpenses,
    ] = await Promise.all([
      User.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .select("first_name last_name email roles created_at")
        .lean(),

      LoanApplication.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("customer_user", "first_name last_name email phone")
        .lean(),

      Loan.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("customer_user", "first_name last_name email")
        .populate("asset", "title category asset_no")
        .lean(),

      Payment.find({ payment_status: "paid" })
        .sort({ paid_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate({
          path: "loan",
          select: "loan_no customer_user",
          populate: { path: "customer_user", select: "first_name last_name" },
        })
        .lean(),

      Auction.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("asset", "title category asset_no")
        .populate("created_by", "first_name last_name")
        .lean(),

      SupportTicket.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("customer_user", "first_name last_name email")
        .populate("assigned_to", "first_name last_name")
        .lean(),

      DebtorRecord.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("matched_user", "first_name last_name email")
        .lean(),

      Attachment.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("owner_user", "first_name last_name")
        .lean(),

      Expense.find()
        .sort({ created_at: -1 })
        .limit(ITEMS_PER_SOURCE)
        .populate("created_by", "first_name last_name")
        .populate("approved_by", "first_name last_name")
        .lean(),
    ]);

    recentUsers.forEach((u) => {
      activities.push({
        type: "user_registered",
        description: `${u.first_name} ${u.last_name} (${u.roles.join(", ")}) registered`,
        timestamp: u.created_at,
        user: u._id,
        details: {
          name: `${u.first_name} ${u.last_name}`,
          email: u.email,
          roles: u.roles,
        },
      });
    });

    recentApps.forEach((a) => {
      activities.push({
        type: "loan_application",
        description: `${a.customer_user?.first_name} ${a.customer_user?.last_name} applied for loan ${a.application_no}`,
        timestamp: a.created_at,
        application: a._id,
        details: {
          application_no: a.application_no,
          amount: a.requested_loan_amount,
          status: a.status,
          customer: a.customer_user,
        },
      });
    });

    recentLoans.forEach((l) => {
      activities.push({
        type: "loan_created",
        description: `Loan ${l.loan_no} created for ${l.customer_user?.first_name} ${l.customer_user?.last_name}`,
        timestamp: l.created_at,
        loan: l._id,
        details: {
          loan_no: l.loan_no,
          amount: l.principal_amount,
          status: l.status,
          asset: l.asset,
          customer: l.customer_user,
        },
      });
    });

    recentPayments.forEach((p) => {
      activities.push({
        type: "payment",
        description: `Payment of ${p.amount} received for loan ${p.loan?.loan_no}`,
        timestamp: p.paid_at,
        payment: p._id,
        details: {
          amount: p.amount,
          method: p.method,
          loan_no: p.loan?.loan_no,
          customer: p.loan?.customer_user,
        },
      });
    });

    recentAuctions.forEach((a) => {
      activities.push({
        type: "auction_created",
        description: `Auction ${a.auction_no} created for asset ${a.asset?.title}`,
        timestamp: a.created_at,
        auction: a._id,
        details: {
          auction_no: a.auction_no,
          asset: a.asset,
          starts_at: a.starts_at,
          ends_at: a.ends_at,
          created_by: a.created_by,
        },
      });
    });

    recentTickets.forEach((t) => {
      activities.push({
        type: "support_ticket",
        description: `Ticket ${t.ticket_no}: ${t.subject}`,
        timestamp: t.created_at,
        ticket: t._id,
        details: {
          ticket_no: t.ticket_no,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          customer: t.customer_user,
          assigned_to: t.assigned_to,
        },
      });
    });

    recentDebtors.forEach((d) => {
      activities.push({
        type: "debtor_record",
        description: `Debtor record for ${d.client_name} (${d.asset_no}) imported`,
        timestamp: d.created_at,
        debtor: d._id,
        details: {
          client_name: d.client_name,
          asset_no: d.asset_no,
          total_due: d.total_due,
          matched_user: d.matched_user
            ? `${d.matched_user.first_name} ${d.matched_user.last_name}`
            : null,
        },
      });
    });

    recentAttachments.forEach((a) => {
      activities.push({
        type: "attachment_uploaded",
        description: `Attachment ${a.filename} (${a.category}) uploaded`,
        timestamp: a.created_at,
        attachment: a._id,
        details: {
          filename: a.filename,
          category: a.category,
          mime_type: a.mime_type,
          entity_type: a.entity_type,
          owner: a.owner_user
            ? `${a.owner_user.first_name} ${a.owner_user.last_name}`
            : null,
        },
      });
    });

    recentExpenses.forEach((e) => {
      activities.push({
        type: "expense_recorded",
        description: `Expense ${e.expense_no} (${e.category}) — ${e.amount}`,
        timestamp: e.created_at,
        expense: e._id,
        details: {
          expense_no: e.expense_no,
          category: e.category,
          amount: e.amount,
          status: e.status,
          created_by: e.created_by
            ? `${e.created_by.first_name} ${e.created_by.last_name}`
            : null,
        },
      });
    });

    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return activities.slice(0, limit);
  }
}

module.exports = new ReportService();
