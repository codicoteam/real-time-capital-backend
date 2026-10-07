const loanService = require("../services/loan_service");
const agentCommissionService = require("../services/agent_commission_service");
const mongoose = require("mongoose");

const STAFF_ROLES = ["loan_officer_processor", "loan_officer_approval", "admin_pawn_limited", "super_admin_vendor", "management"];

// A customer or agent reaches GET /loans/:id directly (see loan_router.js) — strip staff
// identity, override reasoning and approval-workflow detail out of the rollover history
// before it ever leaves the server, the same way the legacy rollover_override field
// already needed to be kept off their view. Everyone else (staff) sees it all.
function redactRolloverDetailForRole(loanDoc, roles) {
  if (!loanDoc) return loanDoc;
  const isStaff = Array.isArray(roles) && roles.some((r) => STAFF_ROLES.includes(r));
  if (isStaff) return loanDoc;

  const loan = typeof loanDoc.toObject === "function" ? loanDoc.toObject() : { ...loanDoc };
  loan.rollover_override = null;
  loan.pending_rollover_approval = loan.pending_rollover_approval
    ? { status: loan.pending_rollover_approval.status, expires_at: loan.pending_rollover_approval.expires_at || null }
    : null;
  loan.rollover_cycles = (loan.rollover_cycles || []).map((cycle) => {
    const { performed_by, performed_by_name, performed_by_role, override, approval, ...rest } = cycle;
    if (rest.payment) {
      const { received_by, notes, ...paymentRest } = rest.payment;
      rest.payment = paymentRest;
    }
    return rest;
  });
  return loan;
}

class LoanController {
  /**
   * Create a new loan
   */
  async createLoan(req, res) {
    try {
      const loanData = req.body;
      const userId = req.user?.id;

      const result = await loanService.createLoan(loanData, userId);

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create loan",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Add more principal to an already-active loan (Loan Processor/Admin only).
   */
  async topUpLoan(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;
      const result = await loanService.topUpLoan(id, req.body, userId);
      res.status(200).json({
        success: true,
        message: "Loan topped up successfully",
        data: { loan: result.loan, top_up: result.topUp },
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to top up loan",
      });
    }
  }

  /**
   * Create asset from collateral (utility endpoint)
   */
  async createAssetFromCollateral(req, res) {
    try {
      const { applicationId } = req.params;

      const result = await loanService.createAssetFromCollateral(applicationId);

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to create asset from collateral",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loan by ID
   */
  async getLoan(req, res) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid loan ID." });
      }

      const result = await loanService.getLoanById(id);
      const data = redactRolloverDetailForRole(result.data, req.user?.roles);

      res.status(200).json({
        success: true,
        message: result.message,
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loans with pagination
   */
  async getLoans(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        customer_user,
        status,
        collateral_category,
        loan_no,
        approval_status,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        });
      }

      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };

      const filters = {
        customer_user,
        status,
        collateral_category,
        loan_no,
        approval_status,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount,
      };

      const result = await loanService.getLoansPaginated(
        filters,
        pageNum,
        limitNum,
        sort,
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
        message: error.message || "Failed to retrieve loans",
        detail: error.detail,
      });
    }
  }

  /**
   * Get all loans without pagination
   */
  async getAllLoans(req, res) {
    try {
      const {
        customer_user,
        status,
        collateral_category,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const sort = { [sort_by]: sort_order === "asc" ? 1 : -1 };
      const filters = { customer_user, status, collateral_category };

      const result = await loanService.getAllLoans(filters, sort);

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
        message: error.message || "Failed to retrieve loans",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loans for agent - view loans for customers they added
   */
  async getAgentLoans(req, res) {
    try {
      const agentId = req.user?.id;
      const {
        page = 1,
        limit = 10,
        status,
        collateral_category,
        loan_no,
        approval_status,
        requires_super_admin_approval,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount,
        sort_by = "created_at",
        sort_order = "desc",
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        });
      }

      const filters = {
        status,
        collateral_category,
        loan_no,
        approval_status,
        created_from,
        created_to,
        due_from,
        due_to,
        min_amount,
        max_amount,
        sort_by,
        sort_order,
      };

      if (requires_super_admin_approval !== undefined) {
        filters.requires_super_admin_approval =
          requires_super_admin_approval === "true";
      }

      const result = await loanService.getLoansForAgent(
        agentId,
        filters,
        pageNum,
        limitNum,
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
        message: error.message || "Failed to retrieve agent loans",
        detail: error.detail,
      });
    }
  }

  /**
   * Get agent customer loans summary - statistics for agent's customers
   */
  async getAgentCustomerLoansSummary(req, res) {
    try {
      const agentId = req.user?.id;

      const result = await loanService.getAgentCustomerLoansSummary(agentId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve agent loan summary",
        detail: error.detail,
      });
    }
  }

  /**
   * Get the calling agent's own referral commissions (loans they referred that carry an
   * admin-fee and/or interest commission cut).
   */
  async getMyCommissions(req, res) {
    try {
      const agentId = req.user?.id;
      const { status, page = 1, limit = 20 } = req.query;
      const result = await agentCommissionService.getAgentCommissions(agentId, {
        status,
        page: parseInt(page),
        limit: Math.min(100, parseInt(limit)),
      });
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ success: false, message: error.message || "Failed to retrieve commissions" });
    }
  }

  /**
   * Get the calling agent's own pending/paid/lifetime commission totals.
   */
  async getMyCommissionsSummary(req, res) {
    try {
      const agentId = req.user?.id;
      const summary = await agentCommissionService.getAgentCommissionsSummary(agentId);
      res.status(200).json({ success: true, summary });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ success: false, message: error.message || "Failed to retrieve commission summary" });
    }
  }

  /**
   * Update loan
   */
  async updateLoan(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const userId = req.user?.id;

      const result = await loanService.updateLoan(id, updateData, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan",
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Update loan status — when activating, accepts disbursement details
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const {
        status,
        notes,
        disbursement_reference,
        disbursement_notes,
        disbursement_payment_method,
        bank_account_key,
        admin_fee_bank_account_key,
      } = req.body;
      const userId = req.user?.id;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const disbursementDetails =
        status === "active"
          ? {
              disbursement_reference: disbursement_reference || null,
              disbursement_notes: disbursement_notes || null,
              payment_method: disbursement_payment_method || null,
              bank_account_key: bank_account_key || null,
              admin_fee_bank_account_key: admin_fee_bank_account_key || null,
            }
          : null;

      const result = await loanService.updateLoanStatus(
        id,
        status,
        notes,
        userId,
        disbursementDetails,
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
        message: error.message || "Failed to update loan status",
        detail: error.detail,
      });
    }
  }

  /**
   * Request super admin approval for a loan
   */
  async requestSuperAdminApproval(req, res) {
    try {
      const { id } = req.params;
      const { superAdminIds } = req.body;
      const userId = req.user?.id;

      if (
        !superAdminIds ||
        !Array.isArray(superAdminIds) ||
        superAdminIds.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide an array of super admin IDs (1-3)",
        });
      }

      if (superAdminIds.length > 3) {
        return res.status(400).json({
          success: false,
          message: "Cannot request approval from more than 3 super admins",
        });
      }

      const result = await loanService.requestSuperAdminApproval(
        id,
        superAdminIds,
        userId,
      );
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to request approval",
        detail: error.detail,
      });
    }
  }

  /**
   * Super admin approves a loan
   */
  async approveLoanBySuperAdmin(req, res) {
    try {
      const { id } = req.params;
      const superAdminId = req.user?.id;

      const result = await loanService.approveLoanBySuperAdmin(
        id,
        superAdminId,
      );
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to approve loan",
        detail: error.detail,
      });
    }
  }

  /**
   * Admin override — super_admin_vendor only.
   * Bypasses all status-transition guards, optionally records a payment,
   * cancels any live auction, and force-sets the loan to any status.
   */
  async adminOverride(req, res) {
    try {
      const { id } = req.params;
      const adminUserId = req.user?.id;
      const result = await loanService.adminOverrideLoan(id, req.body, adminUserId, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Admin override failed",
        detail:  error.detail,
      });
    }
  }

  /**
   * Delete loan (soft delete)
   */
  async deleteLoan(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const result = await loanService.deleteLoan(id, userId);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to delete loan",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loans by customer
   */
  async getLoansByCustomer(req, res) {
    try {
      const { customerId } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await loanService.getLoansByCustomer(
        customerId,
        pageNum,
        limitNum,
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
        message: error.message || "Failed to retrieve loans by customer",
        detail: error.detail,
      });
    }
  }

  /**
   * Search loans
   */
  async searchLoans(req, res) {
    try {
      const { q } = req.query;
      const { page = 1, limit = 10 } = req.query;

      if (!q || q.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Search term must be at least 2 characters long",
        });
      }

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);

      const result = await loanService.searchLoans(q.trim(), pageNum, limitNum);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to search loans",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loan statistics
   */
  async getLoanStats(req, res) {
    try {
      const result = await loanService.getLoanStats();

      res.status(200).json({
        success: true,
        message: "Loan statistics retrieved successfully",
        data: result,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan statistics",
        detail: error.detail,
      });
    }
  }

  /**
   * Calculate loan charges
   */
  async calculateCharges(req, res) {
    try {
      const { id } = req.params;

      const result = await loanService.calculateLoanCharges(id);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to calculate loan charges",
        detail: error.detail,
      });
    }
  }

  /**
   * Refresh pending PayNow payments for a loan — polls gateway and updates statuses
   */
  async refreshPendingPayments(req, res) {
    try {
      const { id } = req.params;
      const paymentService = require("../services/payment_service");
      const result = await paymentService.refreshPendingPayments(id);
      res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to refresh pending payments",
        detail: error.detail,
      });
    }
  }

  /**
   * Process loan payment
   */
  async processPayment(req, res) {
    try {
      const { id } = req.params;
      const paymentData = req.body;

      if (!paymentData.amount || paymentData.amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Payment amount is required and must be greater than 0",
        });
      }

      const result = await loanService.processPayment(id, paymentData);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to process payment",
        detail: error.detail,
      });
    }
  }

  /**
   * Waive the late-payment penalty on a loan (Loan Processor / Admin decision,
   * made at the point of repayment). Notifies admins/processors and audit-logs
   * the decision.
   */
  async waivePenalty(req, res) {
    try {
      const { id } = req.params;
      const { reason, overrideAmount } = req.body;
      const userId = req.user?.id;

      const result = await loanService.waivePenalty(
        id,
        { reason, overrideAmount },
        userId,
        { ip: req.ip, userAgent: req.headers["user-agent"] }
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
        message: error.message || "Failed to waive penalty",
        detail: error.detail,
      });
    }
  }

  /**
   * Reverse (undo) a penalty waiver — recorded by mistake or during testing.
   * Super Admin only.
   */
  async reversePenaltyWaiver(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id;

      const result = await loanService.reversePenaltyWaiver(
        id,
        { reason },
        userId,
        { ip: req.ip, userAgent: req.headers["user-agent"] }
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
        message: error.message || "Failed to reverse penalty waiver",
        detail: error.detail,
      });
    }
  }

  /**
   * Freeze a loan's interest — stops the automatic penalty-on-grace charge and blocks
   * rollover, so the balance owed stays put. Admin only (enforced at the route layer).
   */
  async freezeInterest(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id;

      const result = await loanService.freezeInterest(
        id,
        { reason },
        userId,
        { ip: req.ip, userAgent: req.headers["user-agent"] }
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
        message: error.message || "Failed to freeze interest",
        detail: error.detail,
      });
    }
  }

  /** Undo freezeInterest. Admin only (enforced at the route layer). */
  async unfreezeInterest(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const userId = req.user?.id;

      const result = await loanService.unfreezeInterest(
        id,
        { reason },
        userId,
        { ip: req.ip, userAgent: req.headers["user-agent"] }
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
        message: error.message || "Failed to unfreeze interest",
        detail: error.detail,
      });
    }
  }

  /**
   * Roll over a loan — close it out and open a new loan cycle on the same asset
   */
  async rolloverLoan(req, res) {
    try {
      const { id } = req.params;
      const rolloverData = req.body;
      const userId = req.user?.id;

      // Payment/override validation lives in loanService.rolloverLoan (a rollover needs a
      // payment > 0 unless an override with a reason is supplied) — one source of truth.
      const result = await loanService.rolloverLoan(id, rolloverData, userId, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to roll over loan",
        code: error.code,
        errors: error.errors,
        detail: error.detail,
      });
    }
  }

  /**
   * Request admin approval for a loan's 4th+ rollover.
   */
  async requestRolloverApproval(req, res) {
    try {
      const { id } = req.params;
      const result = await loanService.requestRolloverApproval(id, req.body, req.user?.id);
      res.status(200).json({ success: true, message: result.message, data: result.data });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ success: false, message: error.message || "Failed to request rollover approval.", detail: error.detail });
    }
  }

  /**
   * An admin approves or rejects a pending rollover approval request.
   */
  async decideRolloverApproval(req, res) {
    try {
      const { id, requestId } = req.params;
      const { decision, notes } = req.body;
      const result = await loanService.decideRolloverApproval(id, requestId, decision, notes, req.user?.id);
      res.status(200).json({ success: true, message: result.message, data: result.data });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ success: false, message: error.message || "Failed to decide rollover approval.", detail: error.detail });
    }
  }

  /**
   * Withdraw a still-pending rollover approval request.
   */
  async cancelRolloverApproval(req, res) {
    try {
      const { id, requestId } = req.params;
      const result = await loanService.cancelRolloverApproval(id, requestId, req.user?.id);
      res.status(200).json({ success: true, message: result.message });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({ success: false, message: error.message || "Failed to cancel rollover approval.", detail: error.detail });
    }
  }

  /**
   * Get the full rollover chain for a loan
   */
  async getRolloverChain(req, res) {
    try {
      const { id } = req.params;
      const roles = req.user?.roles || [];
      const role = roles.includes("customer") ? "customer" : roles.includes("agent") && !roles.some((r) => STAFF_ROLES.includes(r)) ? "agent" : null;

      const result = await loanService.getRolloverChain(id, role);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve rollover chain",
        detail: error.detail,
      });
    }
  }

  /**
   * Per-loan-processor rollover performance stats
   */
  async getRolloverPerformance(req, res) {
    try {
      const { created_from, created_to } = req.query;

      const result = await loanService.getRolloverPerformanceStats({
        created_from,
        created_to,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve rollover performance stats",
        detail: error.detail,
      });
    }
  }

  /**
   * Get loan application by ID (populated)
   */
  async getLoanApplication(req, res) {
    try {
      const { id } = req.params;

      const loanApplication = await require("../models/loanApplication.model")
        .findById(id)
        .populate([
          {
            path: "customer_user",
            select:
              "first_name last_name email phone national_id_number address profile_pic_url",
          },
          {
            path: "attachments",
            select: "filename url mime_type category",
          },
          {
            path: "debtor_check.matched_debtor_records",
            select: "debtor_name amount status",
          },
          {
            path: "debtor_check.checked_by",
            select: "first_name last_name email roles",
          },
        ]);

      if (!loanApplication) {
        return res.status(404).json({
          success: false,
          message: `Loan application with ID ${id} not found`,
        });
      }

      res.status(200).json({
        success: true,
        message: "Loan application retrieved successfully",
        data: loanApplication,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to retrieve loan application",
        detail: error.message,
      });
    }
  }

  /**
   * Update loan application status
   */
  async updateLoanApplicationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status, internal_notes } = req.body;
      const userId = req.user?.id;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const validStatuses = [
        "submitted",
        "processing",
        "approved",
        "rejected",
        "cancelled",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const LoanApplication = require("../models/loanApplication.model");
      const loanApplication = await LoanApplication.findById(id);

      if (!loanApplication) {
        return res.status(404).json({
          success: false,
          message: `Loan application with ID ${id} not found`,
        });
      }

      loanApplication.status = status;
      if (internal_notes) {
        loanApplication.internal_notes = internal_notes;
      }
      loanApplication.updated_at = new Date();

      loanApplication.status_history = loanApplication.status_history || [];
      loanApplication.status_history.push({
        from: loanApplication.status,
        to: status,
        changed_by: userId,
        changed_at: new Date(),
        notes: internal_notes,
      });

      await loanApplication.save();

      await loanApplication.populate([
        { path: "customer_user", select: "first_name last_name email phone" },
      ]);

      res.status(200).json({
        success: true,
        message: `Loan application status updated to ${status}`,
        data: loanApplication,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Failed to update loan application status",
        detail: error.message,
      });
    }
  }
}

module.exports = new LoanController();
