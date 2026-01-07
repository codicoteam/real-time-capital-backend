const Bid = require("../models/bid.model");
const Auction = require("../models/auction.model");
const Asset = require("../models/asset.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");

/**
 * Bid Service
 * Contains all business logic for bid management
 */
class BidService {
  /**
   * Create a new bid (already implemented in auction service)
   * This is kept for consistency but bid creation is handled in auction service
   */
  static async createBid(bidData, user) {
    try {
      // This method is maintained for API consistency
      // Actual bid creation happens through auction service
      throw new Error("Use auction service to place bids");
    } catch (error) {
      console.error("Create bid error:", error);
      throw new Error(error.message || "Failed to create bid");
    }
  }

  /**
   * Get bids with pagination and filters
   */
  static async getBids(filters = {}, pagination = {}, user) {
    try {
      const {
        page = 1,
        limit = 10,
        sort_by = "placed_at",
        sort_order = "desc",
        search
      } = pagination;

      const {
        auction_id,
        bidder_user,
        payment_status,
        dispute_status,
        min_amount,
        max_amount,
        placed_from,
        placed_to,
        created_from,
        created_to
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (auction_id) query.auction = auction_id;
      if (bidder_user) query.bidder_user = bidder_user;
      if (payment_status) query.payment_status = payment_status;
      if (dispute_status) query["dispute.status"] = dispute_status;
      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

      // Date filters
      if (placed_from || placed_to) {
        query.placed_at = {};
        if (placed_from) query.placed_at.$gte = new Date(placed_from);
        if (placed_to) query.placed_at.$lte = new Date(placed_to);
      }

      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.bidder_user = user._id; // Customers can only see their own bids
      }

      // Search functionality (by payment reference)
      if (search && search.length >= 2) {
        query.$or = [
          { payment_reference: { $regex: search, $options: "i" } }
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [bids, total] = await Promise.all([
        Bid.find(query)
          .populate({
            path: "auction",
            select: "auction_no status starts_at ends_at",
            populate: {
              path: "asset",
              select: "title category evaluated_value",
              populate: {
                path: "attachments",
                select: "filename url",
                match: { category: "asset_photos" },
                limit: 1
              }
            }
          })
          .populate("bidder_user", "name email phone")
          .populate("dispute.raised_by", "name email")
          .populate("dispute.resolved_by", "name email")
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Bid.countDocuments(query)
      ]);

      return {
        success: true,
        data: {
          bids,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };
    } catch (error) {
      console.error("Get bids error:", error);
      throw new Error(error.message || "Failed to fetch bids");
    }
  }

  /**
   * Get all bids without pagination
   */
  static async getAllBids(filters = {}, user) {
    try {
      const {
        auction_id,
        bidder_user,
        payment_status,
        dispute_status,
        min_amount,
        max_amount
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (auction_id) query.auction = auction_id;
      if (bidder_user) query.bidder_user = bidder_user;
      if (payment_status) query.payment_status = payment_status;
      if (dispute_status) query["dispute.status"] = dispute_status;
      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.bidder_user = user._id;
      }

      // Execute query
      const bids = await Bid.find(query)
        .populate({
          path: "auction",
          select: "auction_no status",
          populate: {
            path: "asset",
            select: "title category",
            populate: {
              path: "attachments",
              select: "filename url",
              match: { category: "asset_photos" },
              limit: 1
            }
          }
        })
        .populate("bidder_user", "name email")
        .populate("dispute.raised_by", "name")
        .sort({ placed_at: -1 });

      return {
        success: true,
        data: bids
      };
    } catch (error) {
      console.error("Get all bids error:", error);
      throw new Error(error.message || "Failed to fetch bids");
    }
  }

  /**
   * Get bid by ID with detailed information
   */
  static async getBidById(id, user) {
    try {
      const bid = await Bid.findById(id)
        .populate({
          path: "auction",
          populate: [
            {
              path: "asset",
              populate: [
                {
                  path: "owner_user",
                  select: "name email phone"
                },
                {
                  path: "attachments",
                  select: "filename url mime_type",
                  match: { category: "asset_photos" }
                }
              ]
            },
            {
              path: "winner_user",
              select: "name email"
            }
          ]
        })
        .populate("bidder_user", "name email phone address")
        .populate("dispute.raised_by", "name email")
        .populate("dispute.resolved_by", "name email");

      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check permission
      if (user.roles.includes("customer") && 
          !bid.bidder_user._id.equals(user._id)) {
        return {
          success: false,
          message: "Access denied to this bid",
          statusCode: 403
        };
      }

      return {
        success: true,
        data: bid
      };
    } catch (error) {
      console.error("Get bid error:", error);
      throw new Error(error.message || "Failed to fetch bid");
    }
  }

  /**
   * Update bid (for staff/admin only)
   */
  static async updateBid(id, updateData, user) {
    try {
      const bid = await Bid.findById(id);
      
      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check if user can update this bid
      const canUpdate = user.roles.some(role => 
        ["loan_officer_approval", "admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
      );

      if (!canUpdate) {
        return {
          success: false,
          message: "Insufficient permissions to update bid",
          statusCode: 403
        };
      }

      // Validate payment status update
      if (updateData.payment_status) {
        const validTransitions = {
          "unpaid": ["pending", "cancelled"],
          "pending": ["paid", "failed", "cancelled"],
          "paid": ["refunded"],
          "failed": ["pending", "cancelled"],
          "refunded": [],
          "cancelled": []
        };

        if (validTransitions[bid.payment_status] && 
            !validTransitions[bid.payment_status].includes(updateData.payment_status)) {
          return {
            success: false,
            message: `Invalid payment status transition from ${bid.payment_status} to ${updateData.payment_status}`,
            statusCode: 400
          };
        }

        // Auto set paid_at if status becomes paid
        if (updateData.payment_status === "paid") {
          updateData.paid_at = new Date();
          if (!updateData.paid_amount) {
            updateData.paid_amount = bid.amount;
          }
        }
      }

      // Validate dispute update
      if (updateData.dispute) {
        // Only staff can update dispute
        if (!user.roles.some(role => 
          ["loan_officer_approval", "admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
        )) {
          delete updateData.dispute;
        } else {
          // If resolving dispute, set resolved_by and resolved_at
          if (updateData.dispute.status === "resolved_valid" || 
              updateData.dispute.status === "resolved_invalid") {
            updateData.dispute.resolved_by = user._id;
            updateData.dispute.resolved_at = new Date();
          }
        }
      }

      // Update bid
      Object.assign(bid, updateData);
      await bid.save();

      // Populate for response
      await bid.populate({
        path: "auction",
        populate: {
          path: "asset",
          select: "title"
        }
      });
      await bid.populate("bidder_user", "name email");

      return {
        success: true,
        data: bid,
        message: "Bid updated successfully"
      };
    } catch (error) {
      console.error("Update bid error:", error);
      throw new Error(error.message || "Failed to update bid");
    }
  }

  /**
   * Update bid payment status
   */
  static async updateBidPaymentStatus(id, paymentData, user) {
    try {
      const bid = await Bid.findById(id);
      
      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check permission
      const canUpdatePayment = user.roles.some(role => 
        ["loan_officer_processor", "loan_officer_approval", "admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
      );

      if (!canUpdatePayment) {
        return {
          success: false,
          message: "Insufficient permissions to update payment status",
          statusCode: 403
        };
      }

      // Validate payment status transition
      const validTransitions = {
        "unpaid": ["pending", "cancelled"],
        "pending": ["paid", "failed", "cancelled"],
        "paid": ["refunded"],
        "failed": ["pending", "cancelled"],
        "refunded": [],
        "cancelled": []
      };

      if (validTransitions[bid.payment_status] && 
          !validTransitions[bid.payment_status].includes(paymentData.payment_status)) {
        return {
          success: false,
          message: `Invalid payment status transition from ${bid.payment_status} to ${paymentData.payment_status}`,
          statusCode: 400
        };
      }

      // Check dispute status
      const disputeStatus = bid.dispute?.status || "none";
      const disputeActive = ["raised", "under_review", "resolved_invalid"].includes(disputeStatus);

      if (disputeActive && ["paid", "refunded"].includes(paymentData.payment_status)) {
        return {
          success: false,
          message: "Cannot set bid as paid/refunded while dispute is active or invalid",
          statusCode: 400
        };
      }

      // Update payment status
      bid.payment_status = paymentData.payment_status;
      if (paymentData.payment_reference) {
        bid.payment_reference = paymentData.payment_reference;
      }
      if (paymentData.paid_amount) {
        bid.paid_amount = paymentData.paid_amount;
      }

      // Auto set paid_at if status becomes paid
      if (paymentData.payment_status === "paid") {
        bid.paid_at = new Date();
        if (!bid.paid_amount) {
          bid.paid_amount = bid.amount;
        }
      }

      await bid.save();

      return {
        success: true,
        data: bid,
        message: `Bid payment status updated to ${paymentData.payment_status}`
      };
    } catch (error) {
      console.error("Update payment status error:", error);
      throw new Error(error.message || "Failed to update payment status");
    }
  }

  /**
   * Raise a dispute on a bid
   */
  static async raiseDispute(bidId, disputeData, user) {
    try {
      const bid = await Bid.findById(bidId);
      
      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check if bidder is raising the dispute
      if (!bid.bidder_user.equals(user._id)) {
        return {
          success: false,
          message: "Only the bidder can raise a dispute",
          statusCode: 403
        };
      }

      // Check if dispute can be raised
      if (bid.dispute?.status !== "none") {
        return {
          success: false,
          message: "Dispute already exists for this bid",
          statusCode: 400
        };
      }

      // Check if auction is still active
      const auction = await Auction.findById(bid.auction);
      if (auction.status === "closed" || auction.status === "cancelled") {
        return {
          success: false,
          message: "Cannot raise dispute for closed or cancelled auction",
          statusCode: 400
        };
      }

      // Update dispute
      bid.dispute = {
        status: "raised",
        reason: disputeData.reason,
        raised_by: user._id,
        raised_at: new Date()
      };

      await bid.save();

      await bid.populate("dispute.raised_by", "name email");

      return {
        success: true,
        data: bid,
        message: "Dispute raised successfully"
      };
    } catch (error) {
      console.error("Raise dispute error:", error);
      throw new Error(error.message || "Failed to raise dispute");
    }
  }

  /**
   * Resolve a dispute
   */
  static async resolveDispute(bidId, resolutionData, user) {
    try {
      const bid = await Bid.findById(bidId);
      
      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check permission (staff only)
      const canResolve = user.roles.some(role => 
        ["loan_officer_approval", "admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
      );

      if (!canResolve) {
        return {
          success: false,
          message: "Insufficient permissions to resolve disputes",
          statusCode: 403
        };
      }

      // Check if dispute exists
      if (!bid.dispute || bid.dispute.status === "none") {
        return {
          success: false,
          message: "No active dispute found for this bid",
          statusCode: 400
        };
      }

      // Check if dispute is already resolved
      if (bid.dispute.status === "resolved_valid" || bid.dispute.status === "resolved_invalid") {
        return {
          success: false,
          message: "Dispute already resolved",
          statusCode: 400
        };
      }

      // Update dispute resolution
      bid.dispute.status = resolutionData.status;
      bid.dispute.resolution_notes = resolutionData.resolution_notes;
      bid.dispute.resolved_by = user._id;
      bid.dispute.resolved_at = new Date();

      // If dispute resolved as invalid, update payment status if needed
      if (resolutionData.status === "resolved_invalid" && bid.payment_status === "paid") {
        bid.payment_status = "refunded";
      }

      await bid.save();

      await bid.populate("dispute.resolved_by", "name email");

      return {
        success: true,
        data: bid,
        message: "Dispute resolved successfully"
      };
    } catch (error) {
      console.error("Resolve dispute error:", error);
      throw new Error(error.message || "Failed to resolve dispute");
    }
  }

  /**
   * Delete a bid
   */
  static async deleteBid(id, user) {
    try {
      const bid = await Bid.findById(id);
      
      if (!bid) {
        return {
          success: false,
          message: "Bid not found",
          statusCode: 404
        };
      }

      // Check permission (admin only)
      const canDelete = user.roles.some(role => 
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(role)
      );

      if (!canDelete) {
        return {
          success: false,
          message: "Insufficient permissions to delete bid",
          statusCode: 403
        };
      }

      // Check if bid can be deleted
      if (bid.payment_status === "paid" || bid.payment_status === "refunded") {
        return {
          success: false,
          message: "Cannot delete bid with completed payment",
          statusCode: 400
        };
      }

      // Check if dispute is active
      const disputeStatus = bid.dispute?.status || "none";
      if (disputeStatus === "raised" || disputeStatus === "under_review") {
        return {
          success: false,
          message: "Cannot delete bid with active dispute",
          statusCode: 400
        };
      }

      await Bid.findByIdAndDelete(id);

      return {
        success: true,
        message: "Bid deleted successfully"
      };
    } catch (error) {
      console.error("Delete bid error:", error);
      throw new Error(error.message || "Failed to delete bid");
    }
  }

  /**
   * Get bid statistics
   */
  static async getBidStats(filters = {}, user) {
    try {
      let query = {};

      // Apply filters
      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.bidder_user) query.bidder_user = filters.bidder_user;

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.bidder_user = user._id;
      }

      const stats = await Bid.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            total_paid_amount: { $sum: "$paid_amount" },
            by_payment_status: {
              $push: {
                status: "$payment_status",
                amount: "$amount"
              }
            },
            by_dispute_status: {
              $push: {
                status: "$dispute.status",
                amount: "$amount"
              }
            }
          }
        }
      ]);

      // Format stats
      const result = stats[0] || {
        total: 0,
        total_amount: 0,
        total_paid_amount: 0,
        by_payment_status: [],
        by_dispute_status: []
      };

      // Calculate payment status breakdown
      const paymentStats = {
        unpaid: { count: 0, amount: 0 },
        pending: { count: 0, amount: 0 },
        paid: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
        refunded: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 }
      };

      result.by_payment_status.forEach(item => {
        if (paymentStats[item.status]) {
          paymentStats[item.status].count++;
          paymentStats[item.status].amount += item.amount || 0;
        }
      });

      // Calculate dispute status breakdown
      const disputeStats = {
        none: { count: 0, amount: 0 },
        raised: { count: 0, amount: 0 },
        under_review: { count: 0, amount: 0 },
        resolved_valid: { count: 0, amount: 0 },
        resolved_invalid: { count: 0, amount: 0 }
      };

      result.by_dispute_status.forEach(item => {
        const status = item.status || "none";
        if (disputeStats[status]) {
          disputeStats[status].count++;
          disputeStats[status].amount += item.amount || 0;
        }
      });

      delete result.by_payment_status;
      delete result.by_dispute_status;

      return {
        success: true,
        data: {
          ...result,
          payment_status: paymentStats,
          dispute_status: disputeStats
        }
      };
    } catch (error) {
      console.error("Get bid stats error:", error);
      throw new Error(error.message || "Failed to fetch bid statistics");
    }
  }

  /**
   * Get bids by auction with detailed auction and asset info
   */
  static async getBidsByAuction(auctionId, user) {
    try {
      const auction = await Auction.findById(auctionId);
      
      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404
        };
      }

      const bids = await Bid.find({ auction: auctionId })
        .populate({
          path: "auction",
          populate: {
            path: "asset",
            select: "title description category evaluated_value",
            populate: {
              path: "attachments",
              select: "filename url",
              match: { category: "asset_photos" }
            }
          }
        })
        .populate("bidder_user", "name email phone")
        .sort({ amount: -1 });

      return {
        success: true,
        data: bids
      };
    } catch (error) {
      console.error("Get bids by auction error:", error);
      throw new Error(error.message || "Failed to fetch auction bids");
    }
  }

  /**
   * Get bids by user with detailed auction info
   */
  static async getBidsByUser(userId, requestingUser) {
    try {
      // Check permission
      if (requestingUser.roles.includes("customer") && 
          !requestingUser._id.equals(userId)) {
        return {
          success: false,
          message: "Cannot view other users' bids",
          statusCode: 403
        };
      }

      const bids = await Bid.find({ bidder_user: userId })
        .populate({
          path: "auction",
          select: "auction_no status starts_at ends_at",
          populate: {
            path: "asset",
            select: "title category evaluated_value",
            populate: {
              path: "attachments",
              select: "filename url",
              match: { category: "asset_photos" },
              limit: 1
            }
          }
        })
        .sort({ placed_at: -1 });

      return {
        success: true,
        data: bids
      };
    } catch (error) {
      console.error("Get bids by user error:", error);
      throw new Error(error.message || "Failed to fetch user bids");
    }
  }

  /**
   * Search bids
   */
  static async searchBids(searchTerm, filters = {}, user) {
    try {
      if (!searchTerm || searchTerm.length < 2) {
        return {
          success: false,
          message: "Search term must be at least 2 characters",
          statusCode: 400
        };
      }

      let query = {
        $or: [
          { payment_reference: { $regex: searchTerm, $options: "i" } }
        ]
      };

      // Apply additional filters
      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.bidder_user) query.bidder_user = filters.bidder_user;
      if (filters.payment_status) query.payment_status = filters.payment_status;

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.bidder_user = user._id;
      }

      const bids = await Bid.find(query)
        .populate({
          path: "auction",
          select: "auction_no",
          populate: {
            path: "asset",
            select: "title",
            populate: {
              path: "attachments",
              select: "filename url",
              match: { category: "asset_photos" },
              limit: 1
            }
          }
        })
        .populate("bidder_user", "name")
        .limit(20);

      return {
        success: true,
        data: bids
      };
    } catch (error) {
      console.error("Search bids error:", error);
      throw new Error(error.message || "Failed to search bids");
    }
  }
}

module.exports = BidService;