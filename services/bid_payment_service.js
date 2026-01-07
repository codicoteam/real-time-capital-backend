const BidPayment = require("../models/bidPayment.model");
const Bid = require("../models/bid.model");
const Auction = require("../models/auction.model");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const { Paynow } = require("paynow");
const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Bid Payment Service
 * Handles all bid payment processing with PayNow and mobile payment integration
 */
class BidPaymentService {
  constructor() {
    // Initialize PayNow
    this.Paynow = Paynow;
    this.paynowIntegration = null;
    this.initializePayNow();
  }

  /**
   * Initialize PayNow integration
   */
  initializePayNow() {
    try {
      const { PAYNOW_ID, PAYNOW_KEY, PAYNOW_RESULT_URL, PAYNOW_RETURN_URL } =
        process.env;

      if (!PAYNOW_ID || !PAYNOW_KEY) {
        console.warn(
          "Paynow credentials are not configured. Cash payments only."
        );
        return;
      }

      this.paynowIntegration = new this.Paynow(
        String(PAYNOW_ID),
        String(PAYNOW_KEY)
      );

      // Set URLs if they exist
      if (PAYNOW_RESULT_URL)
        this.paynowIntegration.resultUrl = PAYNOW_RESULT_URL;
      if (PAYNOW_RETURN_URL)
        this.paynowIntegration.returnUrl = PAYNOW_RETURN_URL;

      console.log("PayNow integration initialized successfully");
    } catch (error) {
      console.error("Failed to initialize PayNow:", error);
      throw this.handleError(500, "Payment gateway initialization failed");
    }
  }

  /**
   * Generate unique receipt number
   */
  static async generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `BIDPAY-${year}${month}${day}-${random}`;
  }

  /**
   * Validate phone number for mobile payments
   */
  static validatePhoneNumber(phone, method) {
    if (!phone) {
      throw new Error(`Phone number is required for ${method} payment`);
    }

    // Remove any non-digit characters
    const cleanPhone = phone.replace(/\D/g, "");

    // Validate based on payment method
    switch (method) {
      case "ecocash":
        if (!cleanPhone.match(/^(26377|26378|26371|26373)\d{7}$/)) {
          throw new Error(
            "Invalid Ecocash phone number. Must be a valid Zimbabwean number starting with 077, 078, 071, or 073"
          );
        }
        break;
      case "onemoney":
        if (!cleanPhone.match(/^(26377|26378|26371|26373)\d{7}$/)) {
          throw new Error(
            "Invalid OneMoney phone number. Must be a valid Zimbabwean number"
          );
        }
        break;
      case "telecash":
        if (!cleanPhone.match(/^(26377|26378|26371|26373)\d{7}$/)) {
          throw new Error(
            "Invalid Telecash phone number. Must be a valid Zimbabwean number"
          );
        }
        break;
    }

    return `+${cleanPhone}`;
  }

  /**
   * Create a new bid payment
   */
  async createBidPayment(paymentData, user) {
    try {
      const {
        bid_id,
        amount,
        method,
        provider,
        payer_phone,
        redirect_url,
        notes,
      } = paymentData;

      // Validate required fields
      if (!bid_id || !amount || !method) {
        throw this.handleError(
          400,
          "Bid ID, amount, and payment method are required"
        );
      }

      // Get bid details
      const bid = await Bid.findById(bid_id).populate({
        path: "auction",
        select: "auction_no status",
      });

      if (!bid) {
        throw this.handleError(404, "Bid not found");
      }

      // Check if bid already has a successful payment
      const existingPayment = await BidPayment.findOne({
        bid: bid_id,
        status: "success",
      });

      if (existingPayment) {
        throw this.handleError(400, "Bid already has a successful payment");
      }

      // Check if auction is still active/closed
      const auction = await Auction.findById(bid.auction._id);
      if (!auction) {
        throw this.handleError(404, "Auction not found");
      }

      if (auction.status !== "closed") {
        throw this.handleError(
          400,
          "Cannot process payment for non-closed auction"
        );
      }

      // Check if bid is the winning bid
      if (
        !auction.winner_user ||
        !auction.winner_user.equals(bid.bidder_user)
      ) {
        throw this.handleError(400, "Only winning bid can be paid for");
      }

      // Check bid amount matches
      if (parseFloat(amount) !== parseFloat(bid.amount)) {
        throw this.handleError(
          400,
          `Payment amount (${amount}) must match bid amount (${bid.amount})`
        );
      }

      // Check dispute status
      const disputeStatus = bid.dispute?.status || "none";
      const disputeActive = [
        "raised",
        "under_review",
        "resolved_invalid",
      ].includes(disputeStatus);

      if (disputeActive) {
        throw this.handleError(
          400,
          "Cannot process payment for bid with active or invalid dispute"
        );
      }

      // Validate phone number for mobile payments
      let validatedPhone = null;
      const mobileMethods = ["ecocash", "onemoney", "telecash"];

      if (mobileMethods.includes(method)) {
        validatedPhone = this.constructor.validatePhoneNumber(
          payer_phone || user.phone,
          method
        );

        // Set default provider if not specified
        if (!provider) {
          paymentData.provider = method; // ecocash, onemoney, or telecash
        }
      }

      // Generate receipt number
      const receiptNo = await BidPaymentService.generateReceiptNumber();

      // Create payment object
      const payment = new BidPayment({
        bid: bid_id,
        auction: bid.auction._id,
        payer_user: user._id,
        amount: parseFloat(amount),
        currency: "USD",
        status: ["paynow", "ecocash", "onemoney", "telecash"].includes(method)
          ? "initiated"
          : "pending",
        method,
        provider: provider || method,
        payer_phone: validatedPhone,
        redirect_url,
        receipt_no: receiptNo,
        notes,
      });

      // Save the payment first to get the _id
      await payment.save();

      // If PayNow payment (including mobile), initiate payment
      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(method) &&
        this.paynowIntegration
      ) {
        return await this.initiatePayNowPayment(payment, bid, user);
      }

      // For other payment methods (cash, bank, card), just return the saved payment
      const populatedPayment = await this.getPaymentWithDetails(payment._id);

      return {
        success: true,
        data: {
          payment: populatedPayment,
          poll_url: payment.poll_url || null,
          redirect_url: payment.redirect_url || null,
        },
        message: "Bid payment created successfully",
      };
    } catch (error) {
      console.error("Create bid payment error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Initiate PayNow payment (including mobile payments)
   */
  async initiatePayNowPayment(payment, bid, user) {
    try {
      // Get payer details
      const payer = await User.findById(user._id);
      if (!payer) {
        throw this.handleError(404, "Payer not found");
      }

      // Create PayNow payment
      const paynowPayment = this.paynowIntegration.createPayment(
        payment.receipt_no,
        payer.email || "customer@example.com"
      );

      paynowPayment.add(
        `Bid Payment - Auction #${bid.auction.auction_no}`,
        parseFloat(payment.amount)
      );

      // For mobile payments, set the auth email to phone number format
      if (["ecocash", "onemoney", "telecash"].includes(payment.method)) {
        // PayNow requires the phone number in the auth email field for mobile payments
        const phoneEmail = `${payment.payer_phone.replace("+", "")}@${
          payment.method
        }.com`;
        paynowPayment.authEmail = phoneEmail;

        // Set mobile payment method in meta
        payment.meta = {
          ...payment.meta,
          mobile_method: payment.method,
          phone_number: payment.payer_phone,
        };
      }

      // Send payment to PayNow
      const response = await this.paynowIntegration.send(paynowPayment);

      if (response.success) {
        // Save poll URL and provider reference
        payment.poll_url = response.pollUrl || response.pollurl || null;
        payment.provider_txn_id =
          response.reference || response.pollUrl
            ? response.pollUrl.split("/").pop()
            : null;
        payment.meta = {
          ...payment.meta,
          paynow_response: response,
          redirect_url: response.redirectUrl || payment.redirect_url,
          instructions: response.instructions,
          payment_method: response.method || payment.method,
        };

        // If redirect URL is provided in response, save it
        if (response.redirectUrl) {
          payment.redirect_url = response.redirectUrl;
        }

        await payment.save();

        // Update bid payment status
        await Bid.findByIdAndUpdate(payment.bid, {
          payment_status: "pending",
        });

        const populatedPayment = await this.getPaymentWithDetails(payment._id);

        return {
          success: true,
          data: {
            payment: populatedPayment,
            poll_url: payment.poll_url,
            redirect_url: payment.redirect_url,
            paynow_response: {
              payment_url: response.redirectUrl,
              poll_url: response.pollUrl || response.pollurl,
              instructions: response.instructions,
              method: response.method || payment.method,
              success: true,
              reference: response.reference,
            },
          },
          message: `${
            payment.method.charAt(0).toUpperCase() + payment.method.slice(1)
          } payment initiated successfully`,
        };
      } else {
        // If PayNow fails, update payment status
        payment.status = "failed";
        payment.meta = {
          ...payment.meta,
          paynow_error: response.error,
        };
        await payment.save();

        throw this.handleError(
          400,
          `Payment initiation failed: ${response.error || "Unknown error"}`
        );
      }
    } catch (error) {
      // Update payment status to failed in case of error
      payment.status = "failed";
      payment.meta = {
        ...payment.meta,
        initiation_error: error.message,
      };
      await payment.save();

      console.error("Payment initiation error:", error);
      throw this.handleError(
        500,
        `Failed to initiate payment: ${error.message}`
      );
    }
  }

  /**
   * Get payment with full details
   */
  async getPaymentWithDetails(paymentId) {
    try {
      const payment = await BidPayment.findById(paymentId)
        .populate({
          path: "bid",
          populate: [
            {
              path: "auction",
              populate: {
                path: "asset",
                select: "title description category evaluated_value",
                populate: [
                  {
                    path: "attachments",
                    select: "filename url mime_type",
                    match: { category: "asset_photos" },
                  },
                  {
                    path: "owner_user",
                    select: "name email phone",
                  },
                ],
              },
            },
            {
              path: "bidder_user",
              select: "name email phone",
            },
          ],
        })
        .populate("payer_user", "name email phone")
        .populate("auction", "auction_no status");

      if (!payment) {
        throw this.handleError(404, "Payment not found");
      }

      return payment;
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get bid payments with pagination
   */
  async getBidPayments(filters = {}, pagination = {}, user) {
    try {
      const {
        page = 1,
        limit = 10,
        sort_by = "created_at",
        sort_order = "desc",
        search,
      } = pagination;

      const {
        bid_id,
        auction_id,
        payer_user,
        status,
        method,
        provider,
        min_amount,
        max_amount,
        paid_from,
        paid_to,
        created_from,
        created_to,
      } = filters;

      // Build query
      let query = {};

      // Apply filters
      if (bid_id) query.bid = bid_id;
      if (auction_id) query.auction = auction_id;
      if (payer_user) query.payer_user = payer_user;
      if (status) query.status = status;
      if (method) query.method = method;
      if (provider) query.provider = provider;

      // Amount filters
      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

      // Date filters
      if (paid_from || paid_to) {
        query.paid_at = {};
        if (paid_from) query.paid_at.$gte = new Date(paid_from);
        if (paid_to) query.paid_at.$lte = new Date(paid_to);
      }

      if (created_from || created_to) {
        query.created_at = {};
        if (created_from) query.created_at.$gte = new Date(created_from);
        if (created_to) query.created_at.$lte = new Date(created_to);
      }

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.payer_user = user._id;
      }

      // Search functionality
      if (search && search.length >= 2) {
        query.$or = [
          { receipt_no: { $regex: search, $options: "i" } },
          { provider_txn_id: { $regex: search, $options: "i" } },
          { payer_phone: { $regex: search, $options: "i" } },
        ];
      }

      // Calculate skip
      const skip = (page - 1) * limit;

      // Execute query
      const [payments, total] = await Promise.all([
        BidPayment.find(query)
          .populate({
            path: "bid",
            select: "amount placed_at",
            populate: {
              path: "auction",
              select: "auction_no",
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
            },
          })
          .populate("payer_user", "name email")
          .populate("auction", "auction_no")
          .sort({ [sort_by]: sort_order === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        BidPayment.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          payments,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
      };
    } catch (error) {
      console.error("Get bid payments error:", error);
      throw new Error(error.message || "Failed to fetch bid payments");
    }
  }

  /**
   * Get all bid payments without pagination
   */
  async getAllBidPayments(filters = {}, user) {
    try {
      const { bid_id, auction_id, payer_user, status, method, provider } =
        filters;

      // Build query
      let query = {};

      // Apply filters
      if (bid_id) query.bid = bid_id;
      if (auction_id) query.auction = auction_id;
      if (payer_user) query.payer_user = payer_user;
      if (status) query.status = status;
      if (method) query.method = method;
      if (provider) query.provider = provider;

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.payer_user = user._id;
      }

      // Execute query
      const payments = await BidPayment.find(query)
        .populate({
          path: "bid",
          select: "amount",
          populate: {
            path: "auction",
            select: "auction_no",
            populate: {
              path: "asset",
              select: "title",
            },
          },
        })
        .populate("payer_user", "name")
        .sort({ created_at: -1 });

      return {
        success: true,
        data: payments,
      };
    } catch (error) {
      console.error("Get all bid payments error:", error);
      throw new Error(error.message || "Failed to fetch bid payments");
    }
  }

  /**
   * Get bid payment by ID
   */
  async getBidPaymentById(paymentId, user) {
    try {
      const payment = await this.getPaymentWithDetails(paymentId);

      // Check permission
      if (
        user.roles.includes("customer") &&
        !payment.payer_user._id.equals(user._id)
      ) {
        throw this.handleError(403, "Access denied to this payment");
      }

      return {
        success: true,
        data: payment,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update bid payment
   */
  async updateBidPayment(paymentId, updateData, user) {
    try {
      const payment = await BidPayment.findById(paymentId);

      if (!payment) {
        throw this.handleError(404, "Payment not found");
      }

      // Check permission (staff/admin only)
      const canUpdate = user.roles.some((role) =>
        [
          "loan_officer_processor",
          "loan_officer_approval",
          "admin_pawn_limited",
          "management",
          "super_admin_vendor",
        ].includes(role)
      );

      if (!canUpdate) {
        throw this.handleError(
          403,
          "Insufficient permissions to update payment"
        );
      }

      // Prevent updating certain fields if payment is already successful
      if (payment.status === "success") {
        const restrictedFields = [
          "amount",
          "currency",
          "method",
          "provider",
          "bid",
          "auction",
          "payer_phone",
        ];
        for (const field of restrictedFields) {
          if (
            updateData[field] !== undefined &&
            updateData[field] !== payment[field]
          ) {
            throw this.handleError(
              400,
              `Cannot update ${field} for a successful payment`
            );
          }
        }
      }

      // Validate status transition
      if (updateData.status) {
        const validTransitions = {
          initiated: ["pending", "cancelled"],
          pending: ["success", "failed", "cancelled"],
          success: ["refunded"],
          failed: ["pending", "cancelled"],
          refunded: [],
          cancelled: [],
        };

        if (
          validTransitions[payment.status] &&
          !validTransitions[payment.status].includes(updateData.status)
        ) {
          throw this.handleError(
            400,
            `Invalid status transition from ${payment.status} to ${updateData.status}`
          );
        }

        // Auto set paid_at if status becomes success
        if (updateData.status === "success") {
          updateData.paid_at = new Date();
        }
      }

      // Update payment
      Object.assign(payment, updateData);
      await payment.save();

      // Update bid payment status if payment is successful
      if (updateData.status === "success") {
        await Bid.findByIdAndUpdate(payment.bid, {
          payment_status: "paid",
          paid_amount: payment.amount,
          paid_at: new Date(),
        });

        // Update auction winner payment status
        await Auction.findByIdAndUpdate(payment.auction, {
          $set: { "meta.payment_received": true },
        });
      }

      const populatedPayment = await this.getPaymentWithDetails(payment._id);

      return {
        success: true,
        data: populatedPayment,
        message: "Payment updated successfully",
      };
    } catch (error) {
      console.error("Update bid payment error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Check PayNow payment status (including mobile payments)
   */
  async checkPayNowStatus(paymentId) {
    try {
      const payment = await BidPayment.findById(paymentId);

      if (!payment) {
        throw this.handleError(404, "Payment not found");
      }

      // Only check status for PayNow and mobile payments
      const onlineMethods = ["paynow", "ecocash", "onemoney", "telecash"];
      if (!onlineMethods.includes(payment.method)) {
        throw this.handleError(
          400,
          "This payment method does not support status checking"
        );
      }

      if (!payment.poll_url || !this.paynowIntegration) {
        throw this.handleError(
          400,
          "No poll URL found or PayNow not configured"
        );
      }

      // Check payment status from PayNow
      const response = await this.paynowIntegration.pollTransaction(
        payment.poll_url
      );

      if (!response) {
        throw this.handleError(502, "Unable to reach payment gateway");
      }

      // Map PayNow status to our status
      const mapStatus = (status) => {
        const s = String(status || "").toLowerCase();
        if (s.includes("paid") || s.includes("completed")) return "success";
        if (s.includes("awaiting") || s.includes("pending")) return "pending";
        if (s.includes("cancel")) return "cancelled";
        if (s.includes("fail")) return "failed";
        return "pending";
      };

      const newStatus = mapStatus(response.status);

      // Update payment status
      payment.status = newStatus;
      if (newStatus === "success" && !payment.paid_at) {
        payment.paid_at = new Date();
      }

      if (response.amount) {
        payment.amount = parseFloat(response.amount);
      }

      // Update meta with latest response
      payment.meta = {
        ...payment.meta,
        last_status_check: new Date(),
        paynow_status: response.status,
        raw_response: response,
      };

      await payment.save();

      // Update bid payment status if successful
      if (newStatus === "success") {
        await Bid.findByIdAndUpdate(payment.bid, {
          payment_status: "paid",
          paid_amount: payment.amount,
          paid_at: new Date(),
        });
      }

      return {
        success: true,
        data: {
          payment,
          gateway_status: response.status,
          status: newStatus,
          paid: newStatus === "success",
          amount: response.amount,
          method: response.method || payment.method,
          poll_url: payment.poll_url,
        },
        message: `Payment status: ${newStatus}`,
      };
    } catch (error) {
      console.error("Payment status check error:", error);
      throw this.handleError(
        500,
        `Failed to check payment status: ${error.message}`
      );
    }
  }

  /**
   * Process PayNow webhook/callback
   */
  async processPayNowWebhook(webhookData) {
    try {
      const { reference, status, pollUrl, method, amount } = webhookData;

      // Find payment by provider_txn_id or receipt_no or poll_url
      const payment = await BidPayment.findOne({
        $or: [
          { provider_txn_id: reference },
          { receipt_no: reference },
          { poll_url: pollUrl },
        ],
      });

      if (!payment) {
        throw this.handleError(
          404,
          `Payment with reference ${reference} not found`
        );
      }

      // If there's a poll URL, use it to get the latest status
      if (payment.poll_url && this.paynowIntegration) {
        return await this.checkPayNowStatus(payment._id);
      }

      // Otherwise, update based on webhook status
      if (status) {
        const mapStatus = (s) => {
          const x = String(s || "").toLowerCase();
          if (x.includes("paid") || x.includes("completed")) return "success";
          if (x.includes("awaiting") || x.includes("pending")) return "pending";
          if (x.includes("cancel")) return "cancelled";
          if (x.includes("fail")) return "failed";
          return "pending";
        };

        const newStatus = mapStatus(status);
        payment.status = newStatus;
        if (newStatus === "success" && !payment.paid_at) {
          payment.paid_at = new Date();
        }

        // Update method if provided
        if (method) {
          payment.method = method;
        }

        // Update amount if provided
        if (amount) {
          payment.amount = parseFloat(amount);
        }

        await payment.save();

        // Update bid payment status if successful
        if (newStatus === "success") {
          await Bid.findByIdAndUpdate(payment.bid, {
            payment_status: "paid",
            paid_amount: payment.amount,
            paid_at: new Date(),
          });
        }

        return {
          success: true,
          data: {
            payment,
            poll_url: payment.poll_url,
          },
          message: `Payment status updated to ${newStatus} via webhook`,
        };
      }

      return {
        success: true,
        data: {
          payment,
          poll_url: payment.poll_url,
        },
        message: "Webhook processed, no status change",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Refund bid payment
   */
  async refundBidPayment(paymentId, refundData, user) {
    try {
      const payment = await BidPayment.findById(paymentId);

      if (!payment) {
        throw this.handleError(404, "Payment not found");
      }

      if (payment.status !== "success") {
        throw this.handleError(
          400,
          "Cannot refund a payment that is not successful"
        );
      }

      // Check permission (admin only)
      const canRefund = user.roles.some((role) =>
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(
          role
        )
      );

      if (!canRefund) {
        throw this.handleError(
          403,
          "Insufficient permissions to refund payment"
        );
      }

      // Check if already refunded
      if (payment.status === "refunded") {
        throw this.handleError(400, "Payment already refunded");
      }

      // Update payment status to refunded
      payment.status = "refunded";
      payment.notes = refundData.notes
        ? `${payment.notes || ""}\nRefund: ${refundData.notes}`
        : payment.notes || "Refund processed";

      await payment.save();

      // Update bid payment status
      await Bid.findByIdAndUpdate(payment.bid, {
        payment_status: "refunded",
      });

      // If PayNow/mobile payment, initiate refund through provider
      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(
          payment.method
        ) &&
        payment.provider_txn_id
      ) {
        console.log(
          `Processing refund for ${payment.method} payment ${paymentId}`
        );
        // Implement refund logic here for mobile payments
      }

      return {
        success: true,
        data: {
          payment,
          poll_url: payment.poll_url,
        },
        message: "Payment refunded successfully",
      };
    } catch (error) {
      console.error("Refund bid payment error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete bid payment
   */
  async deleteBidPayment(paymentId, user) {
    try {
      const payment = await BidPayment.findById(paymentId);

      if (!payment) {
        throw this.handleError(404, "Payment not found");
      }

      // Check permission (admin only)
      const canDelete = user.roles.some((role) =>
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(
          role
        )
      );

      if (!canDelete) {
        throw this.handleError(
          403,
          "Insufficient permissions to delete payment"
        );
      }

      // Cannot delete successful payments
      if (payment.status === "success" || payment.status === "refunded") {
        throw this.handleError(
          400,
          "Cannot delete completed or refunded payments"
        );
      }

      await BidPayment.findByIdAndDelete(paymentId);

      return {
        success: true,
        message: "Payment deleted successfully",
      };
    } catch (error) {
      console.error("Delete bid payment error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get bid payment statistics
   */
  async getBidPaymentStats(filters = {}, user) {
    try {
      let query = {};

      // Apply filters
      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.payer_user) query.payer_user = filters.payer_user;
      if (filters.method) query.method = filters.method;

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.payer_user = user._id;
      }

      const stats = await BidPayment.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            total_amount: { $sum: "$amount" },
            by_status: {
              $push: {
                status: "$status",
                amount: "$amount",
              },
            },
            by_method: {
              $push: {
                method: "$method",
                amount: "$amount",
              },
            },
            by_mobile_provider: {
              $push: {
                provider: "$provider",
                amount: "$amount",
                method: "$method",
              },
            },
          },
        },
      ]);

      // Format stats
      const result = stats[0] || {
        total: 0,
        total_amount: 0,
        by_status: [],
        by_method: [],
        by_mobile_provider: [],
      };

      // Calculate status breakdown
      const statusStats = {
        initiated: { count: 0, amount: 0 },
        pending: { count: 0, amount: 0 },
        success: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
        refunded: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
      };

      result.by_status.forEach((item) => {
        if (statusStats[item.status]) {
          statusStats[item.status].count++;
          statusStats[item.status].amount += item.amount || 0;
        }
      });

      // Calculate method breakdown
      const methodStats = {
        cash: { count: 0, amount: 0 },
        bank: { count: 0, amount: 0 },
        ecocash: { count: 0, amount: 0 },
        onemoney: { count: 0, amount: 0 },
        telecash: { count: 0, amount: 0 },
        card: { count: 0, amount: 0 },
        paynow: { count: 0, amount: 0 },
      };

      result.by_method.forEach((item) => {
        const method = item.method || "cash";
        if (methodStats[method]) {
          methodStats[method].count++;
          methodStats[method].amount += item.amount || 0;
        }
      });

      // Calculate mobile provider breakdown
      const mobileStats = {
        ecocash: { count: 0, amount: 0 },
        onemoney: { count: 0, amount: 0 },
        telecash: { count: 0, amount: 0 },
      };

      result.by_mobile_provider.forEach((item) => {
        if (mobileStats[item.provider]) {
          mobileStats[item.provider].count++;
          mobileStats[item.provider].amount += item.amount || 0;
        }
      });

      delete result.by_status;
      delete result.by_method;
      delete result.by_mobile_provider;

      // Get today's payments
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysPayments = await BidPayment.countDocuments({
        ...query,
        created_at: { $gte: today, $lt: tomorrow },
      });

      // Get pending mobile payments
      const pendingMobile = await BidPayment.countDocuments({
        ...query,
        method: { $in: ["ecocash", "onemoney", "telecash", "paynow"] },
        status: { $in: ["initiated", "pending"] },
      });

      // Get successful mobile payments amount
      const successfulMobile = await BidPayment.aggregate([
        {
          $match: {
            ...query,
            method: { $in: ["ecocash", "onemoney", "telecash", "paynow"] },
            status: "success",
          },
        },
        {
          $group: {
            _id: null,
            total_amount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      return {
        success: true,
        data: {
          ...result,
          status: statusStats,
          method: methodStats,
          mobile_providers: mobileStats,
          todays_payments: todaysPayments,
          pending_mobile: pendingMobile,
          successful_mobile: successfulMobile[0] || {
            total_amount: 0,
            count: 0,
          },
        },
      };
    } catch (error) {
      console.error("Get bid payment stats error:", error);
      throw new Error(error.message || "Failed to fetch payment statistics");
    }
  }

  /**
   * Get payments by auction
   */
  async getPaymentsByAuction(auctionId, user) {
    try {
      const auction = await Auction.findById(auctionId);

      if (!auction) {
        throw this.handleError(404, "Auction not found");
      }

      const payments = await BidPayment.find({ auction: auctionId })
        .populate({
          path: "bid",
          select: "amount placed_at",
          populate: {
            path: "bidder_user",
            select: "name email phone",
          },
        })
        .populate("payer_user", "name email phone")
        .sort({ created_at: -1 });

      return {
        success: true,
        data: payments,
      };
    } catch (error) {
      console.error("Get payments by auction error:", error);
      throw new Error(error.message || "Failed to fetch auction payments");
    }
  }

  /**
   * Get payments by payer
   */
  async getPaymentsByPayer(payerId, requestingUser) {
    try {
      // Check permission
      if (
        requestingUser.roles.includes("customer") &&
        !requestingUser._id.equals(payerId)
      ) {
        throw this.handleError(403, "Cannot view other users' payments");
      }

      const payments = await BidPayment.find({ payer_user: payerId })
        .populate({
          path: "bid",
          select: "amount",
          populate: {
            path: "auction",
            select: "auction_no",
            populate: {
              path: "asset",
              select: "title",
              populate: {
                path: "attachments",
                select: "filename url",
                match: { category: "asset_photos" },
                limit: 1,
              },
            },
          },
        })
        .populate("auction", "auction_no")
        .sort({ created_at: -1 });

      return {
        success: true,
        data: payments,
      };
    } catch (error) {
      console.error("Get payments by payer error:", error);
      throw new Error(error.message || "Failed to fetch payer payments");
    }
  }

  /**
   * Search bid payments
   */
  async searchBidPayments(searchTerm, filters = {}, user) {
    try {
      if (!searchTerm || searchTerm.length < 2) {
        throw this.handleError(
          400,
          "Search term must be at least 2 characters"
        );
      }

      let query = {
        $or: [
          { receipt_no: { $regex: searchTerm, $options: "i" } },
          { provider_txn_id: { $regex: searchTerm, $options: "i" } },
          { payer_phone: { $regex: searchTerm, $options: "i" } },
        ],
      };

      // Apply additional filters
      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.payer_user) query.payer_user = filters.payer_user;
      if (filters.status) query.status = filters.status;
      if (filters.method) query.method = filters.method;

      // Role-based filtering
      if (user.roles.includes("customer")) {
        query.payer_user = user._id;
      }

      const payments = await BidPayment.find(query)
        .populate({
          path: "bid",
          select: "amount",
          populate: {
            path: "auction",
            select: "auction_no",
            populate: {
              path: "asset",
              select: "title",
            },
          },
        })
        .populate("payer_user", "name")
        .limit(20);

      return {
        success: true,
        data: payments,
      };
    } catch (error) {
      console.error("Search bid payments error:", error);
      throw new Error(error.message || "Failed to search payments");
    }
  }

  /**
   * Get mobile payment methods
   */
  async getMobilePaymentMethods() {
    try {
      const methods = [
        {
          id: "ecocash",
          name: "EcoCash",
          description: "Zimbabwe's leading mobile money platform",
          icon: "💰",
          supported_countries: ["ZW"],
          phone_format: "26377xxxxxxx or 26378xxxxxxx",
          default: true,
        },
        {
          id: "onemoney",
          name: "OneMoney",
          description: "NetOne mobile money service",
          icon: "📱",
          supported_countries: ["ZW"],
          phone_format: "26371xxxxxxx or 26373xxxxxxx",
          default: false,
        },
        {
          id: "telecash",
          name: "Telecash",
          description: "Telecel mobile money service",
          icon: "💳",
          supported_countries: ["ZW"],
          phone_format: "26373xxxxxxx",
          default: false,
        },
        {
          id: "paynow",
          name: "PayNow",
          description: "Online payment gateway",
          icon: "🌐",
          supported_countries: ["ZW"],
          phone_format: "Optional for mobile payments",
          default: false,
        },
      ];

      return {
        success: true,
        data: methods,
        message: "Mobile payment methods retrieved successfully",
      };
    } catch (error) {
      console.error("Get mobile payment methods error:", error);
      throw new Error(error.message || "Failed to fetch payment methods");
    }
  }

  /**
   * Handle custom errors
   */
  handleError(status, message) {
    return {
      status,
      message,
      timestamp: new Date(),
    };
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Bid Payment Service Error:", error);

    // If it's already a custom error, return it
    if (error.status && error.message) {
      return error;
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        status: 409,
        message: `Duplicate ${field.replace("_", " ")}`,
        field,
      };
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return {
        status: 400,
        message: "Validation failed",
        errors,
      };
    }

    // Handle CastError (invalid ObjectId)
    if (error.name === "CastError") {
      return {
        status: 400,
        message: `Invalid ${error.path}: ${error.value}`,
      };
    }

    // Default error
    return {
      status: 500,
      message: "Internal server error",
      detail: error.message,
    };
  }
}

module.exports = new BidPaymentService();
