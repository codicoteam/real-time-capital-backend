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
const Expense = require("../models/expense.model"); // <-- ADDED

class ReportService {
  /**
   * Generate comprehensive system report with graphs and analytics.
   * @param {Object} options - { startDate, endDate } optional ISO date strings.
   * @returns {Promise<Object>} Report data.
   */
  async getReportData(options = {}) {
    try {
      const { startDate, endDate } = options;

      // Default date range: last 30 days if not provided
      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setDate(now.getDate() - 30);

      const start = startDate ? new Date(startDate) : defaultStart;
      const end = endDate ? new Date(endDate) : now;

      // Run all aggregations in parallel
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
        // New expense data
        expenseSummary,
        expenseTrend,
        expenseBreakdown,
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
        this._getRecentActivities(10), // last 10 activities with populated fields
        // New expense methods
        this._getExpenseSummary(start, end),
        this._getExpenseTrend(start, end),
        this._getExpenseBreakdownByCategory(start, end),
      ]);

      return {
        success: true,
        data: {
          summary: {
            ...summary,
            expenses: expenseSummary, // add expense summary to main summary
          },
          charts: {
            userGrowth,
            loanBook,
            loanApplications,
            payments,
            auctions: auctions.trend, // main time-series chart
            auctionSummary: auctions.summary,
            assetDistribution,
            profitLoss,
            supportTickets,
            loanConversion, // loan conversion rate
            bidWinRatio, // bid win ratio
            debtorSummary, // debtor stats
            loanTermStats, // loan term stats
            attachmentStats, // attachment stats
            // New expense charts
            expenseTrend,
            expenseBreakdown,
          },
          tables: {
            recentActivities,
          },
        },
        message: "System report generated successfully",
      };
    } catch (error) {
      console.error("ReportService error:", error);
      throw new Error(`Failed to generate report: ${error.message}`);
    }
  }

  // ------------------- Private aggregation methods -------------------

  /**
   * High-level system summary counts.
   */
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
      totalPendingApplications,
      totalAuctions,
      totalLiveAuctions,
      totalTicketsOpen,
      totalDebtorRecords,
      totalMatchedDebtors,
      totalAttachments,
      totalExpenses, // <-- NEW
      totalApprovedExpensesAmount, // <-- NEW
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ roles: "customer" }),
      User.countDocuments({
        roles: {
          $in: [
            "super_admin_vendor",
            "admin_pawn_limited",
            "management",
            "loan_officer_approval",
            "loan_officer_processor",
            "call_centre_support",
          ],
        },
      }),
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
      Auction.countDocuments(),
      Auction.countDocuments({ status: "live" }),
      SupportTicket.countDocuments({
        status: { $in: ["open", "in_progress"] },
      }),
      DebtorRecord.countDocuments(),
      DebtorRecord.countDocuments({ matched_user: { $ne: null } }),
      Attachment.countDocuments(),
      Expense.countDocuments(), // total expenses
      Expense.aggregate([
        // total approved amount
        { $match: { status: "approved" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

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
      total_payments_amount: totalPaymentsAmount[0]?.total || 0,
      total_applications: totalApplications,
      total_pending_applications: totalPendingApplications,
      total_auctions: totalAuctions,
      total_live_auctions: totalLiveAuctions,
      total_open_tickets: totalTicketsOpen,
      total_debtor_records: totalDebtorRecords,
      total_matched_debtors: totalMatchedDebtors,
      total_attachments: totalAttachments,
      total_expenses: totalExpenses, // <-- NEW
      total_approved_expenses_amount:
        totalApprovedExpensesAmount[0]?.total || 0, // <-- NEW
    };
  }

  /**
   * Expense summary for the period: totals, counts by status, etc.
   */
  async _getExpenseSummary(start, end) {
    const [totalAmount] = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
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

    const byStatus = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$amount" },
        },
      },
    ]);

    // Approved amount separately for convenience
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

  /**
   * Expense trend over time (daily approved expenses).
   */
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
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$expense_date" } },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const labels = daily.map((d) => d._id);
    const amountData = daily.map((d) => d.total);
    const countData = daily.map((d) => d.count);

    return {
      labels,
      datasets: [
        { label: "Expense Amount (USD)", data: amountData },
        { label: "Number of Expenses", data: countData },
      ],
    };
  }

  /**
   * Expense breakdown by category (total amount per category).
   */
  async _getExpenseBreakdownByCategory(start, end) {
    const byCategory = await Expense.aggregate([
      {
        $match: {
          expense_date: { $gte: start, $lte: end },
          status: "approved", // only approved expenses for financial reporting
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

  /**
   * User growth over time: cumulative new users per day (customers vs staff).
   */
  async _getUserGrowth(start, end) {
    const pipeline = [
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
      {
        $facet: {
          customers: [
            { $match: { roles: "customer" } },
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          staff: [
            {
              $match: {
                roles: {
                  $in: [
                    "super_admin_vendor",
                    "admin_pawn_limited",
                    "management",
                    "loan_officer_approval",
                    "loan_officer_processor",
                    "call_centre_support",
                  ],
                },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
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

    // Build cumulative totals
    let cumCustomers = 0;
    let cumStaff = 0;
    const labels = [];
    const customerData = [];
    const staffData = [];

    // Merge all dates
    const allDates = new Set();
    customers.forEach((d) => allDates.add(d._id));
    staff.forEach((d) => allDates.add(d._id));
    const sortedDates = Array.from(allDates).sort();

    for (const date of sortedDates) {
      labels.push(date);
      const cust = customers.find((c) => c._id === date)?.count || 0;
      const stf = staff.find((s) => s._id === date)?.count || 0;
      cumCustomers += cust;
      cumStaff += stf;
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

  /**
   * Loan book overview: total disbursed, outstanding, overdue, and current loan counts.
   */
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
        },
      },
    ]);

    return {
      total_disbursed: loanStats?.total_disbursed || 0,
      total_outstanding: loanStats?.total_outstanding || 0,
      active_loans: loanStats?.active_loans || 0,
      overdue_loans: loanStats?.overdue_loans || 0,
      redeemed_loans: loanStats?.redeemed_loans || 0,
    };
  }

  /**
   * Loan applications over time: submitted, approved, rejected counts per day.
   */
  async _getLoanApplicationsOverTime(start, end) {
    const pipeline = [
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
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
    ];

    const results = await LoanApplication.aggregate(pipeline);

    // Organize by status
    const statuses = [
      "submitted",
      "approved",
      "rejected",
      "processing",
      "cancelled",
    ];
    const dataMap = {};
    const labels = [];

    results.forEach((item) => {
      const date = item._id.date;
      const status = item._id.status;
      if (!labels.includes(date)) labels.push(date);
      if (!dataMap[status]) dataMap[status] = [];
    });

    labels.sort();

    statuses.forEach((status) => {
      if (!dataMap[status]) dataMap[status] = new Array(labels.length).fill(0);
    });

    // Fill counts
    results.forEach((item) => {
      const dateIndex = labels.indexOf(item._id.date);
      if (dateIndex !== -1) {
        dataMap[item._id.status][dateIndex] = item.count;
      }
    });

    const datasets = statuses.map((status) => ({
      label: status.charAt(0).toUpperCase() + status.slice(1),
      data: dataMap[status] || [],
    }));

    return { labels, datasets };
  }

  /**
   * Payments collected over time (total amount per day).
   */
  async _getPaymentsOverTime(start, end) {
    const pipeline = [
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
    ];

    const results = await Payment.aggregate(pipeline);
    const labels = results.map((r) => r._id);
    const data = results.map((r) => r.total);

    return { labels, datasets: [{ label: "Payments (USD)", data }] };
  }

  /**
   * Auction performance: number of auctions, total bids, total winning revenue.
   */
  async _getAuctionPerformance(start, end) {
    const [auctionStats] = await Auction.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
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

    // Also get daily trend
    const dailyTrend = await Auction.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const labels = dailyTrend.map((d) => d._id);
    const data = dailyTrend.map((d) => d.count);

    return {
      summary: {
        total_auctions: auctionStats?.total_auctions || 0,
        total_bids: auctionStats?.total_bids || 0,
        total_revenue: auctionStats?.total_revenue || 0,
      },
      trend: { labels, datasets: [{ label: "Auctions Created", data }] },
    };
  }

  /**
   * Asset distribution by category and status.
   */
  async _getAssetDistribution() {
    const byCategory = await Asset.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
        },
      },
    ]);

    const byStatus = await Asset.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
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

  /**
   * Profit & Loss: interest income, storage fees, penalties, auction revenue, etc.
   */
  async _getProfitLoss(start, end) {
    // Interest income from payments (interest_component)
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

    // Auction revenue (winning bids)
    const [auctionRevenue] = await Auction.aggregate([
      {
        $match: {
          ends_at: { $gte: start, $lte: end },
          status: "closed",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$winning_bid_amount" },
        },
      },
    ]);

    return {
      interest_income: interestIncome?.interest || 0,
      principal_collected: interestIncome?.principal || 0,
      storage_fees: interestIncome?.storage || 0,
      penalty_fees: interestIncome?.penalty || 0,
      auction_revenue: auctionRevenue?.total || 0,
    };
  }

  /**
   * Support tickets over time: opened vs resolved per day.
   */
  async _getSupportTicketsOverTime(start, end) {
    const opened = await SupportTicket.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const resolved = await SupportTicket.aggregate([
      {
        $match: {
          updated_at: { $gte: start, $lte: end },
          status: "resolved",
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$updated_at" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Merge dates
    const allDates = new Set();
    opened.forEach((d) => allDates.add(d._id));
    resolved.forEach((d) => allDates.add(d._id));
    const labels = Array.from(allDates).sort();

    const openedData = labels.map((date) => {
      const found = opened.find((o) => o._id === date);
      return found ? found.count : 0;
    });
    const resolvedData = labels.map((date) => {
      const found = resolved.find((r) => r._id === date);
      return found ? found.count : 0;
    });

    return {
      labels,
      datasets: [
        { label: "Opened", data: openedData },
        { label: "Resolved", data: resolvedData },
      ],
    };
  }

  /**
   * Loan conversion rate over time: percentage of submitted applications that become loans.
   */
  async _getLoanConversionRate(start, end) {
    // Get monthly submitted applications and monthly created loans (disbursed)
    const monthlySubmitted = await LoanApplication.aggregate([
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
    ]);

    const monthlyLoans = await Loan.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          status: { $in: ["active", "redeemed", "overdue"] }, // loans that were successfully created
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
    ]);

    // Build arrays
    const months = [];
    const submittedData = [];
    const loanData = [];
    const rateData = [];

    const allMonths = new Set();
    monthlySubmitted.forEach((m) =>
      allMonths.add(`${m._id.year}-${m._id.month}`),
    );
    monthlyLoans.forEach((m) => allMonths.add(`${m._id.year}-${m._id.month}`));
    const sortedMonths = Array.from(allMonths).sort();

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
        { label: "Submitted Applications", data: submittedData },
        { label: "Loans Created", data: loanData },
        { label: "Conversion Rate (%)", data: rateData, yAxisID: "percentage" },
      ],
    };
  }

  /**
   * Bid win ratio: total bids vs winning bids per month.
   */
  async _getBidWinRatio(start, end) {
    // Aggregate bids per month
    const monthlyBids = await Bid.aggregate([
      {
        $match: {
          placed_at: { $gte: start, $lte: end },
        },
      },
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
    ]);

    // Winning bids: we need to know which bids won. Winner is stored in Auction.winner_user and winning_bid_amount.
    // We can get from auctions that ended in the period and have a winner.
    const monthlyWins = await Auction.aggregate([
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
    ]);

    const months = [];
    const bidsData = [];
    const winsData = [];
    const ratioData = [];

    const allMonths = new Set();
    monthlyBids.forEach((m) => allMonths.add(`${m._id.year}-${m._id.month}`));
    monthlyWins.forEach((m) => allMonths.add(`${m._id.year}-${m._id.month}`));
    const sortedMonths = Array.from(allMonths).sort();

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
        { label: "Total Bids", data: bidsData },
        { label: "Winning Bids", data: winsData },
        { label: "Win Ratio (%)", data: ratioData, yAxisID: "percentage" },
      ],
    };
  }

  /**
   * Debtor summary: total records, matched vs unmatched, total due amounts, etc.
   */
  async _getDebtorSummary() {
    const [totalDebtors, matchedDebtors, totalAmountDue] = await Promise.all([
      DebtorRecord.countDocuments(),
      DebtorRecord.countDocuments({ matched_user: { $ne: null } }),
      DebtorRecord.aggregate([
        { $group: { _id: null, total_due: { $sum: "$total_due" } } },
      ]),
    ]);

    // Also get top debtors by amount due
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

  /**
   * Loan term statistics: average interest rates, renewals, etc.
   */
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

    // Distribution of terms per loan
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

  /**
   * Attachment statistics: counts by category, entity type, etc.
   */
  async _getAttachmentStats() {
    const [totalAttachments, byCategory, byEntityType] = await Promise.all([
      Attachment.countDocuments(),
      Attachment.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Attachment.aggregate([
        { $group: { _id: "$entity_type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    // Also get storage distribution (gridfs, s3, local, url)
    const byStorage = await Attachment.aggregate([
      { $group: { _id: "$storage", count: { $sum: 1 } } },
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
   * Recent activities (last N events from various collections) with populated fields.
   */
  async _getRecentActivities(limit = 10) {
    const activities = [];

    // Recent users
    const recentUsers = await User.find()
      .sort({ created_at: -1 })
      .limit(5)
      .select("first_name last_name email roles created_at")
      .lean();
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

    // Recent loan applications with populated customer
    const recentApps = await LoanApplication.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("customer_user", "first_name last_name email phone")
      .lean();
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

    // Recent loans with populated customer and asset
    const recentLoans = await Loan.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("customer_user", "first_name last_name email")
      .populate("asset", "title category asset_no")
      .lean();
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

    // Recent payments with populated loan and customer
    const recentPayments = await Payment.find({ payment_status: "paid" })
      .sort({ paid_at: -1 })
      .limit(5)
      .populate({
        path: "loan",
        select: "loan_no customer_user",
        populate: { path: "customer_user", select: "first_name last_name" },
      })
      .lean();
    recentPayments.forEach((p) => {
      activities.push({
        type: "payment",
        description: `Payment of $${p.amount} received for loan ${p.loan?.loan_no}`,
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

    // Recent auctions with populated asset and creator
    const recentAuctions = await Auction.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("asset", "title category asset_no")
      .populate("created_by", "first_name last_name")
      .lean();
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

    // Recent support tickets with populated customer and assignee
    const recentTickets = await SupportTicket.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("customer_user", "first_name last_name email")
      .populate("assigned_to", "first_name last_name")
      .lean();
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

    // Recent debtor records
    const recentDebtors = await DebtorRecord.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("matched_user", "first_name last_name email")
      .lean();
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

    // Recent attachments
    const recentAttachments = await Attachment.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("owner_user", "first_name last_name")
      .lean();
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

    // Recent expenses (NEW) - optionally include in activities
    const recentExpenses = await Expense.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("created_by", "first_name last_name")
      .populate("approved_by", "first_name last_name")
      .lean();
    recentExpenses.forEach((e) => {
      activities.push({
        type: "expense_recorded",
        description: `Expense ${e.expense_no} (${e.category}) - $${e.amount}`,
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

    // Sort all activities by timestamp descending and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return activities.slice(0, limit);
  }
}

module.exports = new ReportService();
