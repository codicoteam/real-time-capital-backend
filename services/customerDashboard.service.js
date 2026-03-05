const mongoose = require("mongoose");
const Asset = require("../models/asset.model");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const BidPayment = require("../models/bidPayment.model");
const DebtorRecord = require("../models/debtorRecord.model");
const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const Payment = require("../models/payment.model");
const User = require("../models/user.model");

class CustomerDashboardService {
  /**
   * Get full dashboard data for a customer.
   * @param {string} userId - ID of the logged-in customer
   * @returns {Promise<Object>} { success, data, message }
   */
  async getCustomerDashboard(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Invalid user ID");
      }

      // 1. Profile
      const profile = await User.findById(userId)
        .select(
          "first_name last_name profile_pic_url email phone national_id_number date_of_birth address",
        )
        .lean();
      if (!profile) throw new Error("User not found");

      // 2. All assets owned by user
      const assets = await Asset.find({ owner_user: userId }).lean();

      // 3. All auctions the user participated in (via bids)
      const userBids = await Bid.find({ bidder_user: userId }).lean();
      const auctionIds = [
        ...new Set(userBids.map((b) => b.auction.toString())),
      ];
      const auctions = await Auction.find({ _id: { $in: auctionIds } }).lean();

      // 4. All bids by user
      const bids = userBids;

      // 5. All bid payments for user's bids
      const bidIds = bids.map((b) => b._id);
      const bidPayments = await BidPayment.find({
        bid: { $in: bidIds },
      }).lean();

      // 6. Debtor records linked to this user (if any)
      const debtorRecords = await DebtorRecord.find({
        matched_user: userId,
      }).lean();

      // 7. All loans for this user
      const loans = await Loan.find({ customer_user: userId }).lean();

      // 8. All loan applications for this user
      const loanApplications = await LoanApplication.find({
        customer_user: userId,
      }).lean();

      // 9. All loan payments for user's loans
      const loanIds = loans.map((l) => l._id);
      const loanPayments = await Payment.find({
        loan: { $in: loanIds },
      }).lean();

      // ---------- Metrics ----------
      // Total money brought into business = sum of all loan payments + sum of all bid payments
      const totalLoanPayments = loanPayments.reduce(
        (sum, p) => sum + (p.amount || 0),
        0,
      );
      const totalBidPayments = bidPayments.reduce(
        (sum, p) => sum + (p.amount || 0),
        0,
      );
      const totalMoneyBrought = totalLoanPayments + totalBidPayments;

      // Number of auctions participated (distinct auctions)
      const auctionsParticipated = auctionIds.length;

      // Number of bids
      const totalBids = bids.length;

      // Number of paid bids (payment_status = 'paid')
      const paidBids = bids.filter((b) => b.payment_status === "paid").length;

      // Odds to win auction: (number of winning bids) / (auctions participated)
      // A winning bid is where the user is the winner_user in the auction
      const wonAuctions = auctions.filter(
        (a) => a.winner_user && a.winner_user.toString() === userId,
      ).length;
      const winOdds =
        auctionsParticipated > 0 ? wonAuctions / auctionsParticipated : 0;

      // Number of loans (total)
      const totalLoans = loans.length;

      // Number of loan applications (total)
      const totalApplications = loanApplications.length;

      // Credit score (simple model based on payment history)
      // For demo: start at 700, deduct for overdue loans, add for on-time payments
      let creditScore = 700;
      const now = new Date();
      loans.forEach((loan) => {
        if (loan.status === "overdue") creditScore -= 30;
        if (loan.due_date && loan.due_date < now && loan.status !== "closed")
          creditScore -= 20;
      });
      // Add points for paid loans
      const closedLoans = loans.filter((l) => l.status === "closed").length;
      creditScore += closedLoans * 10;
      // Cap between 300 and 850
      creditScore = Math.min(850, Math.max(300, creditScore));

      // ---------- Graph Data ----------
      // 1. Loan balance history (from LoanTerm model – we need to query LoanTerm)
      const LoanTerm = require("../models/loanTerm.model");
      const loanTerms = await LoanTerm.find({ loan: { $in: loanIds } })
        .sort({ start_date: 1 })
        .lean();
      const loanBalanceHistory = loanTerms.map((term) => ({
        date: term.start_date,
        balance: term.closing_balance,
        loan_id: term.loan,
      }));

      // 2. Bids over time (monthly count)
      const bidsByMonth = {};
      bids.forEach((b) => {
        const date = new Date(b.placed_at);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        bidsByMonth[monthKey] = (bidsByMonth[monthKey] || 0) + 1;
      });
      const bidsOverTime = Object.entries(bidsByMonth).map(
        ([month, count]) => ({ month, count }),
      );

      // 3. Payments over time (monthly amount)
      const allPayments = [...loanPayments, ...bidPayments];
      const paymentsByMonth = {};
      allPayments.forEach((p) => {
        const date = new Date(p.paid_at || p.created_at);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        paymentsByMonth[monthKey] =
          (paymentsByMonth[monthKey] || 0) + (p.amount || 0);
      });
      const paymentsOverTime = Object.entries(paymentsByMonth).map(
        ([month, amount]) => ({ month, amount }),
      );

      // 4. Application status breakdown (pie chart)
      const statusCounts = {};
      loanApplications.forEach((app) => {
        const status = app.status || "unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      const applicationStatusBreakdown = Object.entries(statusCounts).map(
        ([status, count]) => ({ status, count }),
      );

      // 5. Auction performance
      const auctionPerformance = {
        participated: auctionsParticipated,
        won: wonAuctions,
        lost: auctionsParticipated - wonAuctions,
      };

      // Build response
      return {
        success: true,
        data: {
          profile: {
            first_name: profile.first_name,
            last_name: profile.last_name,
            profile_pic_url: profile.profile_pic_url || null,
            email: profile.email,
            phone: profile.phone,
            national_id_number: profile.national_id_number,
            date_of_birth: profile.date_of_birth,
            address: profile.address,
          },
          assets,
          auctions,
          bids,
          bid_payments: bidPayments,
          debtor_records: debtorRecords,
          loans,
          loan_applications: loanApplications,
          loan_payments: loanPayments,
          metrics: {
            credit_score: creditScore,
            total_money_brought: totalMoneyBrought,
            auctions_participated: auctionsParticipated,
            win_odds: parseFloat(winOdds.toFixed(2)),
            total_applications: totalApplications,
            total_bids: totalBids,
            paid_bids: paidBids,
          },
          graphs: {
            loan_balance_history: loanBalanceHistory,
            bids_over_time: bidsOverTime,
            payments_over_time: paymentsOverTime,
            application_status_breakdown: applicationStatusBreakdown,
            auction_performance: auctionPerformance,
          },
        },
        message: "Customer dashboard data retrieved successfully",
      };
    } catch (error) {
      console.error("CustomerDashboardService error:", error);
      throw new Error(`Failed to fetch dashboard data: ${error.message}`);
    }
  }
}

module.exports = new CustomerDashboardService();
