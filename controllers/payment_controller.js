const paymentService = require("../services/payment_service");

class PaymentController {
  /**
   * Create a new payment
   */
  async createPayment(req, res) {
    try {
      const paymentData = req.body;
      const userId = req.user?.id;

      // Validate mobile payments
      const mobileMethods = ["ecocash", "onemoney", "telecash"];
      if (
        mobileMethods.includes(paymentData.provider) &&
        !paymentData.payer_phone
      ) {
        return res.status(400).json({
          success: false,
          message: `Phone number is required for ${paymentData.provider} payment`,
        });
      }

      const result = await paymentService.createPayment(paymentData, userId);

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create payment",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Get payment by ID
   */
  async getPayment(req, res) {
    try {
      const { id } = req.params;

      const result = await paymentService.getPaymentById(id);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payment",
        detail: error.detail,
      });
    }
  }

  /**
   * Get payments with pagination
   */
  async getPayments(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        loan,
        customer_user,
        payment_status,
        provider,
        currency,
        paid_from,
        paid_to,
        created_from,
        created_to,
        min_amount,
        max_amount,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      // Parse page and limit
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      // Validate pagination params
      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        });
      }

      // Build sort object
      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      // Build filters
      const filters = {
        loan,
        customer_user,
        payment_status,
        provider,
        currency,
        paid_from,
        paid_to,
        created_from,
        created_to,
        min_amount,
        max_amount,
      };

      const result = await paymentService.getPaymentsPaginated(
        filters,
        pageNum,
        limitNum,
        sort
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payments",
        detail: error.detail,
      });
    }
  }

  /**
   * Get all payments without pagination
   */
  async getAllPayments(req, res) {
    try {
      const {
        loan,
        payment_status,
        provider,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      // Build sort object
      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      // Build filters
      const filters = { loan, payment_status, provider };

      const result = await paymentService.getAllPayments(filters, sort);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
        count: result.count,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payments",
        detail: error.detail,
      });
    }
  }

  /**
   * Update payment
   */
  async updatePayment(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      const result = await paymentService.updatePayment(id, updateData, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update payment",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Check PayNow payment status
   */
  async checkPayNowStatus(req, res) {
    try {
      const { id } = req.params;

      const result = await paymentService.checkPayNowStatus(id);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to check payment status",
        detail: error.detail,
      });
    }
  }

  /**
   * Process PayNow webhook/callback
   */
  async processPayNowWebhook(req, res) {
    try {
      const webhookData = req.body;

      const result = await paymentService.processPayNowWebhook(webhookData);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to process webhook",
        detail: error.detail,
      });
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(req, res) {
    try {
      const { id } = req.params;
      const refundData = req.body;
      const userId = req.user?.id;

      if (!refundData.amount || refundData.amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Refund amount is required and must be greater than 0",
        });
      }

      const result = await paymentService.refundPayment(id, refundData, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to refund payment",
        detail: error.detail,
      });
    }
  }

  /**
   * Get payments by customer
   */
  async getPaymentsByCustomer(req, res) {
    try {
      const { customerId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await paymentService.getPaymentsByCustomer(
        customerId,
        pageNum,
        limitNum
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payments by customer",
        detail: error.detail,
      });
    }
  }

  /**
   * Get payments by loan
   */
  async getPaymentsByLoan(req, res) {
    try {
      const { loanId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await paymentService.getPaymentsByLoan(
        loanId,
        pageNum,
        limitNum
      );

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payments by loan",
        detail: error.detail,
      });
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(req, res) {
    try {
      const result = await paymentService.getPaymentStats();

      res.status(200).json({
        success: true,
        message: "Payment statistics retrieved successfully",
        data: result,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payment statistics",
        detail: error.detail,
      });
    }
  }

  /**
   * Get mobile payment methods
   */
  async getMobilePaymentMethods(req, res) {
    try {
      const result = await paymentService.getMobilePaymentMethods();

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve mobile payment methods",
        detail: error.detail,
      });
    }
  }

  /**
   * Generate payment report
   */
  async generatePaymentReport(req, res) {
    try {
      const {
        start_date,
        end_date,
        payment_status,
        provider,
        format = "json", // json, csv, pdf
      } = req.query;

      const filters = { start_date, end_date, payment_status, provider };

      const result = await paymentService.generatePaymentReport(filters);

      // Return in different formats
      if (format === "csv") {
        // Convert to CSV
        const csv = this.convertToCSV(result.data.payments);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=payment-report-${Date.now()}.csv`
        );
        return res.send(csv);
      } else if (format === "pdf") {
        // For PDF, you would use a PDF generation library
        // For now, return JSON
        res.status(200).json({
          success: true,
          message: "PDF generation not implemented, returning JSON",
          data: result.data,
        });
      } else {
        // Default JSON response
        res.status(200).json({
          success: true,
          message: result.message,
          data: result.data,
        });
      }
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to generate payment report",
        detail: error.detail,
      });
    }
  }

  /**
   * Get payment summary for dashboard
   */
  async getPaymentSummary(req, res) {
    try {
      const stats = await paymentService.getPaymentStats();

      // Get recent payments
      const recentPayments = await require("../models/payment.model")
        .find({ payment_status: "paid" })
        .sort({ paid_at: -1 })
        .limit(10)
        .populate({
          path: "loan",
          select: "loan_no customer_user",
          populate: {
            path: "customer_user",
            select: "first_name last_name",
          },
        })
        .lean();

      res.status(200).json({
        success: true,
        message: "Payment summary retrieved successfully",
        data: {
          stats,
          recent_payments: recentPayments,
          summary: {
            total_revenue: stats.total_amount,
            average_payment: stats.total_amount / (stats.by_status.paid || 1),
            payment_success_rate:
              (((stats.by_status.paid || 0) / stats.total) * 100).toFixed(2) +
              "%",
            mobile_payments_percentage:
              ((stats.mobile_payments / stats.total) * 100).toFixed(2) + "%",
          },
        },
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve payment summary",
        detail: error.message,
      });
    }
  }

  /**
   * Verify payment receipt
   */
  async verifyReceipt(req, res) {
    try {
      const { receipt_no } = req.params;

      const payment = await require("../models/payment.model")
        .findOne({ receipt_no })
        .populate([
          {
            path: "loan",
            select:
              "loan_no customer_user principal_amount current_balance currency",
            populate: {
              path: "customer_user",
              select: "first_name last_name email phone",
            },
          },
          {
            path: "received_by",
            select: "first_name last_name",
          },
        ]);

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: `Payment with receipt number ${receipt_no} not found`,
        });
      }

      res.status(200).json({
        success: true,
        message: "Payment receipt verified successfully",
        data: payment,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to verify receipt",
        detail: error.message,
      });
    }
  }

  /**
   * Helper: Convert to CSV
   */
  convertToCSV(payments) {
    if (!payments || payments.length === 0) {
      return "No data available";
    }

    const headers = [
      "Receipt No",
      "Date",
      "Customer",
      "Loan No",
      "Amount",
      "Currency",
      "Payment Method",
      "Status",
      "Provider Reference",
      "Poll URL",
    ];

    const rows = payments.map((payment) => [
      payment.receipt_no || "",
      payment.paid_at ? new Date(payment.paid_at).toLocaleDateString() : "",
      payment.loan?.customer_user
        ? `${payment.loan.customer_user.first_name} ${payment.loan.customer_user.last_name}`
        : "",
      payment.loan?.loan_no || "",
      payment.amount || 0,
      payment.currency || "USD",
      payment.provider || "",
      payment.payment_status || "",
      payment.provider_ref || "",
      payment.poll_url || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    return csvContent;
  }
}

module.exports = new PaymentController();
