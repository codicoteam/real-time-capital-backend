const BidPaymentService = require("../services/bid_payment_service");

/**
 * Bid Payment Controller
 * Handles HTTP requests and responses for bid payments
 */
class BidPaymentController {
  /**
   * Create a new bid payment
   */
  static async createBidPayment(req, res) {
    try {
      const {
        bid_id,
        amount,
        method,
        provider,
        payer_phone,
        redirect_url,
        notes,
      } = req.body;

      // Validate required fields
      if (!bid_id || !amount || !method) {
        return res.status(400).json({
          success: false,
          message: "Bid ID, amount, and payment method are required",
        });
      }

      // Validate mobile payment methods
      const mobileMethods = ["ecocash", "onemoney", "telecash"];
      if (mobileMethods.includes(method) && !payer_phone) {
        return res.status(400).json({
          success: false,
          message: `Phone number is required for ${method} payment`,
        });
      }

      // Set default provider for mobile payments
      let finalProvider = provider;
      if (mobileMethods.includes(method) && !provider) {
        finalProvider = method; // Default to the method name as provider
      }

      const result = await BidPaymentService.createBidPayment(
        {
          bid_id,
          amount,
          method,
          provider: finalProvider,
          payer_phone,
          redirect_url,
          notes,
        },
        req.user
      );

      if (result.success) {
        return res.status(201).json({
          success: true,
          data: {
            payment: result.data.payment,
            poll_url: result.data.poll_url,
            redirect_url: result.data.redirect_url,
            paynow_response: result.data.paynow_response || null,
          },
          message: result.message,
        });
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Create bid payment controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bid payments with pagination
   */
  static async getBidPayments(req, res) {
    try {
      const filters = {
        bid_id: req.query.bid_id,
        auction_id: req.query.auction_id,
        payer_user: req.query.payer_user,
        status: req.query.status,
        method: req.query.method,
        provider: req.query.provider,
        min_amount: req.query.min_amount,
        max_amount: req.query.max_amount,
        paid_from: req.query.paid_from,
        paid_to: req.query.paid_to,
        created_from: req.query.created_from,
        created_to: req.query.created_to,
      };

      const pagination = {
        page: req.query.page || 1,
        limit: req.query.limit || 10,
        sort_by: req.query.sort_by || "created_at",
        sort_order: req.query.sort_order || "desc",
        search: req.query.search,
      };

      const result = await BidPaymentService.getBidPayments(
        filters,
        pagination,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bid payments controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get all bid payments without pagination
   */
  static async getAllBidPayments(req, res) {
    try {
      const filters = {
        bid_id: req.query.bid_id,
        auction_id: req.query.auction_id,
        payer_user: req.query.payer_user,
        status: req.query.status,
        method: req.query.method,
        provider: req.query.provider,
      };

      const result = await BidPaymentService.getAllBidPayments(
        filters,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get all bid payments controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bid payment by ID
   */
  static async getBidPayment(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await BidPaymentService.getBidPaymentById(id, req.user);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 404).json(result);
      }
    } catch (error) {
      console.error("Get bid payment controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Update bid payment
   */
  static async updateBidPayment(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await BidPaymentService.updateBidPayment(
        id,
        updateData,
        req.user
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Update bid payment controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
          errors: error.errors,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Check payment status (for PayNow and mobile payments)
   */
  static async checkPaymentStatus(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await BidPaymentService.checkPayNowStatus(id);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Check payment status controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Process PayNow webhook
   */
  static async processPayNowWebhook(req, res) {
    try {
      const webhookData = req.body;

      if (!webhookData || !webhookData.reference) {
        return res.status(400).json({
          success: false,
          message: "Invalid webhook data",
        });
      }

      const result = await BidPaymentService.processPayNowWebhook(webhookData);

      return res.status(200).json(result);
    } catch (error) {
      console.error("Process PayNow webhook controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }

  /**
   * Refund bid payment
   */
  static async refundBidPayment(req, res) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await BidPaymentService.refundBidPayment(
        id,
        { notes },
        req.user
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Refund bid payment controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Delete bid payment
   */
  static async deleteBidPayment(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment ID is required",
        });
      }

      const result = await BidPaymentService.deleteBidPayment(id, req.user);

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Delete bid payment controller error:", error);

      if (error.status) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get bid payment statistics
   */
  static async getBidPaymentStats(req, res) {
    try {
      const filters = {
        auction_id: req.query.auction_id,
        payer_user: req.query.payer_user,
        method: req.query.method,
      };

      const result = await BidPaymentService.getBidPaymentStats(
        filters,
        req.user
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get bid payment stats controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get payments by auction
   */
  static async getPaymentsByAuction(req, res) {
    try {
      const { auctionId } = req.params;

      if (!auctionId) {
        return res.status(400).json({
          success: false,
          message: "Auction ID is required",
        });
      }

      const result = await BidPaymentService.getPaymentsByAuction(
        auctionId,
        req.user
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 404).json(result);
      }
    } catch (error) {
      console.error("Get payments by auction controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get payments by payer
   */
  static async getPaymentsByPayer(req, res) {
    try {
      const { payerId } = req.params;

      if (!payerId) {
        return res.status(400).json({
          success: false,
          message: "Payer ID is required",
        });
      }

      const result = await BidPaymentService.getPaymentsByPayer(
        payerId,
        req.user
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 403).json(result);
      }
    } catch (error) {
      console.error("Get payments by payer controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Search bid payments
   */
  static async searchBidPayments(req, res) {
    try {
      const { q } = req.query;
      const filters = {
        auction_id: req.query.auction_id,
        payer_user: req.query.payer_user,
        status: req.query.status,
        method: req.query.method,
      };

      if (!q) {
        return res.status(400).json({
          success: false,
          message: "Search query is required",
        });
      }

      const result = await BidPaymentService.searchBidPayments(
        q,
        filters,
        req.user
      );

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(result.status || 400).json(result);
      }
    } catch (error) {
      console.error("Search bid payments controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  /**
   * Get available mobile payment methods
   */
  static async getMobilePaymentMethods(req, res) {
    try {
      const result = await BidPaymentService.getMobilePaymentMethods();

      return res.status(200).json(result);
    } catch (error) {
      console.error("Get mobile payment methods controller error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }
}

module.exports = BidPaymentController;