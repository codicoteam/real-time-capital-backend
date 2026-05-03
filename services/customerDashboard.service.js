const mongoose = require("mongoose");

const Asset = require("../models/asset.model");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const BidPayment = require("../models/bidPayment.model");
const DebtorRecord = require("../models/debtorRecord.model");
const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const LoanTerm = require("../models/loanTerm.model");
const Notification = require("../models/notifications_model");
const Payment = require("../models/payment.model");
const User = require("../models/user.model");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Group an array of documents by calendar month.
 * @param {Array}  docs       - lean Mongoose documents
 * @param {string} dateField  - field name holding the date
 * @param {string} valueField - field name to sum (omit for count-only)
 * @returns {Array<{ month: string, count: number, total: number }>}
 */
function groupByMonth(docs, dateField, valueField = null) {
  const map = {};
  docs.forEach((doc) => {
    const raw = doc[dateField];
    if (!raw) return;
    const d = new Date(raw);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map[key]) map[key] = { month: key, count: 0, total: 0 };
    map[key].count += 1;
    if (valueField) map[key].total += doc[valueField] || 0;
  });
  return Object.values(map).sort((a, b) => (a.month > b.month ? 1 : -1));
}

/**
 * Build a single recent-activity entry.
 */
function activity(category, action, ref_no, ref_id, date, meta = {}) {
  return {
    category,
    action,
    ref_no: ref_no || null,
    ref_id: ref_id || null,
    date,
    ...meta,
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

class CustomerDashboardService {
  /**
   * Get the complete dashboard for a single customer.
   *
   * Response shape
   * ─────────────
   * {
   *   success          : boolean
   *   message          : string
   *   data: {
   *     profile              – full User document (OTP/secret fields stripped)
   *     summary              – KPI cards
   *     recent_activity      – last 20 events across all entities (newest first)
   *     loans                – all loans (populated)
   *     loan_applications    – all applications
   *     assets               – all assets (populated)
   *     auctions             – auctions the user participated in (populated)
   *     bids                 – all bids
   *     bid_payments         – all bid payments
   *     loan_payments        – all loan payments
   *     notifications        – all notifications addressed to this user
   *     debtor_records       – debtor-list matches (if any)
   *     reports: {
   *       loan_report
   *       auction_report
   *       payment_report
   *       application_report
   *       asset_report
   *       notification_report
   *     }
   *     graphs: {
   *       loan_balance_history
   *       loan_payments_over_time
   *       bid_payments_over_time
   *       combined_payments_over_time
   *       bids_over_time
   *       applications_over_time
   *       application_status_breakdown
   *       auction_performance
   *       asset_status_breakdown
   *       loan_status_breakdown
   *       notification_type_breakdown
   *     }
   *   }
   * }
   *
   * @param {string} userId
   * @returns {Promise<Object>}
   */
  async getCustomerDashboard(userId) {
    try {
      // ── Validation ────────────────────────────────────────────────────────
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Invalid user ID");
      }

      const uid = new mongoose.Types.ObjectId(userId);

      // ── 1. Full User Profile (sensitive OTP / hash fields stripped) ───────
      const profile = await User.findById(uid)
        .select(
          "-password_hash" +
            " -email_verification_otp -email_verification_expires_at" +
            " -reset_password_otp -reset_password_expires_at" +
            " -delete_account_otp -delete_account_otp_expires_at",
        )
        .lean();
      if (!profile) throw new Error("User not found");

      // ── 2. Assets ──────────────────────────────────────────────────────────
      const assets = await Asset.find({ owner_user: uid })
        .populate("evaluated_by", "first_name last_name email")
        .lean();

      // ── 3. Bids placed by user ─────────────────────────────────────────────
      const bids = await Bid.find({ bidder_user: uid })
        .sort({ placed_at: -1 })
        .lean();

      // ── 4. Auctions the user participated in ──────────────────────────────
      const auctionIds = [
        ...new Set(bids.map((b) => b.auction?.toString()).filter(Boolean)),
      ];
      const auctions = await Auction.find({ _id: { $in: auctionIds } })
        .populate("asset", "title category asset_no asset_images status")
        .lean();

      // ── 5. Bid payments ────────────────────────────────────────────────────
      const bidIds = bids.map((b) => b._id);
      const bidPayments = await BidPayment.find({ bid: { $in: bidIds } })
        .sort({ created_at: -1 })
        .lean();

      // ── 6. Loans ───────────────────────────────────────────────────────────
      const loans = await Loan.find({ customer_user: uid })
        .populate("asset", "title category asset_no status evaluated_value")
        .populate("approved_by", "first_name last_name email")
        .populate("disbursed_by", "first_name last_name email")
        .sort({ created_at: -1 })
        .lean();

      const loanIds = loans.map((l) => l._id);

      // ── 7. Loan payments ───────────────────────────────────────────────────
      const loanPayments = await Payment.find({ loan: { $in: loanIds } })
        .sort({ payment_date: -1 })
        .lean();

      // ── 8. Loan applications ───────────────────────────────────────────────
      const loanApplications = await LoanApplication.find({
        customer_user: uid,
      })
        .sort({ created_at: -1 })
        .lean();

      // ── 9. Loan term history ───────────────────────────────────────────────
      const loanTerms = await LoanTerm.find({ loan: { $in: loanIds } })
        .sort({ start_date: 1 })
        .lean();

      // ── 10. Debtor records ─────────────────────────────────────────────────
      const debtorRecords = await DebtorRecord.find({
        matched_user: uid,
      }).lean();

      // ── 11. Notifications (all scopes that include this user) ──────────────
      const notifications = await Notification.find({
        $or: [
          { "audience.scope": "all" },
          { "audience.scope": "user", "audience.user_id": uid },
          { "audience.scope": "users", "audience.user_ids": uid },
          {
            "audience.scope": "roles",
            "audience.roles": { $in: profile.roles },
          },
        ],
      })
        .sort({ created_at: -1 })
        .lean();

      // ── Derived buckets & aggregates ───────────────────────────────────────
      const now = new Date();

      const loansActive = loans.filter((l) => l.status === "active");
      const loansOverdue = loans.filter((l) => l.status === "overdue");
      const loansRedeemed = loans.filter((l) => l.status === "redeemed");
      const loansDefaulted = loans.filter((l) => l.status === "defaulted");
      const loansDraft = loans.filter((l) => l.status === "draft");

      const wonAuctions = auctions.filter(
        (a) => a.winner_user?.toString() === userId,
      );
      const lostAuctions = auctions.filter(
        (a) => a.winner_user && a.winner_user.toString() !== userId,
      );
      const pendingAuctions = auctions.filter((a) => a.status === "live");

      const totalLoanPaymentsAmount = loanPayments.reduce(
        (s, p) => s + (p.amount || 0),
        0,
      );
      const totalBidPaymentsAmount = bidPayments.reduce(
        (s, p) => s + (p.amount || 0),
        0,
      );
      const totalMoneyTransacted =
        totalLoanPaymentsAmount + totalBidPaymentsAmount;

      const totalOutstandingBalance = loans
        .filter(
          (l) => !["redeemed", "cancelled", "written_off"].includes(l.status),
        )
        .reduce((s, l) => s + (l.current_balance || 0), 0);

      const totalPrincipalBorrowed = loans.reduce(
        (s, l) => s + (l.principal_amount || 0),
        0,
      );

      // Credit score  (700 base)
      let creditScore = 700;
      loans.forEach((l) => {
        if (l.status === "overdue") creditScore -= 30;
        if (l.status === "defaulted") creditScore -= 50;
        if (
          l.due_date &&
          new Date(l.due_date) < now &&
          !["redeemed", "closed", "cancelled"].includes(l.status)
        )
          creditScore -= 20;
      });
      creditScore += loansRedeemed.length * 15;
      creditScore += loanPayments.length * 2;
      creditScore = Math.min(850, Math.max(300, creditScore));

      const unreadNotifications = notifications.filter(
        (n) =>
          !n.acknowledgements?.some(
            (a) => a.user_id?.toString() === userId && a.read_at,
          ),
      ).length;

      // ── SUMMARY ────────────────────────────────────────────────────────────
      const summary = {
        // Credit
        credit_score: creditScore,
        credit_rating:
          creditScore >= 750
            ? "Excellent"
            : creditScore >= 700
              ? "Good"
              : creditScore >= 650
                ? "Fair"
                : "Poor",

        // Loans
        total_loans: loans.length,
        active_loans: loansActive.length,
        overdue_loans: loansOverdue.length,
        redeemed_loans: loansRedeemed.length,
        defaulted_loans: loansDefaulted.length,
        draft_loans: loansDraft.length,
        total_principal_borrowed: totalPrincipalBorrowed,
        total_outstanding_balance: totalOutstandingBalance,
        total_loan_payments_made: totalLoanPaymentsAmount,

        // Applications
        total_applications: loanApplications.length,
        pending_applications: loanApplications.filter((a) =>
          ["submitted", "processing"].includes(a.status),
        ).length,
        approved_applications: loanApplications.filter(
          (a) => a.status === "approved",
        ).length,
        rejected_applications: loanApplications.filter(
          (a) => a.status === "rejected",
        ).length,

        // Assets
        total_assets: assets.length,
        assets_pawned: assets.filter((a) =>
          ["pawned", "active"].includes(a.status),
        ).length,
        assets_in_auction: assets.filter((a) => a.status === "auction").length,
        assets_redeemed: assets.filter((a) => a.status === "redeemed").length,

        // Auctions & bids
        auctions_participated: auctionIds.length,
        auctions_won: wonAuctions.length,
        auctions_lost: lostAuctions.length,
        total_bids_placed: bids.length,
        paid_bids: bids.filter((b) => b.payment_status === "paid").length,
        win_rate:
          auctionIds.length > 0
            ? parseFloat((wonAuctions.length / auctionIds.length).toFixed(2))
            : 0,
        total_bid_payments_made: totalBidPaymentsAmount,

        // Financial
        total_money_transacted: totalMoneyTransacted,

        // Account
        kyc_status: profile.kyc_verification_status,
        account_status: profile.status,
        unread_notifications: unreadNotifications,
        is_flagged_as_debtor: debtorRecords.length > 0,
        debtor_record_count: debtorRecords.length,
      };

      // ── RECENT ACTIVITY ────────────────────────────────────────────────────
      const activityFeed = [];

      loanApplications.slice(0, 5).forEach((app) =>
        activityFeed.push(
          activity(
            "loan_application",
            `Loan application ${app.status}`,
            app.application_no,
            app._id,
            app.updated_at || app.created_at,
            {
              status: app.status,
              requested_amount: app.requested_loan_amount,
              collateral_category: app.collateral_category,
            },
          ),
        ),
      );

      loans.slice(0, 5).forEach((loan) =>
        activityFeed.push(
          activity(
            "loan",
            `Loan ${loan.status}`,
            loan.loan_no,
            loan._id,
            loan.updated_at || loan.created_at,
            {
              status: loan.status,
              principal_amount: loan.principal_amount,
              current_balance: loan.current_balance,
              due_date: loan.due_date,
            },
          ),
        ),
      );

      loanPayments
        .slice(0, 5)
        .forEach((pay) =>
          activityFeed.push(
            activity(
              "loan_payment",
              "Loan repayment made",
              pay.reference_no,
              pay._id,
              pay.payment_date || pay.created_at,
              { amount: pay.amount, payment_method: pay.payment_method },
            ),
          ),
        );

      bids
        .slice(0, 5)
        .forEach((bid) =>
          activityFeed.push(
            activity(
              "bid",
              "Bid placed on auction",
              null,
              bid._id,
              bid.placed_at || bid.created_at,
              {
                bid_amount: bid.bid_amount,
                payment_status: bid.payment_status,
              },
            ),
          ),
        );

      bidPayments
        .slice(0, 5)
        .forEach((pay) =>
          activityFeed.push(
            activity(
              "bid_payment",
              "Bid payment made",
              pay.reference_no,
              pay._id,
              pay.paid_at || pay.created_at,
              { amount: pay.amount },
            ),
          ),
        );

      notifications.slice(0, 5).forEach((n) =>
        activityFeed.push(
          activity("notification", n.title, null, n._id, n.created_at, {
            type: n.type,
            priority: n.priority,
            read:
              n.acknowledgements?.some(
                (a) => a.user_id?.toString() === userId && a.read_at,
              ) || false,
          }),
        ),
      );

      // Sort newest first; keep top 20
      activityFeed.sort((a, b) => new Date(b.date) - new Date(a.date));
      const recentActivity = activityFeed.slice(0, 20);

      // ── REPORTS ────────────────────────────────────────────────────────────

      // Loan Report
      const loanReport = {
        total: loans.length,
        by_status: loans.reduce((acc, l) => {
          acc[l.status] = (acc[l.status] || 0) + 1;
          return acc;
        }, {}),
        by_collateral_category: loans.reduce((acc, l) => {
          acc[l.collateral_category] = (acc[l.collateral_category] || 0) + 1;
          return acc;
        }, {}),
        financials: {
          total_principal_borrowed: totalPrincipalBorrowed,
          total_outstanding_balance: totalOutstandingBalance,
          total_repaid: totalLoanPaymentsAmount,
          repayment_rate:
            totalPrincipalBorrowed > 0
              ? parseFloat(
                  (totalLoanPaymentsAmount / totalPrincipalBorrowed).toFixed(4),
                )
              : 0,
        },
        overdue_detail: loansOverdue.map((l) => ({
          loan_id: l._id,
          loan_no: l.loan_no,
          due_date: l.due_date,
          current_balance: l.current_balance,
          days_overdue: Math.floor(
            (now - new Date(l.due_date)) / (1000 * 60 * 60 * 24),
          ),
        })),
        loans_pending_approval: loans.filter(
          (l) =>
            l.requires_super_admin_approval && l.approval_status === "pending",
        ).length,
        loan_payment_history: loanPayments.map((p) => ({
          payment_id: p._id,
          loan_id: p.loan,
          amount: p.amount,
          payment_method: p.payment_method,
          reference_no: p.reference_no,
          payment_date: p.payment_date,
          received_by: p.received_by,
        })),
        loans: loans.map((l) => ({
          loan_id: l._id,
          loan_no: l.loan_no,
          status: l.status,
          principal_amount: l.principal_amount,
          current_balance: l.current_balance,
          total_paid: l.total_paid,
          interest_rate: l.interest_rate_percent,
          repayment_type: l.repayment_type,
          start_date: l.start_date,
          due_date: l.due_date,
          disbursement_date: l.disbursement_date,
          collateral_category: l.collateral_category,
          asset: l.asset,
        })),
      };

      // Auction / Bid Report
      const auctionReport = {
        auctions_participated: auctionIds.length,
        auctions_won: wonAuctions.length,
        auctions_lost: lostAuctions.length,
        auctions_live: pendingAuctions.length,
        win_rate: summary.win_rate,
        total_bids: bids.length,
        paid_bids: summary.paid_bids,
        unpaid_bids: bids.filter((b) => b.payment_status !== "paid").length,
        total_bid_amount_placed: bids.reduce(
          (s, b) => s + (b.bid_amount || 0),
          0,
        ),
        total_bid_payments_made: totalBidPaymentsAmount,
        won_auctions_detail: wonAuctions.map((a) => ({
          auction_id: a._id,
          auction_no: a.auction_no,
          asset: a.asset,
          winning_bid_amount: a.winning_bid_amount,
          ends_at: a.ends_at,
        })),
        bid_history: bids.map((b) => ({
          bid_id: b._id,
          auction_id: b.auction,
          bid_amount: b.bid_amount,
          placed_at: b.placed_at,
          payment_status: b.payment_status,
        })),
      };

      // Payment Report
      const paymentReport = {
        loan_payments: {
          count: loanPayments.length,
          total_amount: totalLoanPaymentsAmount,
          by_method: loanPayments.reduce((acc, p) => {
            acc[p.payment_method] =
              (acc[p.payment_method] || 0) + (p.amount || 0);
            return acc;
          }, {}),
          largest_payment: loanPayments.reduce(
            (max, p) => (p.amount > max ? p.amount : max),
            0,
          ),
          latest_payment: loanPayments[0] || null,
        },
        bid_payments: {
          count: bidPayments.length,
          total_amount: totalBidPaymentsAmount,
          latest_payment: bidPayments[0] || null,
        },
        combined_total: totalMoneyTransacted,
      };

      // Application Report
      const totalRequestedAmount = loanApplications.reduce(
        (s, a) => s + (a.requested_loan_amount || 0),
        0,
      );
      const applicationReport = {
        total: loanApplications.length,
        by_status: loanApplications.reduce((acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        }, {}),
        by_collateral_category: loanApplications.reduce((acc, a) => {
          acc[a.collateral_category] = (acc[a.collateral_category] || 0) + 1;
          return acc;
        }, {}),
        by_source: loanApplications.reduce((acc, a) => {
          acc[a.application_source] = (acc[a.application_source] || 0) + 1;
          return acc;
        }, {}),
        total_requested_amount: totalRequestedAmount,
        average_requested_amount:
          loanApplications.length > 0
            ? parseFloat(
                (totalRequestedAmount / loanApplications.length).toFixed(2),
              )
            : 0,
        debtor_flagged_applications: loanApplications.filter(
          (a) => a.debtor_check?.matched,
        ).length,
        applications: loanApplications.map((a) => ({
          application_id: a._id,
          application_no: a.application_no,
          status: a.status,
          requested_amount: a.requested_loan_amount,
          collateral_category: a.collateral_category,
          repayment_type: a.repayment_type,
          application_source: a.application_source,
          debtor_check: a.debtor_check,
          created_at: a.created_at,
          updated_at: a.updated_at,
        })),
      };

      // Asset Report
      const assetReport = {
        total: assets.length,
        by_status: assets.reduce((acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        }, {}),
        by_category: assets.reduce((acc, a) => {
          acc[a.category] = (acc[a.category] || 0) + 1;
          return acc;
        }, {}),
        total_declared_value: assets.reduce(
          (s, a) => s + (a.declared_value || 0),
          0,
        ),
        total_evaluated_value: assets.reduce(
          (s, a) => s + (a.evaluated_value || 0),
          0,
        ),
        assets_under_valuation: assets.filter((a) => a.status === "valuating")
          .length,
        assets_in_auction: assets.filter((a) => a.status === "auction").length,
        asset_list: assets.map((a) => ({
          asset_id: a._id,
          asset_no: a.asset_no,
          title: a.title,
          category: a.category,
          status: a.status,
          declared_value: a.declared_value,
          evaluated_value: a.evaluated_value,
          storage_location: a.storage_location,
          asset_images: a.asset_images,
          active_loan: a.active_loan,
        })),
      };

      // Notification Report
      const notificationReport = {
        total: notifications.length,
        unread: unreadNotifications,
        read: notifications.length - unreadNotifications,
        by_type: notifications.reduce((acc, n) => {
          acc[n.type] = (acc[n.type] || 0) + 1;
          return acc;
        }, {}),
        by_priority: notifications.reduce((acc, n) => {
          acc[n.priority] = (acc[n.priority] || 0) + 1;
          return acc;
        }, {}),
        critical_unread: notifications.filter(
          (n) =>
            n.priority === "critical" &&
            !n.acknowledgements?.some(
              (a) => a.user_id?.toString() === userId && a.read_at,
            ),
        ).length,
        recent: notifications.slice(0, 10).map((n) => ({
          notification_id: n._id,
          title: n.title,
          message: n.message,
          type: n.type,
          priority: n.priority,
          status: n.status,
          channels: n.channels,
          entity_type: n.entity_type,
          entity_id: n.entity_id,
          action_text: n.action_text,
          action_url: n.action_url,
          sent_at: n.sent_at,
          created_at: n.created_at,
          read:
            n.acknowledgements?.some(
              (a) => a.user_id?.toString() === userId && a.read_at,
            ) || false,
        })),
      };

      // ── GRAPHS ─────────────────────────────────────────────────────────────

      // Loan balance history (from LoanTerm snapshots)
      const loanBalanceHistory = loanTerms.map((term) => ({
        date: term.start_date,
        balance: term.closing_balance,
        loan_id: term.loan,
      }));

      // Loan payments over time (monthly)
      const loanPaymentsOverTime = groupByMonth(
        loanPayments,
        "payment_date",
        "amount",
      ).map(({ month, count, total }) => ({
        month,
        count,
        total_amount: total,
      }));

      // Bid payments over time (monthly)
      const bidPaymentsOverTime = groupByMonth(
        bidPayments,
        "created_at",
        "amount",
      ).map(({ month, count, total }) => ({
        month,
        count,
        total_amount: total,
      }));

      // Combined payments over time (loan + bid, broken out)
      const combinedPaymentsByMonth = {};
      [
        ...loanPayments.map((p) => ({
          ...p,
          _src: "loan",
          _date: p.payment_date || p.created_at,
        })),
        ...bidPayments.map((p) => ({
          ...p,
          _src: "bid",
          _date: p.paid_at || p.created_at,
        })),
      ].forEach((p) => {
        const d = new Date(p._date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (!combinedPaymentsByMonth[key])
          combinedPaymentsByMonth[key] = {
            month: key,
            loan_total: 0,
            bid_total: 0,
            combined_total: 0,
            count: 0,
          };
        combinedPaymentsByMonth[key].count += 1;
        combinedPaymentsByMonth[key].combined_total += p.amount || 0;
        if (p._src === "loan")
          combinedPaymentsByMonth[key].loan_total += p.amount || 0;
        else combinedPaymentsByMonth[key].bid_total += p.amount || 0;
      });
      const combinedPaymentsOverTime = Object.values(
        combinedPaymentsByMonth,
      ).sort((a, b) => (a.month > b.month ? 1 : -1));

      // Bids over time (monthly count)
      const bidsOverTime = groupByMonth(bids, "placed_at").map(
        ({ month, count }) => ({
          month,
          count,
        }),
      );

      // Applications over time (monthly count)
      const applicationsOverTime = groupByMonth(
        loanApplications,
        "created_at",
      ).map(({ month, count }) => ({ month, count }));

      // Application status breakdown (pie)
      const applicationStatusBreakdown = Object.entries(
        loanApplications.reduce((acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        }, {}),
      ).map(([status, count]) => ({ status, count }));

      // Auction performance
      const auctionPerformance = {
        participated: auctionIds.length,
        won: wonAuctions.length,
        lost: lostAuctions.length,
        live: pendingAuctions.length,
        win_rate_percent:
          auctionIds.length > 0
            ? parseFloat(
                ((wonAuctions.length / auctionIds.length) * 100).toFixed(1),
              )
            : 0,
      };

      // Asset status breakdown (pie)
      const assetStatusBreakdown = Object.entries(
        assets.reduce((acc, a) => {
          acc[a.status] = (acc[a.status] || 0) + 1;
          return acc;
        }, {}),
      ).map(([status, count]) => ({ status, count }));

      // Loan status breakdown (pie)
      const loanStatusBreakdown = Object.entries(
        loans.reduce((acc, l) => {
          acc[l.status] = (acc[l.status] || 0) + 1;
          return acc;
        }, {}),
      ).map(([status, count]) => ({ status, count }));

      // Notification type breakdown
      const notificationTypeBreakdown = Object.entries(
        notifications.reduce((acc, n) => {
          acc[n.type] = (acc[n.type] || 0) + 1;
          return acc;
        }, {}),
      ).map(([type, count]) => ({ type, count }));

      // ── Build final response ───────────────────────────────────────────────
      return {
        success: true,
        message: "Customer dashboard data retrieved successfully",
        data: {
          // Full user profile (OTP / hash fields stripped)
          profile,

          // KPI summary cards
          summary,

          // Chronological activity feed (newest first, max 20)
          recent_activity: recentActivity,

          // Raw entity data (for detail views / tables)
          loans,
          loan_applications: loanApplications,
          assets,
          auctions,
          bids,
          bid_payments: bidPayments,
          loan_payments: loanPayments,
          notifications,
          debtor_records: debtorRecords,

          // Aggregated reports
          reports: {
            loan_report: loanReport,
            auction_report: auctionReport,
            payment_report: paymentReport,
            application_report: applicationReport,
            asset_report: assetReport,
            notification_report: notificationReport,
          },

          // Chart / graph data
          graphs: {
            loan_balance_history: loanBalanceHistory,
            loan_payments_over_time: loanPaymentsOverTime,
            bid_payments_over_time: bidPaymentsOverTime,
            combined_payments_over_time: combinedPaymentsOverTime,
            bids_over_time: bidsOverTime,
            applications_over_time: applicationsOverTime,
            application_status_breakdown: applicationStatusBreakdown,
            auction_performance: auctionPerformance,
            asset_status_breakdown: assetStatusBreakdown,
            loan_status_breakdown: loanStatusBreakdown,
            notification_type_breakdown: notificationTypeBreakdown,
          },
        },
      };
    } catch (error) {
      console.error(
        "CustomerDashboardService.getCustomerDashboard error:",
        error,
      );
      throw new Error(`Failed to fetch dashboard data: ${error.message}`);
    }
  }
}

module.exports = new CustomerDashboardService();
