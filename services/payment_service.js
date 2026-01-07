const Payment = require("../models/payment.model");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");
const emailService = require("../utils/emails_util");
const { Paynow } = require("paynow");
require("dotenv").config();

class PaymentService {
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
   * Create a new payment
   */
  async createPayment(paymentData, userId) {
    try {
      // Validate loan exists
      const loan = await Loan.findById(paymentData.loan);
      if (!loan) {
        throw this.handleError(
          404,
          `Loan with ID ${paymentData.loan} not found`
        );
      }

      // Get customer details
      const customer = await User.findById(loan.customer_user);
      if (!customer) {
        throw this.handleError(404, "Customer not found");
      }

      // Generate receipt number if not provided
      if (!paymentData.receipt_no) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(1000 + Math.random() * 9000);
        paymentData.receipt_no = `RCPT${year}${month}${random}`;
      }

      // Set received_by if not provided
      if (!paymentData.received_by && userId) {
        paymentData.received_by = userId;
      }

      // For PayNow and mobile payments, initiate payment
      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(
          paymentData.provider
        )
      ) {
        return await this.initiatePayNowPayment(
          paymentData,
          loan,
          customer,
          userId
        );
      }

      // For other payment methods (cash, bank_transfer), create directly
      const payment = new Payment(paymentData);
      await payment.save();

      // Populate necessary fields
      const populatedPayment = await payment.populate([
        {
          path: "loan",
          select:
            "loan_no customer_user principal_amount current_balance currency status",
        },
        {
          path: "loan_term",
          select: "term_no start_date due_date opening_balance closing_balance",
        },
        {
          path: "received_by",
          select: "first_name last_name email roles",
        },
      ]);

      // If payment is successful, update loan balance
      if (paymentData.payment_status === "paid" && paymentData.amount > 0) {
        await this.updateLoanBalance(payment);
      }

      return {
        success: true,
        data: {
          payment: populatedPayment,
          poll_url: null,
          redirect_url: null,
        },
        message: "Payment created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Initiate PayNow or mobile payment
   */
  async initiatePayNowPayment(paymentData, loan, customer, userId) {
    try {
      // Create payment record first to get ID
      const payment = new Payment({
        ...paymentData,
        payment_status: "pending",
      });
      await payment.save();

      // Create PayNow payment
      const paynowPayment = this.paynowIntegration.createPayment(
        paymentData.receipt_no,
        customer.email || "customer@example.com"
      );

      paynowPayment.add(
        `Loan Payment - ${loan.loan_no}`,
        parseFloat(paymentData.amount)
      );

      // Set mobile payment method if applicable
      if (["ecocash", "onemoney", "telecash"].includes(paymentData.provider)) {
        // Validate and format phone number
        if (!paymentData.payer_phone) {
          throw this.handleError(
            400,
            `Phone number is required for ${paymentData.provider} payment`
          );
        }

        const validatedPhone = this.constructor.validatePhoneNumber(
          paymentData.payer_phone,
          paymentData.provider
        );

        // Set auth email to phone number for mobile payments
        const phoneEmail = `${validatedPhone.replace("+", "")}@${
          paymentData.provider
        }.com`;
        paynowPayment.authEmail = phoneEmail;

        // Update payment with phone number
        payment.meta = {
          ...payment.meta,
          mobile_method: paymentData.provider,
          phone_number: validatedPhone,
        };
        await payment.save();
      }

      // Send payment to PayNow
      const response = await this.paynowIntegration.send(paynowPayment);

      if (response.success) {
        // Update payment with PayNow response
        payment.poll_url = response.pollUrl || response.pollurl || null;
        payment.provider_ref = response.reference || null;
        payment.paynow_invoice_id = paymentData.receipt_no;
        payment.payment_method_label = `${
          paymentData.provider.charAt(0).toUpperCase() +
          paymentData.provider.slice(1)
        } Payment`;
        payment.meta = {
          ...payment.meta,
          paynow_response: response,
          redirect_url: response.redirectUrl,
          instructions: response.instructions,
        };

        // If redirect URL is provided in response, update it
        if (response.redirectUrl) {
          payment.meta.redirect_url = response.redirectUrl;
        }

        await payment.save();

        // Populate before returning
        await payment.populate([
          {
            path: "loan",
            select: "loan_no customer_user principal_amount current_balance",
          },
          {
            path: "received_by",
            select: "first_name last_name email",
          },
        ]);

        return {
          success: true,
          data: {
            payment,
            poll_url: payment.poll_url,
            redirect_url: payment.meta.redirect_url || null,
            paynow_response: {
              payment_url: response.redirectUrl,
              poll_url: response.pollUrl || response.pollurl,
              instructions: response.instructions,
              method: response.method || paymentData.provider,
              success: true,
              reference: response.reference,
            },
          },
          message: `${
            paymentData.provider.charAt(0).toUpperCase() +
            paymentData.provider.slice(1)
          } payment initiated successfully`,
        };
      } else {
        // If PayNow fails, update payment status
        payment.payment_status = "failed";
        payment.meta = {
          ...payment.meta,
          paynow_error: response.error || "Unknown error",
        };
        await payment.save();

        throw this.handleError(
          400,
          `Payment initiation failed: ${response.error || "Unknown error"}`
        );
      }
    } catch (error) {
      console.error("Payment initiation error:", error);
      throw this.handleError(
        500,
        `Failed to initiate payment: ${error.message}`
      );
    }
  }

  /**
   * Get payment by ID
   */
  async getPaymentById(paymentId) {
    try {
      const payment = await Payment.findById(paymentId).populate([
        {
          path: "loan",
          select:
            "loan_no customer_user principal_amount current_balance currency status due_date",
        },
        {
          path: "loan_term",
          select:
            "term_no start_date due_date opening_balance closing_balance interest_rate_percent",
        },
        {
          path: "received_by",
          select: "first_name last_name email phone roles",
        },
      ]);

      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      // Populate customer details if loan exists
      if (payment.loan && payment.loan.customer_user) {
        const customer = await User.findById(payment.loan.customer_user).select(
          "first_name last_name email phone national_id_number"
        );
        payment.loan.customer_user = customer;
      }

      return {
        success: true,
        data: payment,
        message: "Payment retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get payments with pagination
   */
  async getPaymentsPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 }
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.loan) query.loan = filters.loan;
      if (filters.customer_user) {
        // Find loans by customer user first
        const loans = await Loan.find({
          customer_user: filters.customer_user,
        }).select("_id");
        query.loan = { $in: loans.map((loan) => loan._id) };
      }
      if (filters.payment_status) query.payment_status = filters.payment_status;
      if (filters.provider) query.provider = filters.provider;
      if (filters.currency) query.currency = filters.currency;

      // Date range filters
      if (filters.paid_from || filters.paid_to) {
        query.paid_at = {};
        if (filters.paid_from) query.paid_at.$gte = new Date(filters.paid_from);
        if (filters.paid_to) query.paid_at.$lte = new Date(filters.paid_to);
      }

      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      // Amount range filters
      if (filters.min_amount || filters.max_amount) {
        query.amount = {};
        if (filters.min_amount)
          query.amount.$gte = parseFloat(filters.min_amount);
        if (filters.max_amount)
          query.amount.$lte = parseFloat(filters.max_amount);
      }

      // Execute query with pagination
      const [payments, total] = await Promise.all([
        Payment.find(query)
          .populate([
            {
              path: "loan",
              select: "loan_no customer_user principal_amount currency",
            },
            {
              path: "received_by",
              select: "first_name last_name email",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Payment.countDocuments(query),
      ]);

      // Populate customer details for each payment
      const populatedPayments = await Promise.all(
        payments.map(async (payment) => {
          if (payment.loan && payment.loan.customer_user) {
            const customer = await User.findById(payment.loan.customer_user)
              .select("first_name last_name email phone")
              .lean();
            payment.loan.customer_user = customer;
          }
          return payment;
        })
      );

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          payments: populatedPayments,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Payments retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all payments without pagination
   */
  async getAllPayments(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.loan) query.loan = filters.loan;
      if (filters.payment_status) query.payment_status = filters.payment_status;
      if (filters.provider) query.provider = filters.provider;

      const payments = await Payment.find(query)
        .populate([
          {
            path: "loan",
            select: "loan_no customer_user principal_amount currency",
          },
          {
            path: "received_by",
            select: "first_name last_name email",
          },
        ])
        .sort(sort)
        .lean();

      // Populate customer details
      const populatedPayments = await Promise.all(
        payments.map(async (payment) => {
          if (payment.loan && payment.loan.customer_user) {
            const customer = await User.findById(payment.loan.customer_user)
              .select("first_name last_name email phone")
              .lean();
            payment.loan.customer_user = customer;
          }
          return payment;
        })
      );

      return {
        success: true,
        data: populatedPayments,
        message: "All payments retrieved successfully",
        count: populatedPayments.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update payment
   */
  async updatePayment(paymentId, updateData, userId) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      // Prevent updating certain fields if payment is already paid
      if (payment.payment_status === "paid") {
        const restrictedFields = [
          "amount",
          "currency",
          "provider",
          "loan",
          "loan_term",
        ];
        for (const field of restrictedFields) {
          if (
            updateData[field] !== undefined &&
            updateData[field] !== payment[field]
          ) {
            throw this.handleError(
              400,
              `Cannot update ${field} for a paid payment`
            );
          }
        }
      }

      // Update payment
      const updatedPayment = await Payment.findByIdAndUpdate(
        paymentId,
        updateData,
        { new: true, runValidators: true }
      ).populate([
        {
          path: "loan",
          select: "loan_no customer_user principal_amount",
        },
      ]);

      // If status changed to paid, update loan balance
      if (
        updateData.payment_status === "paid" &&
        payment.payment_status !== "paid"
      ) {
        await this.updateLoanBalance(updatedPayment);

        // Send email notification
        await this.sendPaymentConfirmationEmail(updatedPayment);
      }

      return {
        success: true,
        data: updatedPayment,
        message: "Payment updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Check PayNow payment status
   */
  async checkPayNowStatus(paymentId) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      // Only check status for PayNow and mobile payments
      const onlineMethods = ["paynow", "ecocash", "onemoney", "telecash"];
      if (!onlineMethods.includes(payment.provider)) {
        throw this.handleError(
          400,
          "This payment method does not support status checking"
        );
      }

      if (!payment.poll_url) {
        throw this.handleError(400, "No poll URL found for this payment");
      }

      // Check payment status from PayNow
      const response = await this.paynowIntegration.pollTransaction(
        payment.poll_url
      );

      if (!response) {
        throw this.handleError(502, "Unable to reach PayNow");
      }

      // Map PayNow status to your system's status
      const mapStatus = (status) => {
        const s = String(status || "").toLowerCase();
        if (s.includes("paid") || s.includes("completed")) return "paid";
        if (s.includes("awaiting delivery")) return "awaiting_delivery";
        if (s.includes("awaiting confirmation")) return "awaiting_confirmation";
        if (s.includes("sent") || s.includes("created")) return "sent";
        if (s.includes("cancel")) return "cancelled";
        if (s.includes("fail")) return "failed";
        return "pending";
      };

      const newStatus = mapStatus(response.status);

      // Update payment status
      payment.payment_status = newStatus;
      if (newStatus === "paid" && !payment.captured_at) {
        payment.captured_at = new Date();
      }

      // Update meta with latest response
      payment.meta = {
        ...payment.meta,
        last_status_check: new Date(),
        paynow_status: response.status,
        raw_response: response,
      };

      await payment.save();

      // Update loan balance if paid
      if (newStatus === "paid") {
        await this.updateLoanBalance(payment);
        await this.sendPaymentConfirmationEmail(payment);
      }

      return {
        success: true,
        data: {
          payment,
          poll_url: payment.poll_url,
          gateway_status: response.status,
          status: newStatus,
          paid: newStatus === "paid",
          amount: response.amount,
          captured_at: newStatus === "paid" ? new Date() : null,
        },
        message: `Payment status: ${newStatus}`,
      };
    } catch (error) {
      console.error("PayNow status check error:", error);
      throw this.handleError(
        500,
        "Failed to check payment status: " + error.message
      );
    }
  }

  /**
   * Process PayNow webhook/callback
   */
  async processPayNowWebhook(webhookData) {
    try {
      const { reference, status, pollUrl, method, amount } = webhookData;

      // Find payment by provider_ref or receipt_no
      const payment = await Payment.findOne({
        $or: [
          { provider_ref: reference },
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
      if (payment.poll_url) {
        return await this.checkPayNowStatus(payment._id);
      }

      // Otherwise, update based on webhook status
      if (status) {
        const mapStatus = (s) => {
          const x = String(s || "").toLowerCase();
          if (x.includes("paid") || x.includes("completed")) return "paid";
          if (x.includes("awaiting delivery")) return "awaiting_delivery";
          if (x.includes("awaiting confirmation"))
            return "awaiting_confirmation";
          if (x.includes("cancel")) return "cancelled";
          if (x.includes("fail")) return "failed";
          return "pending";
        };

        const newStatus = mapStatus(status);
        payment.payment_status = newStatus;
        if (newStatus === "paid" && !payment.captured_at) {
          payment.captured_at = new Date();
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

        // Update loan balance if paid
        if (newStatus === "paid") {
          await this.updateLoanBalance(payment);
          await this.sendPaymentConfirmationEmail(payment);
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
   * Refund payment
   */
  async refundPayment(paymentId, refundData, userId) {
    try {
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw this.handleError(404, `Payment with ID ${paymentId} not found`);
      }

      if (payment.payment_status !== "paid") {
        throw this.handleError(400, "Cannot refund a payment that is not paid");
      }

      const refundAmount = refundData.amount || payment.amount;
      if (refundAmount > payment.amount) {
        throw this.handleError(
          400,
          "Refund amount cannot exceed original payment amount"
        );
      }

      // Add refund record
      payment.refunds = payment.refunds || [];
      payment.refunds.push({
        amount: refundAmount,
        provider_ref: refundData.provider_ref || `REFUND-${Date.now()}`,
        at: new Date(),
        refunded_by: userId,
      });

      await payment.save();

      // If PayNow/mobile payment, initiate refund through provider
      if (
        ["paynow", "ecocash", "onemoney", "telecash"].includes(
          payment.provider
        ) &&
        payment.provider_ref
      ) {
        console.log(
          `Processing refund for ${payment.provider} payment ${paymentId}`
        );
        // Implement refund logic here for PayNow/mobile payments
      }

      return {
        success: true,
        data: {
          payment,
          poll_url: payment.poll_url,
        },
        message: `Refund of ${refundAmount} processed successfully`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get payments by customer/user
   */
  async getPaymentsByCustomer(customerId, page = 1, limit = 10) {
    try {
      const user = await User.findById(customerId);
      if (!user) {
        throw this.handleError(404, `Customer with ID ${customerId} not found`);
      }

      return this.getPaymentsPaginated(
        { customer_user: customerId },
        page,
        limit
      );
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get payments by loan
   */
  async getPaymentsByLoan(loanId, page = 1, limit = 10) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw this.handleError(404, `Loan with ID ${loanId} not found`);
      }

      return this.getPaymentsPaginated({ loan: loanId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats() {
    try {
      const total = await Payment.countDocuments();

      const byStatus = await Payment.aggregate([
        { $group: { _id: "$payment_status", count: { $sum: 1 } } },
      ]);

      const byProvider = await Payment.aggregate([
        { $group: { _id: "$provider", count: { $sum: 1 } } },
      ]);

      const byCurrency = await Payment.aggregate([
        { $group: { _id: "$currency", count: { $sum: 1 } } },
      ]);

      const totalAmount = await Payment.aggregate([
        { $match: { payment_status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const monthlyRevenue = await Payment.aggregate([
        {
          $match: {
            payment_status: "paid",
            paid_at: { $exists: true },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$paid_at" },
              month: { $month: "$paid_at" },
            },
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 },
      ]);

      // Convert aggregates to objects
      const statusStats = {};
      byStatus.forEach((item) => {
        statusStats[item._id] = item.count;
      });

      const providerStats = {};
      byProvider.forEach((item) => {
        providerStats[item._id] = item.count;
      });

      const currencyStats = {};
      byCurrency.forEach((item) => {
        currencyStats[item._id] = item.count;
      });

      // Get mobile payment stats
      const mobilePayments = await Payment.countDocuments({
        provider: { $in: ["ecocash", "onemoney", "telecash"] },
      });

      const pendingMobile = await Payment.countDocuments({
        provider: { $in: ["paynow", "ecocash", "onemoney", "telecash"] },
        payment_status: { $in: ["pending", "awaiting_confirmation"] },
      });

      return {
        total,
        by_status: statusStats,
        by_provider: providerStats,
        by_currency: currencyStats,
        total_amount: totalAmount[0]?.total || 0,
        monthly_revenue: monthlyRevenue,
        today_payments: await Payment.countDocuments({
          paid_at: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
          payment_status: "paid",
        }),
        pending_payments: statusStats.pending || 0,
        failed_payments: statusStats.failed || 0,
        mobile_payments: mobilePayments,
        pending_mobile: pendingMobile,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan balance after payment
   */
  async updateLoanBalance(payment) {
    try {
      if (!payment.loan) return;

      const loan = await Loan.findById(payment.loan);
      if (!loan) return;

      // Calculate new balance
      const newBalance = Math.max(0, loan.current_balance - payment.amount);
      loan.current_balance = newBalance;

      // Update loan status if fully paid
      if (newBalance === 0) {
        loan.status = "redeemed";
      }

      // Add payment record to loan meta
      loan.meta = loan.meta || {};
      loan.meta.payments = loan.meta.payments || [];
      loan.meta.payments.push({
        payment_id: payment._id,
        amount: payment.amount,
        date: payment.paid_at || new Date(),
        receipt_no: payment.receipt_no,
        poll_url: payment.poll_url,
      });

      await loan.save();

      // Update associated asset if exists
      if (loan.asset) {
        const Asset = require("../models/asset_model");
        await Asset.findByIdAndUpdate(loan.asset, {
          $set: {
            status: newBalance === 0 ? "redeemed" : "pawned",
          },
        });
      }
    } catch (error) {
      console.error("Failed to update loan balance:", error);
      throw error;
    }
  }

  /**
   * Send payment confirmation email
   */
  async sendPaymentConfirmationEmail(payment) {
    try {
      // Get loan and customer details
      const populatedPayment = await Payment.findById(payment._id).populate({
        path: "loan",
        select: "loan_no customer_user",
        populate: {
          path: "customer_user",
          select: "first_name last_name email",
        },
      });

      if (!populatedPayment.loan || !populatedPayment.loan.customer_user) {
        console.warn("No customer found for payment email");
        return;
      }

      const customer = populatedPayment.loan.customer_user;
      const loan = populatedPayment.loan;

      // Send email
      await emailService.sendTransactionNotificationEmail({
        to: customer.email,
        fullName: `${customer.first_name} ${customer.last_name}`,
        notification: {
          subject: `Payment Confirmation - Receipt #${payment.receipt_no}`,
          message: `Your payment of ${payment.currency} ${payment.amount} has been successfully processed.`,
          metadata: {
            "Receipt Number": payment.receipt_no,
            "Loan Number": loan.loan_no,
            "Amount Paid": `${payment.currency} ${payment.amount}`,
            "Payment Method": payment.provider,
            "Payment Date": payment.paid_at
              ? payment.paid_at.toLocaleDateString()
              : new Date().toLocaleDateString(),
            "Transaction Status": "Completed",
            "New Loan Balance": `${loan.currency} ${loan.current_balance}`,
            "Poll URL": payment.poll_url || "N/A",
          },
        },
      });

      console.log(`Payment confirmation email sent to ${customer.email}`);
    } catch (error) {
      console.error("Failed to send payment confirmation email:", error);
      // Don't throw error - email failure shouldn't break payment flow
    }
  }

  /**
   * Generate payment report
   */
  async generatePaymentReport(filters = {}) {
    try {
      const query = {};

      if (filters.start_date)
        query.paid_at = { $gte: new Date(filters.start_date) };
      if (filters.end_date) {
        query.paid_at = query.paid_at || {};
        query.paid_at.$lte = new Date(filters.end_date);
      }
      if (filters.payment_status) query.payment_status = filters.payment_status;
      if (filters.provider) query.provider = filters.provider;

      const payments = await Payment.find(query)
        .populate([
          {
            path: "loan",
            select: "loan_no customer_user",
            populate: {
              path: "customer_user",
              select: "first_name last_name email national_id_number",
            },
          },
        ])
        .sort({ paid_at: -1 })
        .lean();

      // Calculate summary
      const summary = {
        total_payments: payments.length,
        total_amount: payments.reduce((sum, p) => sum + p.amount, 0),
        by_provider: {},
        by_status: {},
        by_currency: {},
        mobile_payments_count: 0,
        mobile_payments_amount: 0,
      };

      payments.forEach((payment) => {
        summary.by_provider[payment.provider] =
          (summary.by_provider[payment.provider] || 0) + 1;
        summary.by_status[payment.payment_status] =
          (summary.by_status[payment.payment_status] || 0) + 1;
        summary.by_currency[payment.currency] =
          (summary.by_currency[payment.currency] || 0) + payment.amount;

        // Count mobile payments
        if (["ecocash", "onemoney", "telecash"].includes(payment.provider)) {
          summary.mobile_payments_count++;
          summary.mobile_payments_amount += payment.amount;
        }
      });

      return {
        success: true,
        data: {
          payments,
          summary,
          generated_at: new Date(),
          filters,
        },
        message: "Payment report generated successfully",
      };
    } catch (error) {
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
    console.error("Payment Service Error:", error);

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

module.exports = new PaymentService();
