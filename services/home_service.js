const mongoose = require("mongoose");
const Auction = require("../models/auction.model");
const Bid = require("../models/bid.model");
const LoanApplication = require("../models/loanApplication.model");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");

class HomeService {
  /**
   * Get home page data for a customer.
   * @param {string} userId - ID of the logged-in customer
   * @returns {Promise<Object>} { success, data, message }
   */
  async getCustomerHomeData(userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw new Error("Invalid user ID");
      }

      // 1. Profile summary (minimal fields)
      const profile = await User.findById(userId)
        .select("first_name last_name profile_pic_url email phone")
        .lean();

      if (!profile) {
        throw new Error("User not found");
      }

      // 2. Active auctions – latest 5, all fields
      const activeAuctions = await Auction.find({ status: "live" })
        .sort({ starts_at: -1 })
        .limit(5)
        .lean();

      // 3. Latest bid by the customer – all fields
      const latestBid = await Bid.findOne({ bidder_user: userId })
        .sort({ placed_at: -1 })
        .lean();

      // 4. Two most recent loan applications – all fields
      const loanApplications = await LoanApplication.find({
        customer_user: userId,
      })
        .sort({ created_at: -1 })
        .limit(2)
        .lean();

      // 5. Two most recent loans – all fields
      const loans = await Loan.find({
        customer_user: userId,
      })
        .sort({ created_at: -1 })
        .limit(2)
        .lean();

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
          },
          active_auctions: activeAuctions,
          latest_bid: latestBid || null,
          latest_loan_applications: loanApplications,
          latest_loans: loans, // added
        },
        message: "Home data retrieved successfully",
      };
    } catch (error) {
      console.error("HomeService error:", error);
      throw new Error(`Failed to fetch home data: ${error.message}`);
    }
  }
}

module.exports = new HomeService();
