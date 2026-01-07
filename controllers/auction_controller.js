const AuctionService = require("../services/auction_service");

/**
 * Auction Controller
 * Handles HTTP requests and responses
 */
class AuctionController {
  /**
   * Create a new auction
   */
  static async createAuction(req, res) {
    try {
      const {
        asset,
        starting_bid_amount,
        reserve_price,
        auction_type,
        starts_at,
        ends_at,
      } = req.body;

      // Validate required fields
      if (!asset || !starting_bid_amount || !starts_at || !ends_at) {
        return res.status(400).json({
          success: false,
          message:
            "Asset, starting bid amount, start date, and end date are required",
        });
      }

      const result = await AuctionService.createAuction(
        {
          asset,
          starting_bid_amount: parseFloat(starting_bid_amount),
          reserve_price: reserve_price ? parseFloat(reserve_price) : undefined,
          auction_type: auction_type || "online",
          starts_at: new Date(starts_at),
          ends_at: new Date(ends_at),
        },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(201).json(result);
    } catch (error) {
      console.error("Create auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get auctions with pagination and filters
   */
  static async getAuctions(req, res) {
    try {
      const filters = {
        status: req.query.status,
        auction_type: req.query.auction_type,
        category: req.query.category,
        asset_id: req.query.asset_id,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
        starts_from: req.query.starts_from,
        starts_to: req.query.starts_to,
        ends_from: req.query.ends_from,
        ends_to: req.query.ends_to,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by || "created_at",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search,
      };

      const result = await AuctionService.getAuctions(
        filters,
        pagination,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get auctions controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get auction by ID
   */
  static async getAuction(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      const result = await AuctionService.getAuctionById(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update auction
   */
  static async updateAuction(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      // Parse numeric fields
      if (updateData.starting_bid_amount) {
        updateData.starting_bid_amount = parseFloat(
          updateData.starting_bid_amount
        );
      }
      if (updateData.reserve_price) {
        updateData.reserve_price = parseFloat(updateData.reserve_price);
      }
      if (updateData.starts_at) {
        updateData.starts_at = new Date(updateData.starts_at);
      }
      if (updateData.ends_at) {
        updateData.ends_at = new Date(updateData.ends_at);
      }

      const result = await AuctionService.updateAuction(
        id,
        updateData,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update auction status
   */
  static async updateAuctionStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const validStatuses = ["draft", "live", "closed", "cancelled"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }

      const result = await AuctionService.updateAuctionStatus(
        id,
        status,
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update status controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Place a bid
   */
  static async placeBid(req, res) {
    try {
      const { id } = req.params;
      const { amount } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      if (!amount || isNaN(parseFloat(amount))) {
        return res.status(400).json({
          success: false,
          message: "Valid bid amount is required",
        });
      }

      const result = await AuctionService.placeBid(
        id,
        { amount: parseFloat(amount) },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(201).json(result);
    } catch (error) {
      console.error("Place bid controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bids for an auction
   */
  static async getAuctionBids(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      const result = await AuctionService.getAuctionBids(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get auction bids controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get live auctions
   */
  static async getLiveAuctions(req, res) {
    try {
      const filters = {
        category: req.query.category,
      };

      const result = await AuctionService.getLiveAuctions(filters);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get live auctions controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get auction statistics
   */
  static async getAuctionStats(req, res) {
    try {
      const result = await AuctionService.getAuctionStats(req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get stats controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete auction
   */
  static async deleteAuction(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      const result = await AuctionService.deleteAuction(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Delete auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get user's bidding history
   */
  static async getUserBiddingHistory(req, res) {
    try {
      const { userId } = req.params;
      const filters = {
        status: req.query.status,
        page: req.query.page || 1,
        limit: req.query.limit || 10,
      };

      // Check permission - users can only view their own history
      if (
        req.user.roles.includes("customer") &&
        req.user._id.toString() !== userId
      ) {
        return res.status(403).json({
          success: false,
          message: "You can only view your own bidding history",
        });
      }

      const result = await AuctionService.getUserBiddingHistory(
        userId,
        filters
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get user bidding history controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Search auctions
   */
  static async searchAuctions(req, res) {
    try {
      const { q } = req.query;
      const filters = {
        status: req.query.status,
      };

      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const result = await AuctionService.searchAuctions(q, filters);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Search auctions controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = AuctionController;
