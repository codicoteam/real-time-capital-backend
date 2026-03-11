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
        recentActivities,
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
        this._getRecentActivities(10), // last 10 activities
      ]);

      return {
        success: true,
        data: {
          summary,
          charts: {
            userGrowth,
            loanBook,
            loanApplications,
            payments,
            auctions,
            assetDistribution,
            profitLoss,
            supportTickets,
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
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ roles: "customer" }),
      User.countDocuments({ roles: { $in: ["super_admin_vendor", "admin_pawn_limited", "management", "loan_officer_approval", "loan_officer_processor", "call_centre_support"] } }),
      Loan.countDocuments(),
      Loan.countDocuments({ status: "active" }),
      Loan.countDocuments({ status: "overdue" }),
      Asset.countDocuments(),
      Asset.countDocuments({ status: "pawned" }),
      Payment.countDocuments({ payment_status: "paid" }),
      Payment.aggregate([{ $match: { payment_status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
      LoanApplication.countDocuments(),
      LoanApplication.countDocuments({ status: "submitted" }),
      Auction.countDocuments(),
      Auction.countDocuments({ status: "live" }),
      SupportTicket.countDocuments({ status: { $in: ["open", "in_progress"] } }),
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
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          staff: [
            { $match: { roles: { $in: ["super_admin_vendor", "admin_pawn_limited", "management", "loan_officer_approval", "loan_officer_processor", "call_centre_support"] } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
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
          active_loans: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          overdue_loans: { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] } },
          redeemed_loans: { $sum: { $cond: [{ $eq: ["$status", "redeemed"] }, 1, 0] } },
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
            date: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
            status: "$status",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ];

    const results = await LoanApplication.aggregate(pipeline);

    // Organize by status
    const statuses = ["submitted", "approved", "rejected", "processing", "cancelled"];
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

    // Expenses? Not directly tracked; maybe from bid payments refunds, etc.
    // For simplicity, we'll just report revenue streams.

    return {
      interest_income: interestIncome?.interest || 0,
      principal_collected: interestIncome?.principal || 0,
      storage_fees: interestIncome?.storage || 0,
      penalty_fees: interestIncome?.penalty || 0,
      auction_revenue: auctionRevenue?.total || 0,
      // total_revenue = interest + storage + penalty + auction_revenue
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
   * Recent activities (last N events from various collections).
   */
  async _getRecentActivities(limit = 10) {
    // Combine recent documents from multiple collections with a common structure.
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
      });
    });

    // Recent loan applications
    const recentApps = await LoanApplication.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("customer_user", "first_name last_name")
      .lean();
    recentApps.forEach((a) => {
      activities.push({
        type: "loan_application",
        description: `${a.customer_user?.first_name} ${a.customer_user?.last_name} applied for loan ${a.application_no}`,
        timestamp: a.created_at,
        application: a._id,
      });
    });

    // Recent loans
    const recentLoans = await Loan.find()
      .sort({ created_at: -1 })
      .limit(5)
      .populate("customer_user", "first_name last_name")
      .lean();
    recentLoans.forEach((l) => {
      activities.push({
        type: "loan_created",
        description: `Loan ${l.loan_no} created for ${l.customer_user?.first_name} ${l.customer_user?.last_name}`,
        timestamp: l.created_at,
        loan: l._id,
      });
    });

    // Recent payments
    const recentPayments = await Payment.find({ payment_status: "paid" })
      .sort({ paid_at: -1 })
      .limit(5)
      .populate("loan", "loan_no")
      .lean();
    recentPayments.forEach((p) => {
      activities.push({
        type: "payment",
        description: `Payment of $${p.amount} received for loan ${p.loan?.loan_no}`,
        timestamp: p.paid_at,
        payment: p._id,
      });
    });

    // Recent auctions
    const recentAuctions = await Auction.find()
      .sort({ created_at: -1 })
      .limit(5)
      .lean();
    recentAuctions.forEach((a) => {
      activities.push({
        type: "auction_created",
        description: `Auction ${a.auction_no} created for asset ${a.asset}`,
        timestamp: a.created_at,
        auction: a._id,
      });
    });

    // Sort all activities by timestamp descending and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return activities.slice(0, limit);
  }
}

module.exports = new ReportService();