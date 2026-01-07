const BidService = require("../services/bid_service");

/**
 * Bid Controller
 * Handles HTTP requests and responses for bids
 */
class BidController {
  /**
   * Get bids with pagination and filters
   */
  static async getBids(req, res) {
    try {
      const filters = {
        auction_id: req.query.auction_id,
        bidder_user: req.query.bidder_user,
        payment_status: req.query.payment_status,
        dispute_status: req.query.dispute_status,
        min_amount: req.query.min_amount,
        max_amount: req.query.max_amount,
        placed_from: req.query.placed_from,
        placed_to: req.query.placed_to,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by || "placed_at",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search,
      };

      const result = await BidService.getBids(filters, pagination, req.user);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bids controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get all bids without pagination
   */
  static async getAllBids(req, res) {
    try {
      const filters = {
        auction_id: req.query.auction_id,
        bidder_user: req.query.bidder_user,
        payment_status: req.query.payment_status,
        dispute_status: req.query.dispute_status,
        min_amount: req.query.min_amount,
        max_amount: req.query.max_amount,
      };

      const result = await BidService.getAllBids(filters, req.user);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get all bids controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bid by ID
   */
  static async getBid(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      const result = await BidService.getBidById(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bid controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update bid
   */
  static async updateBid(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      const result = await BidService.updateBid(id, updateData, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update bid controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update bid payment status
   */
  static async updateBidPaymentStatus(req, res) {
    try {
      const { id } = req.params;
      const { payment_status, payment_reference, paid_amount } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      if (!payment_status) {
        return res.status(400).json({
          success: false,
          message: "Payment status is required",
        });
      }

      const validStatuses = [
        "unpaid",
        "pending",
        "paid",
        "failed",
        "refunded",
        "cancelled",
      ];
      if (!validStatuses.includes(payment_status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid payment status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }

      const result = await BidService.updateBidPaymentStatus(
        id,
        {
          payment_status,
          payment_reference,
          paid_amount: paid_amount ? parseFloat(paid_amount) : undefined,
        },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Update payment status controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Raise a dispute on a bid
   */
  static async raiseDispute(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: "Dispute reason is required (minimum 10 characters)",
        });
      }

      const result = await BidService.raiseDispute(
        id,
        { reason: reason.trim() },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Raise dispute controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Resolve a dispute
   */
  static async resolveDispute(req, res) {
    try {
      const { id } = req.params;
      const { status, resolution_notes } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Resolution status is required",
        });
      }

      const validStatuses = ["resolved_valid", "resolved_invalid"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid resolution status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }

      if (!resolution_notes || resolution_notes.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message: "Resolution notes are required (minimum 10 characters)",
        });
      }

      const result = await BidService.resolveDispute(
        id,
        {
          status,
          resolution_notes: resolution_notes.trim(),
        },
        req.user
      );

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Resolve dispute controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete a bid
   */
  static async deleteBid(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Bid ID is required",
        });
      }

      const result = await BidService.deleteBid(id, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Delete bid controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bid statistics
   */
  static async getBidStats(req, res) {
    try {
      const filters = {
        auction_id: req.query.auction_id,
        bidder_user: req.query.bidder_user,
      };

      const result = await BidService.getBidStats(filters, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bid stats controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bids by auction
   */
  static async getBidsByAuction(req, res) {
    try {
      const { auctionId } = req.params;

      if (!auctionId) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      const result = await BidService.getBidsByAuction(auctionId, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 404).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bids by auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bids by user
   */
  static async getBidsByUser(req, res) {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const result = await BidService.getBidsByUser(userId, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 403).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bids by user controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Search bids
   */
  static async searchBids(req, res) {
    try {
      const { q } = req.query;
      const filters = {
        auction_id: req.query.auction_id,
        bidder_user: req.query.bidder_user,
        payment_status: req.query.payment_status,
      };

      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const result = await BidService.searchBids(q, filters, req.user);

      if (!result.success) {
        return res.status(result.statusCode || 400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error("Search bids controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = BidController;
