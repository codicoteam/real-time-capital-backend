const Auction = require("../models/auction.model");
const Asset = require("../models/asset.model");
const Bid = require("../models/bid.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");
(async () => {
  ({ v4: uuidv4 } = await import("uuid"));
})();
/**
 * Auction Service
 * Contains all business logic for auctions
 */
class AuctionService {
  /**
   * Generate unique auction number
   */
  static async generateAuctionNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `AUCTION-${year}${month}-${random}`;
  }

  /**
   * Validate asset for auction
   */
  static async validateAssetForAuction(assetId, user) {
    try {
      const asset = await Asset.findById(assetId);

      if (!asset) {
        return {
          success: false,
          message: "Asset not found",
          statusCode: 404,
        };
      }

      // Check if asset is eligible for auction
      const eligibleStatuses = ["overdue", "auction", "in_repair"];
      if (!eligibleStatuses.includes(asset.status)) {
        return {
          success: false,
          message: `Asset is not eligible for auction. Current status: ${asset.status}`,
          statusCode: 400,
        };
      }

      // Check if asset already has an active auction
      const existingAuction = await Auction.findOne({
        asset: assetId,
        status: { $in: ["draft", "live"] },
      });

      if (existingAuction) {
        return {
          success: false,
          message: "Asset already has an active auction",
          statusCode: 400,
        };
      }

      return {
        success: true,
        data: asset,
      };
    } catch (error) {
      console.error("Validate asset error:", error);
      throw new Error(error.message || "Failed to validate asset");
    }
  }

  /**
   * Create a new auction
   */
  static async createAuction(auctionData, createdBy) {
    try {
      // Validate asset
      const assetValidation = await this.validateAssetForAuction(
        auctionData.asset,
        createdBy
      );
      if (!assetValidation.success) {
        return assetValidation;
      }

      // Validate dates
      const startsAt = new Date(auctionData.starts_at);
      const endsAt = new Date(auctionData.ends_at);
      const now = new Date();

      if (startsAt < now) {
        return {
          success: false,
          message: "Start date cannot be in the past",
          statusCode: 400,
        };
      }

      if (endsAt <= startsAt) {
        return {
          success: false,
          message: "End date must be after start date",
          statusCode: 400,
        };
      }

      // Validate pricing
      if (
        auctionData.reserve_price &&
        auctionData.reserve_price < auctionData.starting_bid_amount
      ) {
        return {
          success: false,
          message: "Reserve price cannot be less than starting bid amount",
          statusCode: 400,
        };
      }

      // Generate auction number
      const auctionNo = await this.generateAuctionNumber();

      const auction = new Auction({
        ...auctionData,
        auction_no: auctionNo,
        created_by: createdBy,
        status: "draft",
      });

      await auction.save();

      // Update asset status
      await Asset.findByIdAndUpdate(auctionData.asset, {
        status: "auction",
      });

      // Populate with detailed asset data
      const populatedAuction = await this.getAuctionWithDetails(auction._id);

      return {
        success: true,
        data: populatedAuction,
        message: "Auction created successfully",
      };
    } catch (error) {
      console.error("Create auction error:", error);
      throw new Error(error.message || "Failed to create auction");
    }
  }

  /**
   * Get auction with full details including asset images
   */
  static async getAuctionWithDetails(auctionId) {
    return await Auction.findById(auctionId)
      .populate({
        path: "asset",
        select:
          "asset_no title description category condition status evaluated_value storage_location",
        populate: [
          {
            path: "owner_user",
            select: "name email phone",
          },
          {
            path: "attachments",
            select: "filename url mime_type category",
            match: { category: "asset_photos" },
          },
        ],
      })
      .populate("winner_user", "name email phone")
      .populate("created_by", "name email");
  }

  /**
   * Get auctions with pagination and filters
   */
  static async getAuctions(filters = {}, pagination = {}, user) {
    try {
      const {
        page = 1,
        limit = 10,
        sort_by = "created_at",
        sort_order = "desc",
        search,
      } = pagination;

      const {
        status,
        auction_type,
        category,
        asset_id,
        created_from,
        created_to,
        starts_from,
        starts_to,
        ends_from,
        ends_to,
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (status) query.status = status;
      if (auction_type) query.auction_type = auction_type;
      if (asset_id) query.asset = asset_id;

      // Date filters
      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      if (starts_from || starts_to) {
        query.starts_at = {};
        if (starts_from) query.starts_at.$gte = new Date(starts_from);
        if (starts_to) query.starts_at.$lte = new Date(starts_to);
      }

      if (ends_from || ends_to) {
        query.ends_at = {};
        if (ends_from) query.ends_at.$gte = new Date(ends_from);
        if (ends_to) query.ends_at.$lte = new Date(ends_to);
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [{ auction_no: { $regex: search, $options: "i" } }];
      }

      // Category filter - needs to join with asset
      if (category) {
        const assets = await Asset.find({ category }).select("_id");
        query.asset = { $in: assets.map((a) => a._id) };
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [auctions, total] = await Promise.all([
        Auction.find(query)
          .populate({
            path: "asset",
            select:
              "asset_no title description category condition evaluated_value",
            populate: {
              path: "attachments",
              select: "filename url mime_type",
              match: { category: "asset_photos" },
              limit: 1,
            },
          })
          .populate("winner_user", "name email")
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Auction.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          auctions,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get auctions error:", error);
      throw new Error(error.message || "Failed to fetch auctions");
    }
  }

  /**
   * Get auction by ID
   */
  static async getAuctionById(id, user) {
    try {
      const auction = await this.getAuctionWithDetails(id);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      // Get current highest bid
      const highestBid = await Bid.findOne({ auction: id })
        .sort({ amount: -1 })
        .populate("bidder_user", "name email");

      return {
        success: true,
        data: {
          auction,
          current_bid: highestBid,
        },
      };
    } catch (error) {
      console.error("Get auction error:", error);
      throw new Error(error.message || "Failed to fetch auction");
    }
  }

  /**
   * Update auction
   */
  static async updateAuction(id, updateData, user) {
    try {
      const auction = await Auction.findById(id);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      // Cannot update if auction is live or closed
      if (auction.status === "live") {
        return {
          success: false,
          message: "Cannot update a live auction",
          statusCode: 400,
        };
      }

      if (auction.status === "closed") {
        return {
          success: false,
          message: "Cannot update a closed auction",
          statusCode: 400,
        };
      }

      // Validate dates if being updated
      if (updateData.starts_at || updateData.ends_at) {
        const startsAt = new Date(updateData.starts_at || auction.starts_at);
        const endsAt = new Date(updateData.ends_at || auction.ends_at);

        if (endsAt <= startsAt) {
          return {
            success: false,
            message: "End date must be after start date",
            statusCode: 400,
          };
        }
      }

      // Update auction
      Object.assign(auction, updateData);
      await auction.save();

      const populatedAuction = await this.getAuctionWithDetails(auction._id);

      return {
        success: true,
        data: populatedAuction,
        message: "Auction updated successfully",
      };
    } catch (error) {
      console.error("Update auction error:", error);
      throw new Error(error.message || "Failed to update auction");
    }
  }

  /**
   * Update auction status
   */
  static async updateAuctionStatus(id, status, user) {
    try {
      const auction = await Auction.findById(id);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      // Validate status transition
      const validTransitions = {
        draft: ["live", "cancelled"],
        live: ["closed", "cancelled"],
        closed: [],
        cancelled: ["draft"],
      };

      if (
        !validTransitions[auction.status] ||
        !validTransitions[auction.status].includes(status)
      ) {
        return {
          success: false,
          message: `Invalid status transition from ${auction.status} to ${status}`,
          statusCode: 400,
        };
      }

      // Additional validations for live status
      if (status === "live") {
        const now = new Date();
        if (auction.ends_at <= now) {
          return {
            success: false,
            message: "Cannot start an auction that has already ended",
            statusCode: 400,
          };
        }

        if (auction.starts_at > now) {
          auction.starts_at = now; // Auto-start if scheduled for future
        }
      }

      // Additional validations for closed status
      if (status === "closed") {
        const now = new Date();
        if (auction.ends_at > now) {
          return {
            success: false,
            message: "Cannot close an auction before its end time",
            statusCode: 400,
          };
        }

        // Determine winner if there are bids
        const highestBid = await Bid.findOne({ auction: id }).sort({
          amount: -1,
        });

        if (highestBid) {
          auction.winner_user = highestBid.bidder_user;
          auction.winning_bid_amount = highestBid.amount;

          // Update asset status to sold
          await Asset.findByIdAndUpdate(auction.asset, {
            status: "sold",
          });

          // Update bid payment status
          await Bid.findByIdAndUpdate(highestBid._id, {
            payment_status: "pending",
          });
        } else {
          // No bids, mark asset as available for re-auction
          await Asset.findByIdAndUpdate(auction.asset, {
            status: "overdue",
          });
        }
      }

      // Update status
      auction.status = status;
      await auction.save();

      // Update asset status based on auction status
      if (status === "live") {
        await Asset.findByIdAndUpdate(auction.asset, {
          status: "auction",
        });
      } else if (status === "cancelled") {
        await Asset.findByIdAndUpdate(auction.asset, {
          status: "overdue",
        });
      }

      const populatedAuction = await this.getAuctionWithDetails(auction._id);

      return {
        success: true,
        data: populatedAuction,
        message: `Auction status updated to ${status}`,
      };
    } catch (error) {
      console.error("Update status error:", error);
      throw new Error(error.message || "Failed to update auction status");
    }
  }

  /**
   * Place a bid
   */
  static async placeBid(auctionId, bidData, user) {
    try {
      const auction = await Auction.findById(auctionId);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      // Check if auction is live
      if (auction.status !== "live") {
        return {
          success: false,
          message: "Auction is not live",
          statusCode: 400,
        };
      }

      // Check if auction has started
      const now = new Date();
      if (auction.starts_at > now) {
        return {
          success: false,
          message: "Auction has not started yet",
          statusCode: 400,
        };
      }

      // Check if auction has ended
      if (auction.ends_at <= now) {
        return {
          success: false,
          message: "Auction has ended",
          statusCode: 400,
        };
      }

      // Get current highest bid
      const highestBid = await Bid.findOne({ auction: auctionId }).sort({
        amount: -1,
      });

      const currentHighest = highestBid
        ? highestBid.amount
        : auction.starting_bid_amount;

      // Validate bid amount
      if (bidData.amount <= currentHighest) {
        return {
          success: false,
          message: `Bid must be higher than current highest bid (${currentHighest})`,
          statusCode: 400,
        };
      }

      // Check if user is the owner of the asset (cannot bid on own asset)
      const asset = await Asset.findById(auction.asset);
      if (asset.owner_user.equals(user._id)) {
        return {
          success: false,
          message: "Cannot bid on your own asset",
          statusCode: 400,
        };
      }

      // Check if user has any pending disputes on this auction
      const existingDisputedBid = await Bid.findOne({
        auction: auctionId,
        bidder_user: user._id,
        "dispute.status": { $in: ["raised", "under_review"] },
      });

      if (existingDisputedBid) {
        return {
          success: false,
          message: "Cannot place bid while you have a pending dispute",
          statusCode: 400,
        };
      }

      // Create bid
      const bid = new Bid({
        auction: auctionId,
        bidder_user: user._id,
        amount: bidData.amount,
        placed_at: now,
      });

      await bid.save();

      await bid.populate("bidder_user", "name email");

      return {
        success: true,
        data: bid,
        message: "Bid placed successfully",
      };
    } catch (error) {
      console.error("Place bid error:", error);
      throw new Error(error.message || "Failed to place bid");
    }
  }

  /**
   * Get bids for an auction
   */
  static async getAuctionBids(auctionId, user) {
    try {
      const auction = await Auction.findById(auctionId);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      const bids = await Bid.find({ auction: auctionId })
        .populate("bidder_user", "name email phone")
        .sort({ amount: -1 });

      return {
        success: true,
        data: bids,
      };
    } catch (error) {
      console.error("Get auction bids error:", error);
      throw new Error(error.message || "Failed to fetch auction bids");
    }
  }

  /**
   * Get live auctions for display
   */
  static async getLiveAuctions(filters = {}) {
    try {
      const now = new Date();

      let query = {
        status: "live",
        starts_at: { $lte: now },
        ends_at: { $gte: now },
      };

      // Apply category filter if provided
      if (filters.category) {
        const assets = await Asset.find({ category: filters.category }).select(
          "_id"
        );
        query.asset = { $in: assets.map((a) => a._id) };
      }

      const auctions = await Auction.find(query)
        .populate({
          path: "asset",
          select:
            "asset_no title description category condition evaluated_value",
          populate: [
            {
              path: "attachments",
              select: "filename url mime_type",
              match: { category: "asset_photos" },
            },
            {
              path: "owner_user",
              select: "name",
            },
          ],
        })
        .sort({ ends_at: 1 });

      // Get current highest bids for each auction
      const auctionsWithBids = await Promise.all(
        auctions.map(async (auction) => {
          const highestBid = await Bid.findOne({ auction: auction._id })
            .sort({ amount: -1 })
            .populate("bidder_user", "name");

          return {
            ...auction.toObject(),
            current_bid: highestBid,
          };
        })
      );

      return {
        success: true,
        data: auctionsWithBids,
      };
    } catch (error) {
      console.error("Get live auctions error:", error);
      throw new Error(error.message || "Failed to fetch live auctions");
    }
  }

  /**
   * Get auction statistics
   */
  static async getAuctionStats(user) {
    try {
      const stats = await Auction.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
            live: { $sum: { $cond: [{ $eq: ["$status", "live"] }, 1, 0] } },
            closed: { $sum: { $cond: [{ $eq: ["$status", "closed"] }, 1, 0] } },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
            total_starting_value: { $sum: "$starting_bid_amount" },
            total_winning_value: { $sum: "$winning_bid_amount" },
          },
        },
      ]);

      // Get today's auctions
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysAuctions = await Auction.countDocuments({
        created_at: { $gte: today, $lt: tomorrow },
      });

      // Get upcoming auctions (next 7 days)
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      const upcomingAuctions = await Auction.countDocuments({
        starts_at: { $gte: today, $lte: nextWeek },
        status: { $in: ["draft", "live"] },
      });

      const result = stats[0] || {
        total: 0,
        draft: 0,
        live: 0,
        closed: 0,
        cancelled: 0,
        total_starting_value: 0,
        total_winning_value: 0,
      };

      return {
        success: true,
        data: {
          ...result,
          todays_auctions: todaysAuctions,
          upcoming_auctions: upcomingAuctions,
        },
      };
    } catch (error) {
      console.error("Get stats error:", error);
      throw new Error(error.message || "Failed to fetch auction statistics");
    }
  }

  /**
   * Delete auction (soft delete)
   */
  static async deleteAuction(id, user) {
    try {
      const auction = await Auction.findById(id);

      if (!auction) {
        return {
          success: false,
          message: "Auction not found",
          statusCode: 404,
        };
      }

      // Cannot delete live or closed auctions
      if (auction.status === "live") {
        return {
          success: false,
          message: "Cannot delete a live auction",
          statusCode: 400,
        };
      }

      // Check if there are any bids
      const bidCount = await Bid.countDocuments({ auction: id });
      if (bidCount > 0) {
        return {
          success: false,
          message: "Cannot delete an auction with bids",
          statusCode: 400,
        };
      }

      // Update asset status back to overdue
      await Asset.findByIdAndUpdate(auction.asset, {
        status: "overdue",
      });

      // Delete auction
      await Auction.findByIdAndDelete(id);

      return {
        success: true,
        message: "Auction deleted successfully",
      };
    } catch (error) {
      console.error("Delete auction error:", error);
      throw new Error(error.message || "Failed to delete auction");
    }
  }

  /**
   * Get user's bidding history
   */
  static async getUserBiddingHistory(userId, filters = {}) {
    try {
      const { status, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      let auctionMatch = {};
      if (status) {
        auctionMatch.status = status;
      }

      const bids = await Bid.find({ bidder_user: userId })
        .populate({
          path: "auction",
          match: auctionMatch,
          populate: {
            path: "asset",
            select: "title category",
            populate: {
              path: "attachments",
              select: "filename url",
              match: { category: "asset_photos" },
              limit: 1,
            },
          },
        })
        .sort({ placed_at: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Bid.countDocuments({ bidder_user: userId });

      return {
        success: true,
        data: {
          bids: bids.filter((bid) => bid.auction), // Filter out bids where auction was removed
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get user bidding history error:", error);
      throw new Error(error.message || "Failed to fetch bidding history");
    }
  }

  /**
   * Search auctions
   */
  static async searchAuctions(searchTerm, filters = {}) {
    try {
      if (!searchTerm || searchTerm.length < 2) {
        return {
          success: false,
          message: "Search term must be at least 2 characters",
          statusCode: 400,
        };
      }

      // Search in assets
      const assets = await Asset.find({
        $or: [
          { title: { $regex: searchTerm, $options: "i" } },
          { description: { $regex: searchTerm, $options: "i" } },
          { asset_no: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      const auctionIds = assets.map((asset) => asset._id);

      const auctions = await Auction.find({
        $or: [
          { auction_no: { $regex: searchTerm, $options: "i" } },
          { asset: { $in: auctionIds } },
        ],
        ...filters,
      })
        .populate({
          path: "asset",
          select: "title description category evaluated_value",
          populate: {
            path: "attachments",
            select: "filename url",
            match: { category: "asset_photos" },
            limit: 1,
          },
        })
        .limit(20);

      return {
        success: true,
        data: auctions,
      };
    } catch (error) {
      console.error("Search auctions error:", error);
      throw new Error(error.message || "Failed to search auctions");
    }
  }
}

module.exports = AuctionService;
