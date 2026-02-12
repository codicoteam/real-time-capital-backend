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
        throw new Error("Paynow credentials are not configured.");
      }

      this.paynowIntegration = new this.Paynow(
        String(PAYNOW_ID),
        String(PAYNOW_KEY),
      );

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
   * Validate and format phone number for mobile payments
   * Accepts: 077... or 26377...
   * Returns: local format starting with 0 (e.g. 0777123456)
   */
  static validatePhoneNumber(phone, method) {
    if (!phone) {
      throw new Error(`Phone number is required for ${method} payment`);
    }

    // Remove all non-digits
    const digits = phone.replace(/\D/g, "");

    // Zimbabwe mobile prefixes (Econet, NetOne, Telecel)
    const validPrefixes = ["77", "78", "71", "73"];

    // Check if it starts with 26377... or 077...
    let localNumber;
    if (digits.startsWith("263")) {
      const afterCountry = digits.slice(3);
      if (
        afterCountry.length === 9 &&
        validPrefixes.includes(afterCountry.slice(0, 2))
      ) {
        localNumber = "0" + afterCountry;
      } else {
        throw new Error(
          `Invalid ${method} number. Must be a valid Zimbabwean mobile number.`,
        );
      }
    } else if (digits.startsWith("0")) {
      if (digits.length === 10 && validPrefixes.includes(digits.slice(1, 3))) {
        localNumber = digits;
      } else {
        throw new Error(
          `Invalid ${method} number. Must be a valid Zimbabwean mobile number.`,
        );
      }
    } else {
      throw new Error(`Invalid ${method} number. Must start with 0 or 263.`);
    }

    return localNumber; // e.g. "0777123456"
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
   * Create a new bid payment
   */
  async createBidPayment(paymentData, userId) {
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
          "Bid ID, amount, and payment method are required",
        );
      }

      // Get bid details
      const bid = await Bid.findById(bid_id).populate({
        path: "auction",
        select: "auction_no status winner_user",
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
          "Cannot process payment for non-closed auction",
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
          `Payment amount (${amount}) must match bid amount (${bid.amount})`,
        );
      }

      // Check dispute status (already handled by pre-save hook, but we validate early)
      const disputeStatus = bid.dispute?.status || "none";
      const disputeActive = [
        "raised",
        "under_review",
        "resolved_invalid",
      ].includes(disputeStatus);

      if (disputeActive) {
        throw this.handleError(
          400,
          "Cannot process payment for bid with active or invalid dispute",
        );
      }

      // Get payer details
      const payer = await User.findById(userId);
      if (!payer) {
        throw this.handleError(404, "Payer not found");
      }

      // Generate receipt number
      const receiptNo = await BidPaymentService.generateReceiptNumber();

      // Create payment object
      const payment = new BidPayment({
        bid: bid_id,
        auction: bid.auction._id,
        payer_user: userId,
        amount: parseFloat(amount),
        currency: "USD",
        status: "initiated", // will be updated after PayNow initiation
        method: method,
        provider: provider || method,
        payer_phone: null,
        redirect_url,
        receipt_no: receiptNo,
        notes,
      });

      // For mobile payments, validate and set phone number
      const mobileMethods = ["ecocash", "onemoney", "telecash"];
      if (mobileMethods.includes(method)) {
        const localPhone = BidPaymentService.validatePhoneNumber(
          payer_phone || payer.phone,
          method,
        );
        payment.payer_phone = localPhone;
      }

      // Save payment first
      await payment.save();

      // If PayNow or mobile payment, initiate payment
      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(method) &&
        this.paynowIntegration
      ) {
        return await this.initiatePayNowPayment(payment, bid, payer);
      }

      // For other payment methods (cash, bank, card), just return the saved payment
      payment.status = "pending";
      await payment.save();

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
   * Initiate PayNow payment (web redirect or mobile)
   */
  async initiatePayNowPayment(payment, bid, payer) {
    try {
      // Prepare PayNow payment object
      const paynowPayment = this.paynowIntegration.createPayment(
        payment.receipt_no,
        payer.email || "customer@example.com",
      );

      paynowPayment.add(
        `Bid Payment - Auction #${bid.auction.auction_no}`,
        parseFloat(payment.amount),
      );

      let response;

      // ---------- MOBILE MONEY FLOW (Ecocash, OneMoney, Telecash) ----------
      if (["ecocash", "onemoney", "telecash"].includes(payment.method)) {
        if (!payment.payer_phone) {
          throw this.handleError(
            400,
            `Phone number is required for ${payment.method} payment`,
          );
        }

        response = await this.paynowIntegration.sendMobile(
          paynowPayment,
          payment.payer_phone,
          payment.method,
        );

        // ---------- WEB REDIRECT FLOW (PayNow) ----------
      } else if (payment.method === "paynow") {
        response = await this.paynowIntegration.send(paynowPayment);
      } else {
        throw this.handleError(400, "Unsupported PayNow payment method");
      }

      // ---------- PROCESS RESPONSE ----------
      if (response && response.success) {
        payment.status = "pending";
        payment.poll_url = response.pollUrl || response.pollurl || null;
        payment.provider_txn_id = response.reference || null;
        payment.meta = {
          ...payment.meta,
          paynow_response: response,
          redirect_url: response.redirectUrl,
          instructions: response.instructions,
          mobile_method: payment.method,
        };

        await payment.save();

        const populatedPayment = await this.getPaymentWithDetails(payment._id);

        return {
          success: true,
          data: {
            payment: populatedPayment,
            poll_url: payment.poll_url,
            redirect_url: payment.meta.redirect_url || null,
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
        payment.status = "failed";
        payment.meta = {
          ...payment.meta,
          paynow_error: response?.error || "Unknown error",
        };
        await payment.save();

        throw this.handleError(
          400,
          `Payment initiation failed: ${response?.error || "Unknown error"}`,
        );
      }
    } catch (error) {
      payment.status = "failed";
      payment.meta = {
        ...payment.meta,
        initiation_error: error.message,
      };
      await payment.save();

      console.error("Payment initiation error:", error);
      throw this.handleError(
        500,
        `Failed to initiate payment: ${error.message}`,
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

      if (bid_id) query.bid = bid_id;
      if (auction_id) query.auction = auction_id;
      if (payer_user) query.payer_user = payer_user;
      if (status) query.status = status;
      if (method) query.method = method;
      if (provider) query.provider = provider;

      if (min_amount || max_amount) {
        query.amount = {};
        if (min_amount) query.amount.$gte = parseFloat(min_amount);
        if (max_amount) query.amount.$lte = parseFloat(max_amount);
      }

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

      if (user.roles.includes("customer")) {
        query.payer_user = user._id;
      }

      if (search && search.length >= 2) {
        query.$or = [
          { receipt_no: { $regex: search, $options: "i" } },
          { provider_txn_id: { $regex: search, $options: "i" } },
          { payer_phone: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (page - 1) * limit;

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
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all bid payments without pagination
   */
  async getAllBidPayments(filters = {}, user) {
    try {
      const { bid_id, auction_id, payer_user, status, method, provider } =
        filters;

      let query = {};

      if (bid_id) query.bid = bid_id;
      if (auction_id) query.auction = auction_id;
      if (payer_user) query.payer_user = payer_user;
      if (status) query.status = status;
      if (method) query.method = method;
      if (provider) query.provider = provider;

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
        .sort({ created_at: -1 });

      return {
        success: true,
        data: payments,
      };
    } catch (error) {
      console.error("Get all bid payments error:", error);
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get bid payment by ID
   */
  async getBidPaymentById(paymentId, user) {
    try {
      const payment = await this.getPaymentWithDetails(paymentId);

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

      const canUpdate = user.roles.some((role) =>
        [
          "loan_officer_processor",
          "loan_officer_approval",
          "admin_pawn_limited",
          "management",
          "super_admin_vendor",
        ].includes(role),
      );

      if (!canUpdate) {
        throw this.handleError(
          403,
          "Insufficient permissions to update payment",
        );
      }

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
              `Cannot update ${field} for a successful payment`,
            );
          }
        }
      }

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
            `Invalid status transition from ${payment.status} to ${updateData.status}`,
          );
        }

        if (updateData.status === "success") {
          updateData.paid_at = new Date();
        }
      }

      Object.assign(payment, updateData);
      await payment.save();

      if (updateData.status === "success") {
        await Bid.findByIdAndUpdate(payment.bid, {
          payment_status: "paid",
          paid_amount: payment.amount,
          paid_at: new Date(),
        });

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

      const onlineMethods = ["paynow", "ecocash", "onemoney", "telecash"];
      if (!onlineMethods.includes(payment.method)) {
        throw this.handleError(
          400,
          "This payment method does not support status checking",
        );
      }

      if (!payment.poll_url || !this.paynowIntegration) {
        throw this.handleError(
          400,
          "No poll URL found or PayNow not configured",
        );
      }

      const response = await this.paynowIntegration.pollTransaction(
        payment.poll_url,
      );

      if (!response) {
        throw this.handleError(502, "Unable to reach payment gateway");
      }

      const mapStatus = (status) => {
        const s = String(status || "").toLowerCase();
        if (s.includes("paid") || s.includes("completed")) return "success";
        if (s.includes("awaiting") || s.includes("pending")) return "pending";
        if (s.includes("cancel")) return "cancelled";
        if (s.includes("fail")) return "failed";
        return "pending";
      };

      const newStatus = mapStatus(response.status);

      payment.status = newStatus;
      if (newStatus === "success" && !payment.paid_at) {
        payment.paid_at = new Date();
      }

      if (response.amount) {
        payment.amount = parseFloat(response.amount);
      }

      payment.meta = {
        ...payment.meta,
        last_status_check: new Date(),
        paynow_status: response.status,
        raw_response: response,
      };

      await payment.save();

      if (newStatus === "success") {
        await Bid.findByIdAndUpdate(payment.bid, {
          payment_status: "paid",
          paid_amount: payment.amount,
          paid_at: new Date(),
        });

        await Auction.findByIdAndUpdate(payment.auction, {
          $set: { "meta.payment_received": true },
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
        `Failed to check payment status: ${error.message}`,
      );
    }
  }

  /**
   * Process PayNow webhook/callback
   */
  async processPayNowWebhook(webhookData) {
    try {
      const { reference, status, pollUrl, method, amount } = webhookData;

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
          `Payment with reference ${reference} not found`,
        );
      }

      if (payment.poll_url && this.paynowIntegration) {
        return await this.checkPayNowStatus(payment._id);
      }

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

        if (method) {
          payment.method = method;
        }

        if (amount) {
          payment.amount = parseFloat(amount);
        }

        await payment.save();

        if (newStatus === "success") {
          await Bid.findByIdAndUpdate(payment.bid, {
            payment_status: "paid",
            paid_amount: payment.amount,
            paid_at: new Date(),
          });

          await Auction.findByIdAndUpdate(payment.auction, {
            $set: { "meta.payment_received": true },
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
          "Cannot refund a payment that is not successful",
        );
      }

      const canRefund = user.roles.some((role) =>
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(
          role,
        ),
      );

      if (!canRefund) {
        throw this.handleError(
          403,
          "Insufficient permissions to refund payment",
        );
      }

      if (payment.status === "refunded") {
        throw this.handleError(400, "Payment already refunded");
      }

      payment.status = "refunded";
      payment.notes = refundData.notes
        ? `${payment.notes || ""}\nRefund: ${refundData.notes}`
        : payment.notes || "Refund processed";

      await payment.save();

      await Bid.findByIdAndUpdate(payment.bid, {
        payment_status: "refunded",
      });

      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(
          payment.method,
        ) &&
        payment.provider_txn_id
      ) {
        console.log(
          `Processing refund for ${payment.method} payment ${paymentId}`,
        );
        // Implement refund logic via PayNow if available
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

      const canDelete = user.roles.some((role) =>
        ["admin_pawn_limited", "management", "super_admin_vendor"].includes(
          role,
        ),
      );

      if (!canDelete) {
        throw this.handleError(
          403,
          "Insufficient permissions to delete payment",
        );
      }

      if (payment.status === "success" || payment.status === "refunded") {
        throw this.handleError(
          400,
          "Cannot delete completed or refunded payments",
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

      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.payer_user) query.payer_user = filters.payer_user;
      if (filters.method) query.method = filters.method;

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
            by_status: { $push: { status: "$status", amount: "$amount" } },
            by_method: { $push: { method: "$method", amount: "$amount" } },
            by_mobile_provider: {
              $push: { provider: "$provider", amount: "$amount" },
            },
          },
        },
      ]);

      const result = stats[0] || {
        total: 0,
        total_amount: 0,
        by_status: [],
        by_method: [],
        by_mobile_provider: [],
      };

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

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todaysPayments = await BidPayment.countDocuments({
        ...query,
        created_at: { $gte: today, $lt: tomorrow },
      });

      const pendingMobile = await BidPayment.countDocuments({
        ...query,
        method: { $in: ["ecocash", "onemoney", "telecash", "paynow"] },
        status: { $in: ["initiated", "pending"] },
      });

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
      throw this.handleMongoError(error);
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
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get payments by payer
   */
  async getPaymentsByPayer(payerId, requestingUser) {
    try {
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
      throw this.handleMongoError(error);
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
          "Search term must be at least 2 characters",
        );
      }

      let query = {
        $or: [
          { receipt_no: { $regex: searchTerm, $options: "i" } },
          { provider_txn_id: { $regex: searchTerm, $options: "i" } },
          { payer_phone: { $regex: searchTerm, $options: "i" } },
        ],
      };

      if (filters.auction_id) query.auction = filters.auction_id;
      if (filters.payer_user) query.payer_user = filters.payer_user;
      if (filters.status) query.status = filters.status;
      if (filters.method) query.method = filters.method;

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
      throw this.handleMongoError(error);
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
          phone_format: "077... or 26377...",
          default: true,
        },
        {
          id: "onemoney",
          name: "OneMoney",
          description: "NetOne mobile money service",
          icon: "📱",
          supported_countries: ["ZW"],
          phone_format: "071... or 26371... / 073... or 26373...",
          default: false,
        },
        {
          id: "telecash",
          name: "Telecash",
          description: "Telecel mobile money service",
          icon: "💳",
          supported_countries: ["ZW"],
          phone_format: "073... or 26373...",
          default: false,
        },
        {
          id: "paynow",
          name: "PayNow",
          description: "Online payment gateway",
          icon: "🌐",
          supported_countries: ["ZW"],
          phone_format: "Not required for web payments",
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
      throw this.handleError(500, "Failed to fetch payment methods");
    }
  }

  /**
   * Create a custom error object
   */
  handleError(status, message) {
    const error = new Error(message);
    error.status = status;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Handle MongoDB and custom errors – **IMPROVED VERSION**
   */
  handleMongoError(error) {
    console.error("Bid Payment Service Error:", error);

    // 1. Already a custom error from our service
    if (error.status && error.message) {
      return error;
    }

    // 2. Mongoose validation error (includes schema validation)
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((err) => err.message);
      return this.handleError(400, `Validation failed: ${messages.join(", ")}`);
    }

    // 3. Mongoose CastError (invalid ObjectId)
    if (error.name === "CastError") {
      return this.handleError(
        400,
        `Invalid ${error.path}: ${error.value}`,
      );
    }

    // 4. Duplicate key error (MongoDB code 11000)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return this.handleError(
        409,
        `Duplicate ${field.replace("_", " ")}`,
      );
    }

    // 5. Common pre-hook validation errors from the BidPayment model
    //    (these are plain Errors, but we want to expose them as 400)
    if (error.message && (
      error.message.includes("Bid not found for payment") ||
      error.message.includes("Cannot mark payment success while bid dispute is active") ||
      error.message.includes("Phone number is required") ||
      error.message.includes("Invalid Ecocash") ||
      error.message.includes("Invalid OneMoney") ||
      error.message.includes("Invalid Telecash")
    )) {
      return this.handleError(400, error.message);
    }

    // 6. Default – internal server error
    return this.handleError(500, "Internal server error");
  }
}

module.exports = new BidPaymentService();
