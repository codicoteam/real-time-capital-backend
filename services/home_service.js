const mongoose = require("mongoose");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const LoanApplication = require("../models/loanApplication.model");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Payment = require("../models/payment.model");
const SupportTicket = require("../models/supportTicket.model");
const Expense = require("../models/expense.model");

class HomeService {
  /**
   * Get home page data based on user's roles (highest priority role used).
   * @param {Object} user - Mongoose user document (from auth)
   * @returns {Promise<Object>} { success, data, message }
   */
  async getHomeData(user) {
    try {
      if (!user || !user._id) {
        throw new Error("User not authenticated");
      }

      // Role priority order (highest first)
      const rolePriority = [
        "super_admin_vendor",
        "admin_pawn_limited",
        "management",
        "loan_officer_approval",
        "loan_officer_processor",
        "call_centre_support",
        "customer",
      ];

      // Find the first role the user has (according to priority)
      const userRoles = Array.isArray(user.roles) ? user.roles : [];
      const primaryRole =
        rolePriority.find((role) => userRoles.includes(role)) || "customer";

      // Dispatch to the appropriate role method
      switch (primaryRole) {
        case "super_admin_vendor":
          return await this._getSuperAdminHomeData();
        case "admin_pawn_limited":
          return await this._getAdminHomeData();
        case "management":
          return await this._getManagementHomeData();
        case "loan_officer_approval":
          return await this._getLoanOfficerApprovalHomeData();
        case "loan_officer_processor":
          return await this._getLoanOfficerProcessorHomeData();
        case "call_centre_support":
          return await this._getCallCentreHomeData();
        case "customer":
          return await this._getCustomerHomeData(user._id);
        default:
          return await this._getCustomerHomeData(user._id);
      }
    } catch (error) {
      console.error("HomeService error:", error);
      throw new Error(`Failed to fetch home data: ${error.message}`);
    }
  }

  // ------------------- Private role-specific methods -------------------

  /**
   * Customer home data
   */
  async _getCustomerHomeData(userId) {
    const profile = await User.findById(userId)
      .select("first_name last_name profile_pic_url email phone")
      .lean();

    if (!profile) throw new Error("User not found");

    const activeAuctions = await Auction.find({ status: "live" })
      .sort({ starts_at: -1 })
      .limit(3)
      .lean();

    const latestBid = await Bid.findOne({ bidder_user: userId })
      .sort({ placed_at: -1 })
      .lean();

    const loanApplications = await LoanApplication.find({
      customer_user: userId,
    })
      .sort({ created_at: -1 })
      .limit(2)
      .lean();

    const loans = await Loan.find({ customer_user: userId })
      .sort({ created_at: -1 })
      .limit(2)
      .lean();

    return {
      success: true,
      data: {
        profile: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          profile_pic_url: profile.profile_pic_url || null,
          email: profile.email,
          phone: profile.phone,
        },
        active_auctions: activeAuctions,
        latest_bid: latestBid || null,
        latest_loan_applications: loanApplications,
        latest_loans: loans,
      },
      message: "Customer home data retrieved",
    };
  }

  /**
   * Super Admin / Vendor home data
   */
  async _getSuperAdminHomeData() {
    const [
      totalCustomers,
      totalLoans,
      totalPendingApplications,
      totalActiveAuctions,
      totalOpenTickets,
      recentExpenses,
      totalExpenseAmount,
    ] = await Promise.all([
      User.countDocuments({ roles: "customer" }),
      Loan.countDocuments(),
      LoanApplication.countDocuments({ status: "submitted" }),
      Auction.countDocuments({ status: "live" }),
      SupportTicket.countDocuments({ status: "open" }),
      Expense.find()
        .sort({ expense_date: -1, created_at: -1 })
        .limit(5)
        .populate("created_by", "first_name last_name")
        .populate("approved_by", "first_name last_name")
        .lean(),
      Expense.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const pendingApplications = await LoanApplication.find({
      status: "submitted",
    })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const activeAuctions = await Auction.find({ status: "live" })
      .sort({ starts_at: -1 })
      .limit(3)
      .lean();

    const recentPayments = await Payment.find()
      .sort({ paid_at: -1 })
      .limit(3)
      .populate("loan", "loan_no")
      .lean();

    const recentCustomers = await User.find({ roles: "customer" })
      .sort({ created_at: -1 })
      .limit(3)
      .select("first_name last_name email created_at")
      .lean();

    const openTickets = await SupportTicket.find({ status: "open" })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    return {
      success: true,
      data: {
        counts: {
          total_customers: totalCustomers,
          total_loans: totalLoans,
          pending_applications: totalPendingApplications,
          active_auctions: totalActiveAuctions,
          open_tickets: totalOpenTickets,
        },
        expenses: {
          recent: recentExpenses,
          total_amount: totalExpenseAmount[0]?.total || 0,
        },
        pending_applications: pendingApplications,
        active_auctions: activeAuctions,
        recent_payments: recentPayments,
        recent_customers: recentCustomers,
        open_tickets: openTickets,
      },
      message: "Super admin home data retrieved",
    };
  }

  /**
   * Admin Pawn Limited (same as super admin for now)
   */
  async _getAdminHomeData() {
    return this._getSuperAdminHomeData();
  }

  /**
   * Management home data
   */
  async _getManagementHomeData() {
    const [totalLoanBook, activeLoans, overdueLoans, pendingApplications] =
      await Promise.all([
        Loan.aggregate([
          { $group: { _id: null, total: { $sum: "$current_balance" } } },
        ]),
        Loan.countDocuments({ status: "active" }),
        Loan.countDocuments({ status: "overdue" }),
        LoanApplication.countDocuments({ status: "submitted" }),
      ]);

    const recentApplications = await LoanApplication.find()
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const activeAuctions = await Auction.find({ status: "live" })
      .sort({ starts_at: -1 })
      .limit(3)
      .lean();

    const recentPayments = await Payment.find()
      .sort({ paid_at: -1 })
      .limit(3)
      .populate("loan", "loan_no")
      .lean();

    return {
      success: true,
      data: {
        metrics: {
          total_loan_book: totalLoanBook[0]?.total || 0,
          active_loans: activeLoans,
          overdue_loans: overdueLoans,
          pending_applications: pendingApplications,
        },
        recent_applications: recentApplications,
        active_auctions: activeAuctions,
        recent_payments: recentPayments,
      },
      message: "Management home data retrieved",
    };
  }

  /**
   * Loan Officer Approval home data
   * (No user filtering – sees all items)
   */
  async _getLoanOfficerApprovalHomeData() {
    const readyForApproval = await LoanApplication.find({
      status: "processing",
    })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const recentApprovedLoans = await Loan.find({ status: "active" })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const activeLoans = await Loan.find({
      status: "active",
      due_date: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    })
      .sort({ due_date: 1 })
      .limit(3)
      .lean();

    return {
      success: true,
      data: {
        ready_for_approval: readyForApproval,
        recent_approved_loans: recentApprovedLoans,
        active_loans_due_soon: activeLoans,
      },
      message: "Loan officer approval home data retrieved",
    };
  }

  /**
   * Loan Officer Processor home data
   * (Now sees all pending applications, all processed loans, all assets pending valuation)
   */
  async _getLoanOfficerProcessorHomeData() {
    const pendingApplications = await LoanApplication.find({
      status: "submitted",
    })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    // Removed processed_by filter – now shows all processed loans
    const recentProcessedLoans = await Loan.find()
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const assetsPendingValuation = await Asset.find({ status: "valuating" })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    return {
      success: true,
      data: {
        pending_applications: pendingApplications,
        recent_processed_loans: recentProcessedLoans,
        assets_pending_valuation: assetsPendingValuation,
      },
      message: "Loan officer processor home data retrieved",
    };
  }

  /**
   * Call Centre Support home data
   * (Now sees all open tickets, not just assigned)
   */
  async _getCallCentreHomeData() {
    // Now shows all open tickets, regardless of assignment
    const openTickets = await SupportTicket.find({ status: "open" })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const unassignedTickets = await SupportTicket.find({
      status: "open",
      assigned_to: { $exists: false },
    })
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const recentApplications = await LoanApplication.find()
      .sort({ created_at: -1 })
      .limit(3)
      .lean();

    const activeAuctions = await Auction.find({ status: "live" })
      .sort({ starts_at: -1 })
      .limit(3)
      .lean();

    return {
      success: true,
      data: {
        open_tickets: openTickets, // renamed from my_open_tickets
        unassigned_tickets: unassignedTickets,
        recent_applications: recentApplications,
        active_auctions: activeAuctions,
      },
      message: "Call centre home data retrieved",
    };
  }
}

module.exports = new HomeService();
