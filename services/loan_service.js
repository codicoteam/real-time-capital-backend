const mongoose = require("mongoose");
const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const { LOAN_PERIODS } = require("../configs/loan_periods");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Auction = require("../models/auction.model");
const Attachment = require("../models/attachment.model");
const { sendSmsWithMessage } = require("../utils/sms_utils");
const {
  sendEmail,
  sendLoanDisbursedAdminEmail,
  sendLoanRedeemedAdminEmail,
  sendLoanAuctionAdminEmail,
  sendLoanRolloverAdminEmail,
  sendPenaltyWaivedAdminEmail,
  sendPenaltyWaiverReversedAdminEmail,
} = require("../utils/emails_util");
const NotificationService = require("../services/notifications_service");
const investorAllocationService = require("../services/investor_allocation_service");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const xeroSyncService = require("../services/xero/xero_sync_service");
const auditLogService = require("../services/audit_log_service");
const agentCommissionService = require("../services/agent_commission_service");

// Structured reasons for an Admin Override — required so every bypass of the normal
// loan workflow is categorized (not just free text), making the audit trail and the
// admin notification actually explain WHAT happened to the loan, not just THAT it changed.
const OVERRIDE_REASON_CATEGORIES = {
  late_payment_received: "Late payment received (outside normal flow)",
  asset_sold_recovered_funds: "Asset sold / funds recovered",
  penalty_waived_goodwill: "Penalty waived as goodwill",
  dispute_resolved: "Customer dispute resolved",
  data_correction: "Data correction / system error fix",
  other: "Other",
};

// Structured reasons for an OVERRIDE rollover (rolling a loan over with no payment
// collected). Required so every bypass is categorized in the audit trail, not just free
// text. Keep in sync with ROLLOVER_OVERRIDE_REASON_OPTIONS in the frontend's
// services/loan_service/loan_service.tsx.
const ROLLOVER_OVERRIDE_REASON_CATEGORIES = {
  payment_promised: "Customer promised to pay shortly",
  payment_pending_confirmation: "Payment made but not yet confirmed / received",
  hardship_extension: "Customer hardship / extension granted",
  management_approval: "Approved by management",
  data_correction: "Data correction / system issue",
  other: "Other",
};
const ROLLOVER_OVERRIDE_NOTES_MAX = 1000;

// A loan can roll over 3 times freely; the 4th+ needs a separate admin approval before
// rolloverLoan() will perform it — see requestRolloverApproval/decideRolloverApproval.
const ROLLOVER_FREE_LIMIT = 3;
const ROLLOVER_APPROVAL_VALID_HOURS = 72;
const ROLLOVER_APPROVER_ROLES = ["super_admin_vendor", "admin_pawn_limited"];

const r2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

// The flat, once-per-cycle charge shared by loan creation (calculateRepaymentBreakdown)
// and every rollover cycle (rolloverLoan) — never prorated by literal day-count. `base`
// is whatever the caller has already decided belongs in it (principal alone, principal +
// a deferred fee, or — for a rollover, per the compounding rule confirmed 2026-09-30 —
// principal + any arrears carried into this cycle).
function computeFlatCycleCharge(base, interestRatePercent, storageRatePercent) {
  const interestAmount = r2(base * (interestRatePercent / 100));
  const storageChargeAmount = r2(base * (storageRatePercent / 100));
  const expectedTotalRepayable = r2(base + interestAmount + storageChargeAmount);
  return { interestAmount, storageChargeAmount, expectedTotalRepayable };
}

class LoanService {
  /**
   * Validates the override fields of a rollover request. Only meaningful when NO payment is
   * being collected (paymentAmount === 0) — that's the one rule an override bypasses; a
   * rollover that does collect a payment needs no override, so override fields sent
   * alongside one are ignored (returns null) rather than stamped onto a loan that didn't
   * actually bypass anything. Never trusts the client's say-so beyond that: the reason
   * must be one of the known categories, and "other" must be explained in the notes.
   *
   * Deliberately does NOT bypass: the loan-status eligibility check, or the "payment
   * covers everything owed, nothing left to roll over" check — those protect against
   * resurrecting closed loans / double-counting and are a redemption, not a rollover.
   */
  resolveRolloverOverride(rolloverData, paymentAmount) {
    const { override, override_reason_category, override_notes } = rolloverData || {};
    const requested = override === true || override === "true";
    if (!requested || paymentAmount > 0) return null;

    if (!override_reason_category || !ROLLOVER_OVERRIDE_REASON_CATEGORIES[override_reason_category]) {
      throw {
        status: 400,
        message: `override_reason_category is required for an override rollover and must be one of: ${Object.keys(ROLLOVER_OVERRIDE_REASON_CATEGORIES).join(", ")}`,
      };
    }
    const notes = typeof override_notes === "string" ? override_notes.trim() : "";
    if (override_reason_category === "other" && !notes) {
      throw { status: 400, message: 'override_notes is required when the override reason is "Other".' };
    }
    if (notes.length > ROLLOVER_OVERRIDE_NOTES_MAX) {
      throw { status: 400, message: `override_notes must be ${ROLLOVER_OVERRIDE_NOTES_MAX} characters or fewer.` };
    }

    return {
      reason_category: override_reason_category,
      reason_label: ROLLOVER_OVERRIDE_REASON_CATEGORIES[override_reason_category],
      notes: notes || null,
    };
  }

  /**
   * Resolves loanData.storage_charge_percent against the standard storage rate for its
   * loan_period_type. Called at both loan creation and any later edit that touches the
   * rate, so "negotiated" status can never drift out of sync with the actual rate on
   * record — it's derived by comparison here, not trusted from a client-sent flag.
   * Interest stays fixed to the standard schedule — only storage is negotiable.
   *
   * If the caller didn't send storage_charge_percent at all, the standard rate is used
   * (unchanged default behavior). If they sent one that differs from standard, the loan
   * is flagged negotiated and who/when is recorded; if it matches standard exactly
   * (including a staff member "negotiating" back to the standard rate), the flag clears.
   */
  async applyNegotiatedRate(loanData, period, userId) {
    const standardRate = period.storage_charge_percent;
    const requestedRate = loanData.storage_charge_percent;
    const hasRequestedRate = requestedRate !== undefined && requestedRate !== null && requestedRate !== "";

    if (hasRequestedRate) {
      const parsedRate = Number(requestedRate);
      if (Number.isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
        throw { status: 400, message: "storage_charge_percent must be a number between 0 and 100." };
      }
      loanData.storage_charge_percent = parsedRate;
    } else {
      loanData.storage_charge_percent = standardRate;
    }

    loanData.standard_storage_charge_percent = standardRate;
    loanData.is_negotiated = loanData.storage_charge_percent !== standardRate;

    if (loanData.is_negotiated) {
      let actorRole = null;
      if (userId) {
        const actor = await User.findById(userId).select("roles");
        actorRole = actor?.roles?.[0] || null;
      }
      loanData.negotiated_by = userId || null;
      loanData.negotiated_by_role = actorRole;
      loanData.negotiated_at = new Date();
      // negotiation_reason is left as whatever the caller sent (or null) — only the
      // detection/bookkeeping above needs to happen unconditionally.
    } else {
      loanData.negotiated_by = null;
      loanData.negotiated_by_role = null;
      loanData.negotiated_at = null;
      loanData.negotiation_reason = null;
    }
  }

  /**
   * Create a new loan from an approved loan application
   * This creates both the loan and converts collateral to an asset
   */
  async createLoan(loanData, userId) {
    try {
      // Generate loan number if not provided
      if (!loanData.loan_no) {
        loanData.loan_no = this.generateLoanNo();
      }

      // Set created_by if not provided
      if (!loanData.created_by && userId) {
        loanData.created_by = userId;
      }

      // Apply rates from loan_period_type — storage_charge_percent may be overridden with
      // a negotiated rate (interest/penalty/grace stay standard); see applyNegotiatedRate.
      if (loanData.loan_period_type) {
        const period = LOAN_PERIODS[loanData.loan_period_type];
        if (!period) {
          throw { status: 400, message: `Invalid loan_period_type. Must be one of: ${Object.keys(LOAN_PERIODS).join(", ")}` };
        }
        loanData.interest_rate_percent = period.interest_rate_percent;
        await this.applyNegotiatedRate(loanData, period, userId);
        loanData.interest_period_days = period.days;
        loanData.penalty_percent = period.penalty_percent;
        loanData.grace_days = period.grace_days;
        loanData.repayment_type = "once_off";
        // Set due_date from start_date + period.days if not already set
        if (loanData.start_date && !loanData.due_date) {
          const due = new Date(loanData.start_date);
          due.setDate(due.getDate() + period.days);
          loanData.due_date = due;
        }
      } else {
        throw { status: 400, message: "loan_period_type is required. Must be one of: " + Object.keys(LOAN_PERIODS).join(", ") };
      }

      // Admin fee (0-10% of principal, negotiated by the Loan Processor/Super Admin at
      // creation time) — validate before it feeds into the repayment calculation below.
      this.validateAdminFee(loanData);

      // Agent referral commission — validated against the now-resolved admin fee above
      // (admin_fee_commission_pct can't exceed admin_fee_pct). See agent_commission_service.
      await agentCommissionService.validateReferralCommission(loanData, userId);

      // Staff-selected investor — only meaningful for motor_vehicle/jewellery. small_loans
      // are always RTC's own book, so manually picking an outside investor for one would
      // contradict that rule; reject rather than silently ignore the field.
      if (loanData.preferred_investor_id) {
        if (!["motor_vehicle", "jewellery"].includes(loanData.collateral_category)) {
          throw {
            status: 400,
            message: "preferred_investor_id can only be set for motor_vehicle or jewellery loans.",
          };
        }
        if (!mongoose.Types.ObjectId.isValid(loanData.preferred_investor_id)) {
          throw { status: 400, message: "preferred_investor_id is not a valid investor ID." };
        }
      }

      // Calculate total repayable (principal + interest + storage, + admin fee if deferred)
      // and set current_balance
      this.calculateRepaymentBreakdown(loanData);

      // Determine if super admin approval is needed (amount > 500)
      if (loanData.principal_amount > 500) {
        loanData.requires_super_admin_approval = true;
        loanData.approval_status = "pending";
        loanData.status = "pending_approval";
      } else {
        // For amounts <= 500, automatically approved
        loanData.approval_status = "approved";
      }

      // Validate required dates
      this.validateLoanDates(loanData);

      // If an application is provided, validate and fetch data
      if (loanData.application) {
        const application = await LoanApplication.findById(
          loanData.application,
        ).populate("customer_user", "first_name last_name email phone roles");

        if (!application) {
          throw {
            status: 404,
            message: `Loan application with ID ${loanData.application} not found`,
          };
        }

        // Validate application is approved
        if (application.status !== "approved") {
          throw {
            status: 400,
            message:
              "Cannot create loan from unapproved application. Application status must be 'approved'.",
          };
        }

        // Auto-fill loan data from application if not provided
        if (!loanData.customer_user && application.customer_user) {
          loanData.customer_user = application.customer_user;
        }
        if (!loanData.principal_amount && application.requested_loan_amount) {
          loanData.principal_amount = application.requested_loan_amount;
        }
        if (!loanData.collateral_category && application.collateral_category) {
          loanData.collateral_category = application.collateral_category;
        }
        if (
          !loanData.collateral_description &&
          application.collateral_description
        ) {
          loanData.collateral_description = application.collateral_description;
        }
        if (!loanData.surety_description && application.surety_description) {
          loanData.surety_description = application.surety_description;
        }
        if (
          !loanData.declared_asset_value &&
          application.declared_asset_value
        ) {
          loanData.declared_asset_value = application.declared_asset_value;
        }

        // Populate loan_period_type from application if not set
        if (!loanData.loan_period_type && application.loan_period_type) {
          loanData.loan_period_type = application.loan_period_type;
        }
        loanData.repayment_type = "once_off";
      }

      // Auto-create asset from collateral when application is provided and no asset given
      if (loanData.application && !loanData.asset) {
        const asset = await this.createAssetFromCollateral(
          loanData.application,
          loanData,
        );
        if (asset && asset.success) {
          loanData.asset = asset.data._id;
        }
      } else if (loanData.asset) {
        const asset = await Asset.findById(loanData.asset);
        if (!asset) {
          throw {
            status: 404,
            message: `Asset with ID ${loanData.asset} not found`,
          };
        }
        if (asset.status === "pawned" && asset.active_loan) {
          throw {
            status: 400,
            message: "Asset is already pawned under another active loan",
          };
        }
      }

      const loan = new Loan(loanData);
      await loan.save();

      // Populate necessary fields with all 7 key fields from application
      const populatedLoan = await loan.populate([
        {
          path: "customer_user",
          select:
            "first_name last_name email phone national_id_number address profile_pic_url",
        },
        {
          path: "asset",
          select:
            "asset_no title category evaluated_value status storage_location asset_images",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category collateral_description declared_asset_value status repayment_type loan_period_type repayment_days interest_rate interest_amount total_repayable_amount",
        },
        {
          path: "created_by",
          select: "first_name last_name email roles",
        },
      ]);

      // Update asset status to 'pawned' if loan is being created as active
      if (loanData.status === "active" && loanData.asset) {
        await Asset.findByIdAndUpdate(loanData.asset, {
          status: "pawned",
          active_loan: loan._id,
        });
      }

      // Update application status to 'loan_created' and link the loan
      if (loanData.application) {
        await LoanApplication.findByIdAndUpdate(loanData.application, {
          $set: {
            status: "loan_created",
            loan_created: true,
            loan_id: loan._id,
          },
        });

        // Send in-app notification to the customer
        await this.sendLoanCreationNotification(
          loanData.application,
          loan,
          userId,
        );
      }

      return {
        success: true,
        data: populatedLoan,
        message: "Loan created successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Send notification when a loan is created from an application
   */
  async sendLoanCreationNotification(applicationId, loan, createdByUserId) {
    try {
      const application = await LoanApplication.findById(
        applicationId,
      ).populate("customer_user", "first_name last_name email phone roles _id");

      if (!application || !application.customer_user) {
        console.log(
          "Cannot send notification: Application or customer not found",
        );
        return;
      }

      const customer = application.customer_user;
      const frontendUrl = process.env.FRONTEND_URL || "https://www.rtcapital.co.zw/";

      // Create notification for the customer
      const notificationData = {
        title: "Loan Created Successfully",
        message: `Your loan of $${loan.principal_amount} has been successfully created. Loan Number: ${loan.loan_no}. You can track your loan status in your dashboard.`,
        type: "loan_disbursed",
        priority: "high",
        audience: {
          scope: "user",
          user_id: customer._id,
        },
        channels: ["in_app", "email", "sms"], // Send via all channels
        entity_type: "loan",
        entity_id: loan._id,
        action_text: "View Loan Details",
        action_url: `${frontendUrl}/customer/loans/${loan._id}`,
        data: {
          loan_id: loan._id,
          loan_no: loan.loan_no,
          application_id: applicationId,
          principal_amount: loan.principal_amount,
        },
      };

      // Use the NotificationService to create and send the notification
      const NotificationService = require("../services/notifications_service");
      const result = await NotificationService.createNotification(
        notificationData,
        createdByUserId,
      );

      console.log(
        `Loan creation notification sent to customer ${customer._id}:`,
        result,
      );
      return result;
    } catch (error) {
      console.error("Failed to send loan creation notification:", error);
      // Don't throw - notification failure shouldn't break loan creation
      return null;
    }
  }

  /**
   * Get loans for agents to view loans for their customers
   * Agents can see loans of customers they have created/added
   */
  async getLoansForAgent(agentId, filters = {}, page = 1, limit = 10) {
    try {
      // First, verify the user is an agent
      const agent = await User.findById(agentId);
      if (!agent) {
        throw { status: 404, message: "Agent not found" };
      }

      if (!agent.roles.includes("agent")) {
        throw { status: 403, message: "User is not an agent" };
      }

      // Find all customers added by this agent
      const customers = await User.find({
        added_by: agentId,
        roles: "customer",
        status: "active",
      }).select("_id");

      const customerIds = customers.map((c) => c._id);

      if (customerIds.length === 0) {
        return {
          success: true,
          data: {
            loans: [],
            pagination: {
              total: 0,
              page,
              limit,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: false,
            },
          },
          message: "No customers found for this agent",
        };
      }

      // Build query for loans
      const query = { customer_user: { $in: customerIds } };

      // Apply additional filters
      if (filters.status) query.status = filters.status;
      if (filters.collateral_category)
        query.collateral_category = filters.collateral_category;
      // A loan number from BEFORE the rollover-chain migration now lives under
      // retired_loan_nos on whichever loan absorbed it — search both so an old,
      // bookmarked loan number still finds the surviving loan.
      if (filters.loan_no) {
        const loanNoRegex = { $regex: filters.loan_no, $options: "i" };
        query.$or = [{ loan_no: loanNoRegex }, { retired_loan_nos: loanNoRegex }];
      }
      if (filters.approval_status)
        query.approval_status = filters.approval_status;
      if (filters.requires_super_admin_approval !== undefined) {
        query.requires_super_admin_approval =
          filters.requires_super_admin_approval;
      }

      // Date range filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      // Due date filters
      if (filters.due_from || filters.due_to) {
        query.due_date = {};
        if (filters.due_from) query.due_date.$gte = new Date(filters.due_from);
        if (filters.due_to) query.due_date.$lte = new Date(filters.due_to);
      }

      // Amount range filters
      if (filters.min_amount || filters.max_amount) {
        query.principal_amount = {};
        if (filters.min_amount)
          query.principal_amount.$gte = parseFloat(filters.min_amount);
        if (filters.max_amount)
          query.principal_amount.$lte = parseFloat(filters.max_amount);
      }

      const skip = (page - 1) * limit;
      const sort = filters.sort_by
        ? { [filters.sort_by]: filters.sort_order === "asc" ? 1 : -1 }
        : { created_at: -1 };

      // Execute query with pagination
      const [loans, total] = await Promise.all([
        Loan.find(query)
          .populate([
            {
              path: "customer_user",
              select:
                "first_name last_name email phone national_id_number address profile_pic_url status",
            },
            {
              path: "asset",
              select:
                "asset_no title category evaluated_value status asset_images storage_location",
            },
            {
              path: "application",
              select:
                "application_no requested_loan_amount collateral_category collateral_description declared_asset_value status",
            },
            {
              path: "created_by",
              select: "first_name last_name email roles",
            },
            {
              path: "processed_by",
              select: "first_name last_name email",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Loan.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      // Add agent-specific info to each loan (like commission tracking if needed)
      const enhancedLoans = loans.map((loan) => ({
        ...loan,
        agent_info: {
          agent_id: agentId,
          agent_name: `${agent.first_name} ${agent.last_name}`,
          can_edit:
            loan.status === "draft" || loan.status === "pending_approval",
          can_view_details: true,
        },
      }));

      return {
        success: true,
        data: {
          loans: enhancedLoans,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
          summary: {
            total_loans: total,
            active_loans: loans.filter((l) => l.status === "active").length,
            pending_approval: loans.filter(
              (l) => l.status === "pending_approval",
            ).length,
            overdue_loans: loans.filter((l) => l.status === "overdue").length,
            total_outstanding: loans.reduce(
              (sum, l) => sum + (l.current_balance || 0),
              0,
            ),
          },
        },
        message: "Agent loans retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get agent's customer loans with detailed statistics
   */
  async getAgentCustomerLoansSummary(agentId) {
    try {
      const agent = await User.findById(agentId);
      if (!agent || !agent.roles.includes("agent")) {
        throw { status: 403, message: "Invalid agent" };
      }

      const customers = await User.find({
        added_by: agentId,
        roles: "customer",
      }).select("_id");
      const customerIds = customers.map((c) => c._id);

      if (customerIds.length === 0) {
        return {
          success: true,
          data: {
            total_customers: 0,
            total_loans: 0,
            active_loans: 0,
            total_disbursed: 0,
            total_outstanding: 0,
            customers_with_loans: 0,
          },
          message: "No customers found",
        };
      }

      const loanStats = await Loan.aggregate([
        { $match: { customer_user: { $in: customerIds } } },
        {
          $group: {
            _id: null,
            total_loans: { $sum: 1 },
            active_loans: {
              $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
            },
            overdue_loans: {
              $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] },
            },
            pending_approval_loans: {
              $sum: { $cond: [{ $eq: ["$status", "pending_approval"] }, 1, 0] },
            },
            redeemed_loans: {
              $sum: { $cond: [{ $eq: ["$status", "redeemed"] }, 1, 0] },
            },
            total_principal: { $sum: "$principal_amount" },
            total_outstanding: { $sum: "$current_balance" },
            total_disbursed: { $sum: "$principal_amount" },
          },
        },
      ]);

      const customersWithLoans = await Loan.distinct("customer_user", {
        customer_user: { $in: customerIds },
      });

      const stats = loanStats[0] || {
        total_loans: 0,
        active_loans: 0,
        overdue_loans: 0,
        pending_approval_loans: 0,
        redeemed_loans: 0,
        total_principal: 0,
        total_outstanding: 0,
        total_disbursed: 0,
      };

      return {
        success: true,
        data: {
          total_customers: customerIds.length,
          customers_with_loans: customersWithLoans.length,
          total_loans: stats.total_loans,
          active_loans: stats.active_loans,
          overdue_loans: stats.overdue_loans,
          pending_approval_loans: stats.pending_approval_loans,
          redeemed_loans: stats.redeemed_loans,
          total_disbursed: stats.total_disbursed,
          total_outstanding: stats.total_outstanding,
        },
        message: "Agent loan summary retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Create an asset from a loan application's collateral details
   * Transfer collateral images to asset_images
   */
  async createAssetFromCollateral(applicationId, loanData = {}) {
    try {
      const application = await LoanApplication.findById(
        applicationId,
      ).populate(
        "customer_user",
        "first_name last_name email phone national_id_number",
      );

      if (!application) {
        throw { status: 404, message: "Loan application not found" };
      }

      // Generate asset number
      const date = new Date();
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const random = Math.floor(1000 + Math.random() * 9000);
      const assetNo = `AST${year}${month}${random}`;

      // Transfer collateral images to asset_images
      const assetImages = application.collateral_images || [];

      // Build asset data based on collateral category
      let assetData = {
        asset_no: assetNo,
        owner_user: application.customer_user._id,
        submitted_by: loanData.created_by || application.customer_user._id,
        category: this.mapCollateralCategoryToAssetCategory(
          application.collateral_category,
        ),
        title: this.generateAssetTitle(application),
        description: application.collateral_description || "",
        declared_value:
          application.declared_asset_value || application.requested_loan_amount,
        evaluated_value:
          application.declared_asset_value || application.requested_loan_amount,
        status: "submitted",
        storage_location: "pending_assignment",
        condition: "good",
        asset_images: assetImages,
      };

      // Add category-specific details
      if (
        application.collateral_category === "small_loans" &&
        application.small_loan_details
      ) {
        assetData.brand = application.small_loan_details.type;
        assetData.model = application.small_loan_details.model;
        assetData.serial_no = application.small_loan_details.serial_no;
        assetData.title =
          assetData.title ||
          application.small_loan_details.model ||
          "Small Loan Item";
      } else if (
        application.collateral_category === "motor_vehicle" &&
        application.motor_vehicle_details
      ) {
        assetData.make = application.motor_vehicle_details.make;
        assetData.model = application.motor_vehicle_details.model;
        assetData.registration_no =
          application.motor_vehicle_details.registration_no;
        assetData.engine_no = application.motor_vehicle_details.engine_no;
        assetData.chassis_no = application.motor_vehicle_details.chassis_no;
        assetData.cc_serial_no = application.motor_vehicle_details.cc_serial_no;
        assetData.title = `${application.motor_vehicle_details.make} ${application.motor_vehicle_details.model}`;
      } else if (
        application.collateral_category === "jewellery" &&
        application.jewellery_details
      ) {
        assetData.metal_type = application.jewellery_details.type;
        assetData.purity = application.jewellery_details.purity;
        assetData.weight_grams = application.jewellery_details.weight;
        assetData.title = `${application.jewellery_details.type || "Jewellery"} - ${application.jewellery_details.purity || ""}`;
      }

      const asset = new Asset(assetData);
      await asset.save();

      return {
        success: true,
        data: asset,
        message: "Asset created from collateral successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Map collateral category to asset category
   */
  mapCollateralCategoryToAssetCategory(collateralCategory) {
    const mapping = {
      small_loans: "small_loans",
      motor_vehicle: "motor_vehicle",
      jewellery: "jewellery",
    };
    return mapping[collateralCategory] || "small_loans";
  }

  /**
   * Generate asset title from application data
   */
  generateAssetTitle(application) {
    if (
      application.collateral_category === "motor_vehicle" &&
      application.motor_vehicle_details
    ) {
      const { make, model, registration_no } =
        application.motor_vehicle_details;
      return `${make || ""} ${model || ""} (${registration_no || "No Reg"})`.trim();
    }
    if (
      application.collateral_category === "jewellery" &&
      application.jewellery_details
    ) {
      return `${application.jewellery_details.type || "Jewellery"} - ${application.jewellery_details.purity || ""} (${application.jewellery_details.weight || "?"}g)`.trim();
    }
    if (
      application.collateral_category === "small_loans" &&
      application.small_loan_details
    ) {
      return `${application.small_loan_details.type || "Item"} ${application.small_loan_details.model || ""}`.trim();
    }
    return "Collateral Asset";
  }

  /**
   * Get loan by ID with full population including all 7 key fields from application
   */
  async getLoanById(loanId) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      const err = new Error("Invalid loan ID.");
      err.status = 400;
      throw err;
    }
    try {
      const loan = await Loan.findById(loanId).populate([
        {
          path: "customer_user",
          select:
            "first_name last_name email phone national_id_number address profile_pic_url",
        },
        {
          path: "asset",
          select:
            "asset_no title category evaluated_value declared_value status storage_location asset_images brand model serial_no make registration_no engine_no chassis_no metal_type purity weight_grams disposal_method disposal_sale_price disposal_profit_loss disposal_notes disposed_at rtc_owned_at",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category collateral_description declared_asset_value status repayment_type loan_period_type repayment_days interest_rate interest_amount total_repayable_amount small_loan_details motor_vehicle_details jewellery_details collateral_images surety_description",
        },
        {
          path: "created_by",
          select: "first_name last_name email roles",
        },
        {
          path: "processed_by",
          select: "first_name last_name email roles",
        },
        {
          path: "approved_by",
          select: "first_name last_name email roles",
        },
        {
          path: "requested_super_admins.super_admin",
          select: "first_name last_name email phone",
        },
        {
          path: "super_admin_approvals.approved_by",
          select: "first_name last_name email",
        },
        {
          path: "payments.received_by",
          select: "first_name last_name email",
        },
      ]);

      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      return {
        success: true,
        data: loan,
        message: "Loan retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loans with pagination - includes all 7 key fields from application
   */
  async getLoansPaginated(
    filters = {},
    page = 1,
    limit = 10,
    sort = { created_at: -1 },
  ) {
    try {
      const skip = (page - 1) * limit;

      // Build query
      const query = {};

      if (filters.customer_user) query.customer_user = filters.customer_user;
      if (filters.status) query.status = filters.status;
      if (filters.collateral_category)
        query.collateral_category = filters.collateral_category;
      // A loan number from BEFORE the rollover-chain migration now lives under
      // retired_loan_nos on whichever loan absorbed it — search both so an old,
      // bookmarked loan number still finds the surviving loan.
      if (filters.loan_no) {
        const loanNoRegex = { $regex: filters.loan_no, $options: "i" };
        query.$or = [{ loan_no: loanNoRegex }, { retired_loan_nos: loanNoRegex }];
      }
      if (filters.approval_status)
        query.approval_status = filters.approval_status;

      // Date range filters
      if (filters.created_from || filters.created_to) {
        query.created_at = {};
        if (filters.created_from)
          query.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to)
          query.created_at.$lte = new Date(filters.created_to);
      }

      // Due date filters
      if (filters.due_from || filters.due_to) {
        query.due_date = {};
        if (filters.due_from) query.due_date.$gte = new Date(filters.due_from);
        if (filters.due_to) query.due_date.$lte = new Date(filters.due_to);
      }

      // Amount range filters
      if (filters.min_amount || filters.max_amount) {
        query.principal_amount = {};
        if (filters.min_amount)
          query.principal_amount.$gte = parseFloat(filters.min_amount);
        if (filters.max_amount)
          query.principal_amount.$lte = parseFloat(filters.max_amount);
      }

      // Execute query with pagination
      const [loans, total] = await Promise.all([
        Loan.find(query)
          .populate([
            {
              path: "customer_user",
              select: "first_name last_name email phone national_id_number",
            },
            {
              path: "asset",
              select:
                "asset_no title category evaluated_value status asset_images",
            },
            {
              path: "application",
              select:
                "application_no requested_loan_amount collateral_category collateral_description declared_asset_value status repayment_type loan_period_type repayment_days interest_rate interest_amount total_repayable_amount",
            },
          ])
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .lean(),
        Loan.countDocuments(query),
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return {
        success: true,
        data: {
          loans,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        },
        message: "Loans retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get all loans without pagination (for exports, reports, etc.)
   * Includes all 7 key fields from application
   */
  async getAllLoans(filters = {}, sort = { created_at: -1 }) {
    try {
      const query = {};

      if (filters.customer_user) query.customer_user = filters.customer_user;
      if (filters.status) query.status = filters.status;
      if (filters.collateral_category)
        query.collateral_category = filters.collateral_category;

      const loans = await Loan.find(query)
        .populate([
          {
            path: "customer_user",
            select: "first_name last_name email phone national_id_number",
          },
          {
            path: "asset",
            select:
              "asset_no title category evaluated_value status asset_images",
          },
          {
            path: "application",
            select:
              "application_no requested_loan_amount collateral_category collateral_description declared_asset_value status repayment_type loan_period_type repayment_days interest_rate interest_amount total_repayable_amount",
          },
        ])
        .sort(sort)
        .lean();

      return {
        success: true,
        data: loans,
        message: "All loans retrieved successfully",
        count: loans.length,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan
   */
  async updateLoan(loanId, updateData, userId) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      throw { status: 400, message: "Invalid loan ID." };
    }
    try {
      // Check if loan exists
      const existingLoan = await Loan.findById(loanId);
      if (!existingLoan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Prevent updating loan_no if provided
      if (updateData.loan_no && updateData.loan_no !== existingLoan.loan_no) {
        throw {
          status: 400,
          message: "Loan number cannot be changed",
        };
      }

      // Check if loan status allows updates
      if (
        existingLoan.status === "closed" ||
        existingLoan.status === "cancelled"
      ) {
        throw {
          status: 400,
          message: `Cannot update loan with status: ${existingLoan.status}`,
        };
      }

      // A rate change (including a negotiated interest rate) must recompute the whole
      // repayment breakdown, or interest_amount/expected_total_repayable/current_balance
      // silently go stale against the new rate — this previously just wrote the raw
      // percentage field and left everything downstream of it wrong. Only safe to do
      // when no cash has moved yet: calculateRepaymentBreakdown resets current_balance
      // to the freshly computed total, which would wipe out real payments already
      // recorded against this loan.
      const rateFieldsChanged =
        (updateData.interest_rate_percent !== undefined &&
          Number(updateData.interest_rate_percent) !== existingLoan.interest_rate_percent) ||
        (updateData.storage_charge_percent !== undefined &&
          Number(updateData.storage_charge_percent) !== existingLoan.storage_charge_percent);
      if (rateFieldsChanged) {
        if ((existingLoan.total_paid || 0) > 0 || (existingLoan.payments || []).length > 0) {
          throw {
            status: 400,
            message:
              "Cannot change the interest or storage rate on a loan that already has payments recorded — " +
              "use Admin Override to adjust an already-active loan instead.",
          };
        }
        const period = LOAN_PERIODS[existingLoan.loan_period_type];
        const recalcData = {
          principal_amount: existingLoan.principal_amount,
          interest_rate_percent:
            updateData.interest_rate_percent !== undefined
              ? updateData.interest_rate_percent
              : existingLoan.interest_rate_percent,
          storage_charge_percent: updateData.storage_charge_percent,
          interest_period_days: existingLoan.interest_period_days,
          admin_fee_amount: existingLoan.admin_fee_amount,
          admin_fee_type: existingLoan.admin_fee_type,
          admin_fee_pct: existingLoan.admin_fee_pct,
          start_date: existingLoan.start_date,
          due_date: existingLoan.due_date,
        };
        if (period) await this.applyNegotiatedRate(recalcData, period, userId);
        this.calculateRepaymentBreakdown(recalcData);

        updateData.interest_rate_percent = recalcData.interest_rate_percent;
        updateData.storage_charge_percent = recalcData.storage_charge_percent;
        updateData.interest_amount = recalcData.interest_amount;
        updateData.storage_charge_amount = recalcData.storage_charge_amount;
        updateData.expected_total_repayable = recalcData.expected_total_repayable;
        updateData.current_balance = recalcData.current_balance;
        updateData.repayment_breakdown = recalcData.repayment_breakdown;
        updateData.is_negotiated = recalcData.is_negotiated;
        updateData.standard_storage_charge_percent = recalcData.standard_storage_charge_percent;
        updateData.negotiated_by = recalcData.negotiated_by;
        updateData.negotiated_by_role = recalcData.negotiated_by_role;
        updateData.negotiated_at = recalcData.negotiated_at;
        if (recalcData.is_negotiated && updateData.negotiation_reason === undefined) {
          updateData.negotiation_reason = existingLoan.negotiation_reason || null;
        }
      }

      // Add audit trail
      updateData.updated_at = new Date();

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        {
          path: "customer_user",
          select: "first_name last_name email phone national_id_number",
        },
        {
          path: "asset",
          select: "asset_no title category status asset_images",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category declared_asset_value status",
        },
      ]);

      return {
        success: true,
        data: updatedLoan,
        message: "Loan updated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Update loan status with business logic
   */
  async updateLoanStatus(loanId, status, notes = "", userId, disbursementDetails = null) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      throw { status: 400, message: "Invalid loan ID." };
    }
    try {
      const validStatuses = [
        "draft",
        "pending_approval",
        "approved",
        "active",
        "overdue",
        "in_grace",
        "auction",
        "sold",
        "redeemed",
        "closed",
        "cancelled",
        "partially_paid",
        "defaulted",
        "written_off",
      ];

      if (!validStatuses.includes(status)) {
        throw {
          status: 400,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", ",
          )}`,
        };
      }

      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // If trying to set status to "active", check if super admin approval is required and granted
      if (status === "active") {
        if (
          loan.requires_super_admin_approval &&
          loan.approval_status !== "approved"
        ) {
          throw {
            status: 403,
            message:
              "Cannot activate loan: pending super admin approval. Loan must be approved by at least one super admin first.",
          };
        }
      }

      // Status transition validations
      this.validateStatusTransition(loan.status, status, loan);

      const updateData = {
        status,
        updated_at: new Date(),
        $push: {
          status_history: {
            from: loan.status,
            to: status,
            changed_by: userId,
            changed_at: new Date(),
            notes,
          },
        },
      };

      // When a loan is approved, stamp approval_status and approved_by
      if (status === "approved") {
        updateData.approval_status = "approved";
        if (userId) updateData.approved_by = userId;
      }

      // When entering grace period: apply penalty the day AFTER the due date.
      // e.g. due July 15 → penalty applied July 16 onward.
      // Penalty is only applied once (guard against double-application).
      if (status === "in_grace") {
        const existingBreakdown = loan.repayment_breakdown || {};
        if (!existingBreakdown.penalty_applied) {
          const dayAfterDue = new Date(loan.due_date);
          dayAfterDue.setDate(dayAfterDue.getDate() + 1);
          if (new Date() >= dayAfterDue) {
            const penaltyPercent = loan.penalty_percent ?? 10;
            const balanceBeforePenalty = loan.current_balance;
            const penaltyAmount = parseFloat(
              (balanceBeforePenalty * (penaltyPercent / 100)).toFixed(2)
            );
            const totalWithPenalty = parseFloat(
              (balanceBeforePenalty + penaltyAmount).toFixed(2)
            );
            updateData.current_balance = totalWithPenalty;
            updateData.repayment_breakdown = {
              ...existingBreakdown,
              penalty_applied: true,
              penalty_percent: penaltyPercent,
              penalty_amount: penaltyAmount,
              balance_before_penalty: balanceBeforePenalty,
              total_with_penalty: totalWithPenalty,
              penalty_applied_at: new Date().toISOString(),
            };
          }
        }
      }

      // Set disbursement fields when activating (cashing out)
      if (status === "active") {
        updateData.disbursement_date = new Date();
        updateData.disbursed_by = userId;
        if (!loan.processed_by && userId) updateData.processed_by = userId;
        if (!loan.approved_by && userId) updateData.approved_by = userId;

        if (disbursementDetails) {
          if (disbursementDetails.disbursement_reference)
            updateData.disbursement_reference = disbursementDetails.disbursement_reference;
          if (disbursementDetails.disbursement_notes)
            updateData.disbursement_notes = disbursementDetails.disbursement_notes;
          if (disbursementDetails.payment_method)
            updateData.payment_method = disbursementDetails.payment_method;
          if (disbursementDetails.bank_account_key)
            updateData.disbursement_bank_account_key = disbursementDetails.bank_account_key;
          if (disbursementDetails.admin_fee_bank_account_key)
            updateData.admin_fee_bank_account_key = disbursementDetails.admin_fee_bank_account_key;
        }
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
      }).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status asset_images" },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category status",
        },
      ]);

      // Update associated asset status
      await this.updateAssetStatusBasedOnLoan(updatedLoan);

      // Admin email notifications for key status changes
      const customer = updatedLoan.customer_user;
      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "Unknown Client";

      if (status === "active") {
        sendLoanDisbursedAdminEmail({
          loanNo: updatedLoan.loan_no,
          customerName,
          principalAmount: updatedLoan.principal_amount,
          loanPeriodType: updatedLoan.loan_period_type,
          dueDate: updatedLoan.due_date,
        }).catch((err) => console.error("Disbursement admin email error:", err.message));

        // Automatically assign the active loan to the next eligible investor (SWRR)
        investorAllocationService
          .assignLoan(updatedLoan._id)
          .catch((err) => console.error("[InvestorAllocation] assign error:", err.message));
      } else if (["redeemed", "defaulted", "written_off", "cancelled"].includes(status)) {
        // Sync investor allocation status when loan reaches a terminal state
        investorAllocationService
          .syncAllocationStatus(updatedLoan._id, status)
          .catch((err) => console.error("[InvestorAllocation] sync error:", err.message));
      }

      // Xero sync (fire-and-forget — never blocks the loan status response)
      if (status === "active") {
        xeroSyncService
          .syncLoanDisbursed(updatedLoan)
          .catch((err) => console.error("[Xero] loan disbursed sync error:", err.message));
      } else if (status === "written_off") {
        xeroSyncService
          .syncLoanWrittenOff(updatedLoan)
          .catch((err) => console.error("[Xero] loan written-off sync error:", err.message));
      } else if (status === "auction") {
        xeroSyncService
          .syncLoanMovedToAuction(updatedLoan)
          .catch((err) => console.error("[Xero] loan moved-to-auction sync error:", err.message));
      }

      if (status === "redeemed") {
        sendLoanRedeemedAdminEmail({
          loanNo: updatedLoan.loan_no,
          customerName,
          principalAmount: updatedLoan.principal_amount,
          loanPeriodType: updatedLoan.loan_period_type,
        }).catch((err) => console.error("Redemption admin email error:", err.message));
      } else if (status === "auction") {
        const asset = updatedLoan.asset;
        sendLoanAuctionAdminEmail({
          loanNo: updatedLoan.loan_no,
          customerName,
          principalAmount: updatedLoan.principal_amount,
          assetTitle: asset?.title,
          assetNo: asset?.asset_no,
          totalOwed: updatedLoan.current_balance,
        }).catch((err) => console.error("Auction admin email error:", err.message));
      }

      return {
        success: true,
        data: updatedLoan,
        message: `Loan status updated to ${status}`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Request super admin approval for a loan (amount > $500)
   */
  async requestSuperAdminApproval(loanId, superAdminIds, requesterId) {
    try {
      // Validate loan exists
      const loan = await Loan.findById(loanId).populate(
        "created_by",
        "first_name last_name email phone",
      );
      if (!loan) {
        throw { status: 404, message: "Loan not found" };
      }

      // Validate loan amount > 500
      if (loan.principal_amount <= 500) {
        throw {
          status: 400,
          message: "Loan amount does not require super admin approval",
        };
      }

      // Validate loan status: must be pending_approval or draft
      if (!["pending_approval", "draft"].includes(loan.status)) {
        throw {
          status: 400,
          message: "Loan cannot request approval in current status",
        };
      }

      // Validate super admin IDs (fetch users, ensure they have role super_admin_vendor)
      const superAdmins = await User.find({
        _id: { $in: superAdminIds },
        roles: "super_admin_vendor",
        status: "active",
      });
      if (superAdmins.length === 0) {
        throw { status: 400, message: "No valid super admin vendors found" };
      }
      if (superAdmins.length > 3) {
        throw {
          status: 400,
          message: "Cannot request approval from more than 3 super admins",
        };
      }

      // Create requested_super_admins entries
      const requestedAdmins = superAdmins.map((sa) => ({
        super_admin: sa._id,
        status: "pending",
        requested_at: new Date(),
      }));

      // Update loan with request details
      loan.requested_super_admins = requestedAdmins;
      loan.requires_super_admin_approval = true;
      loan.approval_status = "pending";
      loan.status = "pending_approval";
      await loan.save({ validateModifiedOnly: true });

      // Prepare notification content
      const frontendUrl = process.env.FRONTEND_URL || "https://www.rtcapital.co.zw/";
      const approvalLink = `${frontendUrl}/loans/${loan._id}?approve=true`;
      const subject = `Loan Approval Request: ${loan.loan_no}`;
      const text = `A loan of $${loan.principal_amount} requires your approval. Click here to review: ${approvalLink}`;
      const html = `<p>A loan of <strong>$${loan.principal_amount}</strong> requires your approval.</p><p><a href="${approvalLink}">Click here to review and approve</a></p>`;

      // Send notifications to each super admin
      for (const sa of superAdmins) {
        if (sa.email) {
          await sendEmail({
            to: sa.email,
            subject,
            text,
            html,
          }).catch((err) =>
            console.error(`Failed to send email to ${sa.email}:`, err),
          );
        }
        if (sa.phone) {
          try {
            await sendSmsWithMessage(
              sa.phone,
              `Loan ${loan.loan_no} of $${loan.principal_amount} needs your approval. ${approvalLink}`,
            );
          } catch (err) {
            console.error(`Failed to send SMS to ${sa.phone}:`, err);
          }
        }
      }

      // Notify requester
      const requester = await User.findById(requesterId);
      if (requester && requester.email) {
        await sendEmail({
          to: requester.email,
          subject: `Super Admin Approval Requested for ${loan.loan_no}`,
          text: `Your request for super admin approval on loan ${loan.loan_no} has been sent to ${superAdmins.length} super admin(s). You will be notified when approved.`,
        });
      }

      return {
        success: true,
        message: `Approval request sent to ${superAdmins.length} super admin(s)`,
        data: {
          loanId: loan._id,
          requestedAdmins: requestedAdmins.map((a) => a.super_admin),
        },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Super admin approves a loan
   */
  async approveLoanBySuperAdmin(loanId, superAdminId) {
    try {
      const loan = await Loan.findById(loanId).populate(
        "created_by",
        "first_name last_name email phone",
      );
      if (!loan) {
        throw { status: 404, message: "Loan not found" };
      }

      // Check if this loan requires super admin approval
      if (!loan.requires_super_admin_approval) {
        throw {
          status: 400,
          message: "This loan does not require super admin approval",
        };
      }

      // Check if already approved
      if (loan.approval_status === "approved") {
        throw {
          status: 400,
          message: "Loan already approved by a super admin",
        };
      }

      // Find the pending request for this super admin
      const requestEntry = loan.requested_super_admins.find(
        (entry) =>
          entry.super_admin.toString() === superAdminId &&
          entry.status === "pending",
      );
      if (!requestEntry) {
        throw {
          status: 403,
          message: "You are not authorized to approve this loan",
        };
      }

      // Update the request status
      requestEntry.status = "approved";

      // Record approval
      loan.super_admin_approvals.push({
        approved_by: superAdminId,
        approved_at: new Date(),
      });

      // Set overall approval_status to approved
      loan.approval_status = "approved";

      await loan.save({ validateModifiedOnly: true });

      // Notify loan processor
      const processorId = loan.processed_by || loan.created_by;
      if (processorId) {
        const processor = await User.findById(processorId);
        if (processor) {
          const processorMessage = `Your loan ${loan.loan_no} has been approved by super admin. You may now proceed to disburse.`;
          if (processor.email) {
            await sendEmail({
              to: processor.email,
              subject: `Loan Approval: ${loan.loan_no}`,
              text: processorMessage,
            });
          }
          if (processor.phone) {
            await sendSmsWithMessage(processor.phone, processorMessage).catch(
              (err) => console.error("SMS failed:", err),
            );
          }
        }
      }

      // Notify the approving super admin
      const approver = await User.findById(superAdminId);
      if (approver) {
        const thankYouMessage = `You have approved loan ${loan.loan_no} for $${loan.principal_amount}.`;
        if (approver.email) {
          await sendEmail({
            to: approver.email,
            subject: `Loan Approval Confirmed: ${loan.loan_no}`,
            text: thankYouMessage,
          });
        }
        if (approver.phone) {
          await sendSmsWithMessage(approver.phone, thankYouMessage).catch(
            (err) => console.error("SMS failed:", err),
          );
        }
      }

      return {
        success: true,
        message: "Loan approved successfully",
        data: { loanId: loan._id, approvedBy: superAdminId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Delete loan (soft delete)
   */
  async deleteLoan(loanId, userId) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      throw { status: 400, message: "Invalid loan ID." };
    }
    try {
      const loan = await Loan.findById(loanId);

      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      // Check if loan can be deleted
      if (loan.status === "active" || loan.status === "overdue") {
        throw {
          status: 400,
          message:
            "Cannot delete active or overdue loan. Close or cancel it first.",
        };
      }

      // Soft delete by changing status
      loan.status = "cancelled";
      loan.updated_at = new Date();
      await loan.save({ validateModifiedOnly: true });

      // Remove loan reference from asset and reset to submitted
      if (loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          $unset: { active_loan: "" },
          status: "submitted",
        });
      }

      return {
        success: true,
        message: "Loan cancelled successfully",
        data: { loanId },
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Get loans by customer
   */
  async getLoansByCustomer(customerId, page = 1, limit = 10) {
    try {
      const user = await User.findById(customerId);
      if (!user) {
        throw {
          status: 404,
          message: `Customer with ID ${customerId} not found`,
        };
      }

      return this.getLoansPaginated({ customer_user: customerId }, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Search loans
   */
  async searchLoans(searchTerm, page = 1, limit = 10) {
    try {
      const query = {
        $or: [
          { loan_no: { $regex: searchTerm, $options: "i" } },
          { "customer_user.name": { $regex: searchTerm, $options: "i" } },
          { "customer_user.email": { $regex: searchTerm, $options: "i" } },
          {
            "customer_user.national_id_number": {
              $regex: searchTerm,
              $options: "i",
            },
          },
        ],
      };

      // Try to find users matching search term
      const users = await User.find({
        $or: [
          { first_name: { $regex: searchTerm, $options: "i" } },
          { last_name: { $regex: searchTerm, $options: "i" } },
          { email: { $regex: searchTerm, $options: "i" } },
          { national_id_number: { $regex: searchTerm, $options: "i" } },
          { phone: { $regex: searchTerm, $options: "i" } },
        ],
      }).select("_id");

      if (users.length > 0) {
        query.$or.push({ customer_user: { $in: users.map((u) => u._id) } });
      }

      return this.getLoansPaginated(query, page, limit);
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate loan summary/statistics
   */
  async getLoanStats() {
    try {
      const total = await Loan.countDocuments();

      const byStatus = await Loan.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);

      const byCategory = await Loan.aggregate([
        { $group: { _id: "$collateral_category", count: { $sum: 1 } } },
      ]);

      const totalPrincipal = await Loan.aggregate([
        { $match: { principal_amount: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$principal_amount" } } },
      ]);

      const totalBalance = await Loan.aggregate([
        { $match: { current_balance: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: "$current_balance" } } },
      ]);

      const overdueLoans = await Loan.countDocuments({
        status: "overdue",
        due_date: { $lt: new Date() },
      });

      const pendingApproval = await Loan.countDocuments({
        status: "pending_approval",
        requires_super_admin_approval: true,
      });

      const byApprovalStatus = await Loan.aggregate([
        { $group: { _id: "$approval_status", count: { $sum: 1 } } },
      ]);

      const statusStats = {};
      byStatus.forEach((item) => {
        statusStats[item._id] = item.count;
      });

      const categoryStats = {};
      byCategory.forEach((item) => {
        categoryStats[item._id] = item.count;
      });

      const approvalStats = {};
      byApprovalStatus.forEach((item) => {
        approvalStats[item._id] = item.count;
      });

      return {
        total,
        by_status: statusStats,
        by_category: categoryStats,
        by_approval_status: approvalStats,
        total_principal_amount: totalPrincipal[0]?.total || 0,
        total_current_balance: totalBalance[0]?.total || 0,
        overdue_count: overdueLoans,
        pending_approval_count: pendingApproval,
        active_loans_count: statusStats.active || 0,
        closed_loans_count: statusStats.closed || 0,
        redeemed_loans_count: statusStats.redeemed || 0,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Calculate interest and charges
   */
  async calculateLoanCharges(loanId) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      const now = new Date();
      const startDate = new Date(loan.start_date);
      const dueDate = new Date(loan.due_date);

      // Calculate days elapsed
      const daysElapsed = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24));
      const totalLoanDays = Math.ceil(
        (dueDate - startDate) / (1000 * 60 * 60 * 24),
      );

      // Calculate interest
      const dailyInterestRate = loan.interest_rate_percent / 100 / 365;
      const interestAccrued =
        loan.principal_amount * dailyInterestRate * daysElapsed;

      // Calculate storage charge
      const storageCharge =
        (loan.principal_amount * loan.storage_charge_percent) / 100;

      const graceDays = loan.grace_days ?? 7;
      const penaltyPercent = loan.penalty_percent ?? 10;
      // Late starts the day AFTER due date (e.g. due July 15 → late from July 16)
      const dayAfterDue = new Date(dueDate);
      dayAfterDue.setDate(dayAfterDue.getDate() + 1);
      const isLate = now >= dayAfterDue;
      const overdueDays = isLate
        ? Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24))
        : 0;
      const inGrace =
        isLate && overdueDays <= graceDays && loan.status === "in_grace";

      // Penalty breakdown from repayment_breakdown (set when loan entered in_grace)
      const bd = loan.repayment_breakdown || {};
      const penaltyAlreadyApplied = Boolean(bd.penalty_applied);
      const penaltyAmount = penaltyAlreadyApplied
        ? parseFloat((bd.penalty_amount || 0).toFixed(2))
        : 0;
      const balanceBeforePenalty = penaltyAlreadyApplied
        ? parseFloat((bd.balance_before_penalty || loan.current_balance).toFixed(2))
        : loan.current_balance;

      // If penalty not yet applied but loan is in_grace (race condition), compute it
      const pendingPenalty =
        !penaltyAlreadyApplied && inGrace
          ? parseFloat((loan.current_balance * (penaltyPercent / 100)).toFixed(2))
          : 0;

      const effectivePenalty = penaltyAlreadyApplied ? penaltyAmount : pendingPenalty;

      // current_balance = principal + interest + storage (set at creation, + penalty when in_grace).
      // Do NOT add interestAccrued / storageCharge again — they are already inside current_balance.
      const totalDue = parseFloat(loan.current_balance.toFixed(2));

      // Use stored breakdown values so the displayed breakdown matches current_balance exactly.
      const rb = loan.repayment_breakdown || {};
      const displayInterest = parseFloat((rb.interest_amount ?? loan.interest_amount ?? interestAccrued).toFixed(2));
      const displayStorage = parseFloat((rb.storage_charge_amount ?? loan.storage_charge_amount ?? storageCharge).toFixed(2));

      return {
        success: true,
        data: {
          principal: loan.principal_amount,
          current_balance: loan.current_balance,
          balance_before_penalty: balanceBeforePenalty,
          days_elapsed: daysElapsed,
          total_loan_days: totalLoanDays,
          interest_rate: loan.interest_rate_percent,
          interest_accrued: displayInterest,
          storage_charge_percent: loan.storage_charge_percent,
          storage_charge: displayStorage,
          penalty_percent: penaltyPercent,
          grace_days: graceDays,
          penalty: effectivePenalty,
          penalty_applied: penaltyAlreadyApplied,
          total_due: totalDue,
          due_date: loan.due_date,
          is_overdue: isLate,
          in_grace: inGrace,
          overdue_days: overdueDays,
        },
        message: "Loan charges calculated successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Process loan payment
   */
  async processPayment(loanId, paymentData) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw {
          status: 404,
          message: `Loan with ID ${loanId} not found`,
        };
      }

      if (
        loan.status !== "active" &&
        loan.status !== "overdue" &&
        loan.status !== "in_grace" &&
        loan.status !== "partially_paid"
      ) {
        throw {
          status: 400,
          message: `Cannot process payment for loan with status: ${loan.status}`,
        };
      }

      const { amount, payment_method, notes, reference_no, received_by, bank_account_key } =
        paymentData;

      if (!amount || amount <= 0) {
        throw {
          status: 400,
          message: "Payment amount must be greater than 0",
        };
      }

      if (!payment_method) {
        throw {
          status: 400,
          message: "Payment method is required",
        };
      }

      // Validate payment method
      const validPaymentMethods = [
        "cash",
        "bank_transfer",
        "mobile_money",
        "cheque",
      ];
      if (!validPaymentMethods.includes(payment_method)) {
        throw {
          status: 400,
          message: `Invalid payment method. Must be one of: ${validPaymentMethods.join(", ")}`,
        };
      }

      // Calculate new balance
      const newBalance = Math.max(0, loan.current_balance - amount);
      const newTotalPaid = loan.total_paid + amount;

      // Create payment record matching the schema
      const paymentRecord = {
        amount: amount,
        payment_date: new Date(),
        payment_method: payment_method,
        status: "paid",
        reference_no: reference_no || `PAY-${Date.now()}`,
        received_by: received_by || loan.processed_by || loan.created_by,
        notes: notes || null,
        bank_account_key: bank_account_key || null,
      };

      // Loan is fully redeemed when total paid meets or exceeds what was owed
      const totalRepayable = loan.expected_total_repayable || loan.principal_amount;
      const isFullyPaid = newTotalPaid >= totalRepayable || newBalance <= 0;

      const updateData = {
        current_balance: isFullyPaid ? 0 : newBalance,
        total_paid: newTotalPaid,
        updated_at: new Date(),
        $push: {
          payments: paymentRecord,
        },
      };

      // Update status based on payment
      if (isFullyPaid) {
        updateData.status = "redeemed";
      } else if (newBalance > 0 && loan.status === "overdue") {
        // If still has balance but was overdue, check if should remain overdue
        const now = new Date();
        const dueDate = new Date(loan.due_date);
        if (now <= dueDate) {
          updateData.status = "active";
        }
      } else if (
        newBalance > 0 &&
        loan.current_balance > newBalance &&
        newBalance < loan.current_balance
      ) {
        updateData.status = "partially_paid";
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
        runValidators: true,
      }).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status asset_images" },
        { path: "payments.received_by", select: "first_name last_name email" },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category status",
        },
      ]);

      // Update asset status if loan is redeemed
      if (isFullyPaid && loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          status: "redeemed",
          $unset: { active_loan: "" },
        });
      }

      // Notify admins when loan is fully redeemed via payment
      if (isFullyPaid) {
        const cu = updatedLoan.customer_user;
        const customerName = cu
          ? `${cu.first_name || ""} ${cu.last_name || ""}`.trim()
          : "Unknown Client";
        sendLoanRedeemedAdminEmail({
          loanNo: updatedLoan.loan_no,
          customerName,
          principalAmount: updatedLoan.principal_amount,
          amountPaid: amount,
          loanPeriodType: updatedLoan.loan_period_type,
        }).catch((err) => console.error("Redemption admin email error:", err.message));
      }

      // Agent interest-commission accrual — synchronous (not fire-and-forget like the Xero
      // call below): a dropped Xero sync is recoverable via the retry poller/backfill, but
      // a silently-lost commission accrual has no such safety net today, so any failure
      // here is caught and logged rather than risked being lost.
      const insertedPayment = updatedLoan.payments[updatedLoan.payments.length - 1];
      try {
        await agentCommissionService.accrueInterestCommission(updatedLoan, amount, insertedPayment?._id || null);
      } catch (err) {
        console.error(`[AgentCommission] interest accrual failed for loan ${updatedLoan.loan_no}:`, err.message);
      }

      // Xero sync (fire-and-forget) — legacy embedded-payment path, no component
      // breakdown available here; see syncLoanRepaymentLegacy for the proportional split.
      xeroSyncService
        .syncLoanRepaymentLegacy(updatedLoan, paymentRecord)
        .catch((err) => console.error("[Xero] loan repayment (legacy) sync error:", err.message));

      return {
        success: true,
        data: {
          loan: updatedLoan,
          payment: paymentRecord,
          summary: {
            amount_paid: amount,
            previous_balance: loan.current_balance,
            new_balance: isFullyPaid ? 0 : newBalance,
            total_paid_to_date: newTotalPaid,
            remaining_balance: isFullyPaid ? 0 : newBalance,
            fully_paid: isFullyPaid,
            repayment_breakdown: updatedLoan.repayment_breakdown || null,
            total_repayable: totalRepayable,
          },
        },
        message: `Payment of ${amount} processed successfully${isFullyPaid ? ". Loan fully redeemed." : ""}`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Waive the late-payment penalty on a loan. Used when a Loan Processor / Admin
   * decides, at the point of repayment, not to collect the penalty a customer owes
   * (goodwill, dispute, hardship, etc). Reduces current_balance by whatever portion
   * of the penalty is still unpaid, but always records the full foregone amount so
   * the revenue impact is visible system-wide (loan view, System Report, audit log).
   *
   * Nothing is posted to Xero for this — cash-basis: the waived amount is money that
   * was never going to be collected, so no ledger transaction exists to sync.
   */
  async waivePenalty(loanId, { reason } = {}, userId, requestMeta = {}) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      if (loan.penalty_waived) {
        throw {
          status: 400,
          message: "Penalty has already been waived for this loan",
        };
      }

      const bd = loan.repayment_breakdown || {};
      const penaltyApplied = Boolean(bd.penalty_applied);
      const penaltyPercent = loan.penalty_percent ?? 10;

      // Penalty may already be applied (stored in repayment_breakdown) or, if the loan
      // is in_grace but the status-transition hook hasn't run yet, compute it live —
      // same logic calculateLoanCharges uses for "pendingPenalty".
      let penaltyAmount = penaltyApplied
        ? parseFloat((bd.penalty_amount || 0).toFixed(2))
        : 0;

      if (!penaltyApplied && loan.status === "in_grace") {
        penaltyAmount = parseFloat(
          (loan.current_balance * (penaltyPercent / 100)).toFixed(2)
        );
      }

      if (!penaltyAmount || penaltyAmount <= 0) {
        throw {
          status: 400,
          message: "This loan has no applied penalty to waive",
        };
      }

      // Only the unpaid portion still sitting in current_balance can be waived —
      // never waive more than the customer currently owes.
      const waivedAmount = Math.min(penaltyAmount, loan.current_balance);
      const newBalance = parseFloat(
        Math.max(0, loan.current_balance - waivedAmount).toFixed(2)
      );

      const actor = await User.findById(userId).select("first_name last_name email roles");
      const actorName = actor
        ? `${actor.first_name || ""} ${actor.last_name || ""}`.trim() || actor.email
        : "Unknown";
      const actorRole = actor?.roles?.[0] || null;

      const before = {
        current_balance: loan.current_balance,
        penalty_waived: loan.penalty_waived,
      };

      loan.current_balance = newBalance;
      loan.penalty_waived = true;
      loan.penalty_waived_amount = waivedAmount;
      loan.penalty_waived_by = userId || null;
      loan.penalty_waived_by_role = actorRole;
      loan.penalty_waived_at = new Date();
      loan.penalty_waived_reason = reason || null;
      loan.repayment_breakdown = {
        ...bd,
        penalty_applied: penaltyApplied ? bd.penalty_applied : true,
        penalty_amount: penaltyApplied ? bd.penalty_amount : penaltyAmount,
        penalty_waived: true,
        penalty_waived_amount: waivedAmount,
      };

      await loan.save();

      const updatedLoan = await Loan.findById(loanId).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status" },
      ]);

      const customer = updatedLoan.customer_user;
      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "Unknown Client";

      // Audit trail — first real caller of the AuditLog system.
      auditLogService
        .logLoanAction(
          loanId,
          userId,
          "penalty_waived",
          before,
          {
            current_balance: newBalance,
            penalty_waived: true,
            penalty_waived_amount: waivedAmount,
          },
          requestMeta.ip,
          requestMeta.userAgent,
          {
            loan_no: updatedLoan.loan_no,
            customer_name: customerName,
            waived_by: actorName,
            waived_by_role: actorRole,
            reason: reason || null,
          }
        )
        .catch((err) => console.error("Penalty waiver audit log failed:", err.message));

      // In-app + email notification to admins/loan processors/management.
      NotificationService.createNotification(
        {
          title: `Penalty Waived — Loan #${updatedLoan.loan_no}`,
          message: `${actorName}${actorRole ? ` (${actorRole})` : ""} waived a $${waivedAmount.toLocaleString()} penalty for ${customerName} on loan #${updatedLoan.loan_no}.${reason ? ` Reason: ${reason}` : ""}`,
          type: "penalty_waived",
          priority: "high",
          audience: {
            scope: "roles",
            roles: [
              "super_admin_vendor",
              "admin_pawn_limited",
              "loan_officer_processor",
              "loan_officer_approval",
              "management",
            ],
          },
          channels: ["in_app", "email"],
          entity_type: "loan",
          entity_id: loanId,
          action_url: `/loans/${loanId}`,
          action_text: "View Loan",
        },
        userId
      ).catch((err) => console.error("Penalty waiver notification failed:", err.message));

      // Dedicated admin-inbox email, same idiom as disbursement/redemption/rollover.
      sendPenaltyWaivedAdminEmail({
        loanNo: updatedLoan.loan_no,
        customerName,
        waivedAmount,
        reason,
        waivedBy: actorName,
        waivedByRole: actorRole,
      }).catch((err) => console.error("Penalty waiver admin email failed:", err.message));

      return {
        success: true,
        data: updatedLoan,
        message: `Penalty of $${waivedAmount.toLocaleString()} waived successfully`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Reverse (undo) a penalty waiver — e.g. it was recorded by mistake or during
   * testing. Restores the waived amount onto current_balance (correct regardless of
   * any payments made in between, since it exactly undoes the earlier subtraction)
   * and clears the waiver flags. The original waiver's audit log entry is left in
   * place as history — this adds a new entry rather than rewriting the past.
   * Super Admin only (enforced at the route layer).
   */
  async reversePenaltyWaiver(loanId, { reason } = {}, userId, requestMeta = {}) {
    try {
      const loan = await Loan.findById(loanId);
      if (!loan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      if (!loan.penalty_waived) {
        throw {
          status: 400,
          message: "This loan does not have a penalty waiver to reverse",
        };
      }

      const restoredAmount = parseFloat((loan.penalty_waived_amount || 0).toFixed(2));
      const newBalance = parseFloat((loan.current_balance + restoredAmount).toFixed(2));

      const actor = await User.findById(userId).select("first_name last_name email roles");
      const actorName = actor
        ? `${actor.first_name || ""} ${actor.last_name || ""}`.trim() || actor.email
        : "Unknown";
      const actorRole = actor?.roles?.[0] || null;

      const before = {
        current_balance: loan.current_balance,
        penalty_waived: loan.penalty_waived,
        penalty_waived_amount: loan.penalty_waived_amount,
        originally_waived_by: loan.penalty_waived_by,
        originally_waived_at: loan.penalty_waived_at,
      };

      const bd = loan.repayment_breakdown || {};

      loan.current_balance = newBalance;
      loan.penalty_waived = false;
      loan.penalty_waived_amount = 0;
      loan.penalty_waived_by = null;
      loan.penalty_waived_by_role = null;
      loan.penalty_waived_at = null;
      loan.penalty_waived_reason = null;
      loan.repayment_breakdown = {
        ...bd,
        penalty_waived: false,
        penalty_waived_amount: 0,
      };

      await loan.save();

      const updatedLoan = await Loan.findById(loanId).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status" },
      ]);

      const customer = updatedLoan.customer_user;
      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "Unknown Client";

      auditLogService
        .logLoanAction(
          loanId,
          userId,
          "penalty_waiver_reversed",
          before,
          {
            current_balance: newBalance,
            penalty_waived: false,
          },
          requestMeta.ip,
          requestMeta.userAgent,
          {
            loan_no: updatedLoan.loan_no,
            customer_name: customerName,
            restored_amount: restoredAmount,
            reversed_by: actorName,
            reversed_by_role: actorRole,
            reason: reason || null,
          }
        )
        .catch((err) => console.error("Penalty waiver reversal audit log failed:", err.message));

      NotificationService.createNotification(
        {
          title: `Penalty Waiver Reversed — Loan #${updatedLoan.loan_no}`,
          message: `${actorName}${actorRole ? ` (${actorRole})` : ""} reversed a $${restoredAmount.toLocaleString()} penalty waiver for ${customerName} on loan #${updatedLoan.loan_no}.${reason ? ` Reason: ${reason}` : ""}`,
          type: "penalty_waived",
          priority: "high",
          audience: {
            scope: "roles",
            roles: [
              "super_admin_vendor",
              "admin_pawn_limited",
              "loan_officer_processor",
              "loan_officer_approval",
              "management",
            ],
          },
          channels: ["in_app", "email"],
          entity_type: "loan",
          entity_id: loanId,
          action_url: `/loans/${loanId}`,
          action_text: "View Loan",
        },
        userId
      ).catch((err) => console.error("Penalty waiver reversal notification failed:", err.message));

      sendPenaltyWaiverReversedAdminEmail({
        loanNo: updatedLoan.loan_no,
        customerName,
        restoredAmount,
        reason,
        reversedBy: actorName,
        reversedByRole: actorRole,
      }).catch((err) => console.error("Penalty waiver reversal admin email failed:", err.message));

      return {
        success: true,
        data: updatedLoan,
        message: `Penalty waiver reversed — $${restoredAmount.toLocaleString()} restored to the balance owed`,
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Generate a loan number in the LON{yy}{mm}{random} format
   */
  generateLoanNo() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(1000 + Math.random() * 9000);
    return `LON${year}${month}${random}`;
  }

  /**
   * Roll over a loan: the customer pays down the interest/storage owed on the current
   * loan (in full or in part) instead of the collateral going to auction. Redesigned
   * 2026-09-30 — this APPENDS a cycle to the SAME loan document (same _id, same loan_no)
   * instead of creating a new one; see models/loan.model.js's rollover_cycles /
   * pending_rollover_approval fields. The asset and its application never re-point,
   * since there's no longer a separate document for them to point at.
   *
   * - Payment beyond what was owed above principal reduces the new cycle's principal.
   * - A shortfall becomes carried_forward_arrears, which COMPOUNDS into the next cycle's
   *   interest_base (confirmed 2026-09-30) — the charge is taken on (principal + arrears),
   *   not principal alone, so the amount owed grows the longer a client goes unpaid.
   * - "rolled_over" is no longer a loan status — the loan always lands on "active" or
   *   "overdue", exactly as if nothing else had happened, since a rollover is history on
   *   the loan, not a state it's in.
   * - A loan may roll over ROLLOVER_FREE_LIMIT (3) times freely; the next one requires a
   *   prior, approved, unexpired request — see requestRolloverApproval/decideRolloverApproval.
   */
  async rolloverLoan(loanId, rolloverData, userId, requestMeta = {}) {
    const {
      payment_amount,
      payment_method,
      payment_reference,
      payment_notes,
      new_loan_period_type,
      start_date,
      notes,
      bank_account_key,
    } = rolloverData || {};

    const paymentAmount = Number(payment_amount) || 0;
    if (paymentAmount < 0) {
      throw { status: 400, message: "Rollover payment amount cannot be negative" };
    }

    // The one rule an override bypasses: normally a rollover must collect a payment. With an
    // override (any role that can roll over a loan may use it), the loan rolls over with
    // nothing paid and the whole amount owed above principal carries forward as arrears —
    // logged against the actor, with a mandatory reason. See resolveRolloverOverride.
    const overrideInfo = this.resolveRolloverOverride(rolloverData, paymentAmount);
    if (paymentAmount === 0 && !overrideInfo) {
      throw {
        status: 400,
        message: "Rollover payment amount must be greater than 0 — or use Override to roll the loan over without a payment.",
      };
    }

    const validPaymentMethods = ["cash", "bank_transfer", "mobile_money", "cheque"];
    if (paymentAmount > 0 && !validPaymentMethods.includes(payment_method)) {
      throw {
        status: 400,
        message: `Invalid payment method. Must be one of: ${validPaymentMethods.join(", ")}`,
      };
    }

    // "auction" is included so staff can roll over a loan that the scheduler already
    // moved to auction — the rollover cancels the active auction listing in the same
    // transaction, pulling the asset back out of auction without selling it.
    const ROLLOVER_ELIGIBLE_STATUSES = ["active", "overdue", "in_grace", "partially_paid", "auction"];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const loan = await Loan.findById(loanId).session(session);
      if (!loan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      if (!ROLLOVER_ELIGIBLE_STATUSES.includes(loan.status)) {
        throw {
          status: 400,
          message: `Cannot roll over a loan with status: ${loan.status}. Loan must be active, overdue, in_grace, partially_paid, or auction.`,
        };
      }

      // ── 3-rollover cap — the 4th+ needs a prior, approved, unexpired, unconsumed
      // request. See requestRolloverApproval/decideRolloverApproval below. ──
      const currentRolloverCount = loan.rollover_count || 0;
      let consumedApproval = null;
      if (currentRolloverCount >= ROLLOVER_FREE_LIMIT) {
        const pending = loan.pending_rollover_approval;
        const isApproved = !!pending && pending.status === "approved";
        const notExpired = isApproved && (!pending.expires_at || pending.expires_at.getTime() > Date.now());
        if (!isApproved || !notExpired) {
          throw {
            status: 409,
            code: "ROLLOVER_APPROVAL_REQUIRED",
            message: `Loan ${loan.loan_no} has already rolled over ${currentRolloverCount} times. An admin must approve the next rollover before it can proceed — use Request Rollover Approval.`,
          };
        }
        consumedApproval = pending;
      }

      const loanPeriodType = new_loan_period_type || loan.loan_period_type;
      const period = LOAN_PERIODS[loanPeriodType];
      if (!period) {
        throw {
          status: 400,
          message: `Invalid new_loan_period_type. Must be one of: ${Object.keys(LOAN_PERIODS).join(", ")}`,
        };
      }

      // ── Split the rollover payment between what was owed above principal and any excess ──
      // Unchanged from the original design: a payment first clears everything owed above
      // principal; anything left over reduces principal; a shortfall carries forward as
      // arrears — which, per the compounding rule below, earns its own charge next cycle.
      const owedAbovePrincipal = Math.max(0, loan.current_balance - loan.principal_amount);
      let carriedForwardArrears = 0;
      let newPrincipal = loan.principal_amount;

      if (paymentAmount >= owedAbovePrincipal) {
        const excess = paymentAmount - owedAbovePrincipal;
        newPrincipal = r2(loan.principal_amount - excess);
      } else {
        carriedForwardArrears = r2(owedAbovePrincipal - paymentAmount);
      }

      if (newPrincipal <= 0) {
        throw {
          status: 400,
          message:
            "This payment covers the full amount owed and would leave nothing to roll over. Use Record Payment / redeem the loan instead.",
        };
      }

      // ── How the payment (up to owedAbovePrincipal) actually applies — interest, storage
      // and penalty first (in proportion to what each represents of the amount owed above
      // principal), any unpaid deferred admin fee next, then principal. Drives both the
      // Xero posting and agent-commission accrual below. Carried-forward arrears from an
      // EARLIER rollover are never a separate bucket here — compounding (further down)
      // already folded them into this cycle's own interest_amount/storage_charge_amount,
      // so this same split is already correct for them with no special-casing needed.
      const deferredFeeUnpaid = loan.admin_fee_type === "deferred" && !loan.admin_fee_collected ? loan.admin_fee_amount || 0 : 0;
      const penaltyOwed = (loan.repayment_breakdown && loan.repayment_breakdown.penalty_amount) || 0;
      const interestOwed = loan.interest_amount || 0;
      const storageOwed = loan.storage_charge_amount || 0;
      const appliedToOwed = Math.min(paymentAmount, owedAbovePrincipal);
      const ratioBase = Math.max(0, appliedToOwed - deferredFeeUnpaid);
      const ratioDenom = interestOwed + storageOwed + penaltyOwed || 1;
      const interestPortion = r2(ratioBase * (interestOwed / ratioDenom));
      const storagePortion = r2(ratioBase * (storageOwed / ratioDenom));
      const penaltyPortion = r2(ratioBase - interestPortion - storagePortion);
      const principalPortion = r2(paymentAmount - interestPortion - storagePortion - penaltyPortion);

      let arrearsInterest = 0;
      let arrearsStorage = 0;
      let arrearsPenalty = 0;
      if (carriedForwardArrears > 0) {
        arrearsInterest = r2(carriedForwardArrears * (interestOwed / ratioDenom));
        arrearsStorage = r2(carriedForwardArrears * (storageOwed / ratioDenom));
        arrearsPenalty = r2(carriedForwardArrears - arrearsInterest - arrearsStorage);
      }

      // ── If the loan is in auction, cancel the listing and clear its Xero auction
      // reclass — the balance was moved from Loans Receivable into Pawned Assets Inventory
      // when it entered auction; a rollover reverses that decision, so Xero must too
      // (posted as a reversal journal after commit — see syncRolloverAuctionReversal). ──
      let auctionReclassAmountToReverse = null;
      if (loan.status === "auction") {
        await Auction.findOneAndUpdate(
          { asset: loan.asset, status: { $in: ["draft", "live"] } },
          { $set: { status: "cancelled" } },
          { session },
        );
        if (loan.xero_auction_reclass_journal_id) {
          auctionReclassAmountToReverse = loan.xero_auction_reclass_amount || null;
          loan.xero_auction_reclass_journal_id = null;
          loan.xero_auction_reclass_amount = null;
        }
      }

      const actor = userId ? await User.findById(userId).select("first_name last_name email roles") : null;
      const actorName = actor ? `${actor.first_name || ""} ${actor.last_name || ""}`.trim() || actor.email : "Unknown";
      const actorRole = (actor?.roles || []).join(", ") || null;

      let overrideSnapshot = { applied: false };
      if (overrideInfo) {
        overrideSnapshot = {
          applied: true,
          by: userId || null,
          by_name: actorName,
          by_role: actorRole,
          at: new Date(),
          reason_category: overrideInfo.reason_category,
          reason_label: overrideInfo.reason_label,
          notes: overrideInfo.notes,
        };
      }

      // ── Record the payment collected at rollover (none on an override — a $0 entry
      // would show up as a phantom repayment in history, reports and Xero) ──
      let paymentEntryId = null;
      if (paymentAmount > 0) {
        loan.payments.push({
          amount: paymentAmount,
          payment_date: new Date(),
          payment_method,
          status: "paid",
          reference_no: payment_reference || `ROLLOVER-${Date.now()}`,
          received_by: userId || loan.processed_by || loan.created_by,
          notes: payment_notes || "Rollover payment",
          bank_account_key: bank_account_key || null,
          kind: "rollover",
          rollover_cycle_no: currentRolloverCount + 1,
        });
        paymentEntryId = loan.payments[loan.payments.length - 1]._id;
        loan.total_paid = r2(loan.total_paid + paymentAmount);
        loan.current_cycle_paid = r2((loan.current_cycle_paid || 0) + paymentAmount);
      }

      // ── Snapshot the cycle being closed, then build the new one ──
      const prevPrincipal = loan.principal_amount;
      const prevBalance = loan.current_balance;
      const prevStatus = loan.status;
      const prevDueDate = loan.due_date;
      const prevLoanPeriodType = loan.loan_period_type;

      const rolloverStart = start_date ? new Date(start_date) : new Date();
      const dueDate = new Date(rolloverStart);
      dueDate.setDate(dueDate.getDate() + period.days);

      // Compounding, confirmed 2026-09-30: interest/storage are charged on (new principal +
      // any arrears carried into this cycle), never principal alone — so the amount owed
      // genuinely grows the longer a client goes without paying, matching the rule already
      // applied by hand to LON26086621 earlier, now standard for every rollover.
      const interestBase = r2(newPrincipal + carriedForwardArrears);
      const { interestAmount, storageChargeAmount, expectedTotalRepayable } = computeFlatCycleCharge(
        interestBase,
        period.interest_rate_percent,
        period.storage_charge_percent,
      );
      const loanPeriodDaysActual = Math.ceil((dueDate - rolloverStart) / (1000 * 60 * 60 * 24));

      const cycleNo = currentRolloverCount + 1;
      const cycleRecord = {
        cycle_no: cycleNo,
        source: "live",
        prev_principal: prevPrincipal,
        prev_balance: prevBalance,
        prev_status: prevStatus,
        prev_due_date: prevDueDate,
        prev_loan_period_type: prevLoanPeriodType,
        owed_breakdown: {
          interest: interestOwed,
          storage: storageOwed,
          penalty: penaltyOwed,
          deferred_admin_fee: deferredFeeUnpaid,
        },
        payment:
          paymentAmount > 0
            ? {
                amount: paymentAmount,
                method: payment_method,
                reference_no: payment_reference || null,
                notes: payment_notes || null,
                bank_account_key: bank_account_key || null,
                received_by: userId || loan.processed_by || loan.created_by,
                payment_entry_id: paymentEntryId,
              }
            : undefined,
        payment_split: {
          interest: interestPortion,
          storage: storagePortion,
          penalty: penaltyPortion,
          arrears_interest: arrearsInterest,
          arrears_storage: arrearsStorage,
          principal_receivable: principalPortion,
        },
        arrears_carried_forward: carriedForwardArrears,
        arrears_breakdown: { interest: arrearsInterest, storage: arrearsStorage, penalty: arrearsPenalty },
        new_principal: newPrincipal,
        loan_period_type: loanPeriodType,
        interest_rate_percent: period.interest_rate_percent,
        storage_charge_percent: period.storage_charge_percent,
        penalty_percent: period.penalty_percent,
        grace_days: period.grace_days,
        interest_period_days: period.days,
        interest_base: interestBase,
        interest_amount: interestAmount,
        storage_charge_amount: storageChargeAmount,
        expected_total_repayable: expectedTotalRepayable,
        start_date: rolloverStart,
        due_date: dueDate,
        performed_by: userId || null,
        performed_by_name: actorName,
        performed_by_role: actorRole,
        performed_at: new Date(),
        notes: notes || "",
        override: overrideSnapshot,
        approval: consumedApproval
          ? {
              required: true,
              request_id: consumedApproval.request_id,
              approved_by: consumedApproval.decided_by,
              approved_by_name: consumedApproval.decided_by_name,
              approved_at: consumedApproval.decided_at,
              notes: consumedApproval.decision_notes,
            }
          : { required: false },
      };

      loan.rollover_cycles.push(cycleRecord);
      const newCycleId = loan.rollover_cycles[loan.rollover_cycles.length - 1]._id;
      loan.rollover_count = cycleNo;

      if (!loan.original_start_date) loan.original_start_date = loan.start_date;
      if (loan.original_principal_amount == null) loan.original_principal_amount = prevPrincipal;

      // ── Move the loan's top-level fields onto the new cycle ──
      loan.principal_amount = newPrincipal;
      loan.loan_period_type = loanPeriodType;
      loan.interest_rate_percent = period.interest_rate_percent;
      loan.storage_charge_percent = period.storage_charge_percent;
      loan.penalty_percent = period.penalty_percent;
      loan.grace_days = period.grace_days;
      loan.interest_period_days = period.days;
      loan.interest_amount = interestAmount;
      loan.storage_charge_amount = storageChargeAmount;
      loan.expected_total_repayable = expectedTotalRepayable;
      loan.current_balance = expectedTotalRepayable;
      loan.current_cycle_paid = 0;
      loan.start_date = rolloverStart;
      loan.due_date = dueDate;
      loan.carried_forward_arrears = carriedForwardArrears;
      // Rebuilt clean — no stale penalty_* keys carried forward from a prior cycle.
      loan.repayment_breakdown = {
        principal_amount: newPrincipal,
        admin_fee_pct: 0,
        admin_fee_amount: 0,
        admin_fee_type: null,
        interest_base: interestBase,
        loan_period_days: loanPeriodDaysActual,
        interest_period_days: period.days,
        number_of_periods: 1,
        interest_rate_percent: period.interest_rate_percent,
        interest_amount: interestAmount,
        storage_charge_percent: period.storage_charge_percent,
        storage_charge_amount: storageChargeAmount,
        expected_total_repayable: expectedTotalRepayable,
        carried_forward_arrears: carriedForwardArrears,
        rollover_cycle_no: cycleNo,
        calculation_note:
          carriedForwardArrears > 0
            ? "Total = (Principal + Arrears carried forward) + ((Principal + Arrears) × Interest%) + ((Principal + Arrears) × Storage%). Unpaid interest/storage from the previous cycle compounds into this one's charge."
            : "Total = Principal + (Principal × Interest%) + (Principal × Storage%).",
      };
      // A rollover always leaves the loan on a real, live status — never the old
      // "rolled_over" terminal status — reflecting whether the new due date already passed.
      loan.status = dueDate.getTime() < Date.now() ? "overdue" : "active";

      // Deprecated chain fields, kept readable for one release — now pointing at THIS
      // loan, since there is no separate document any more.
      loan.is_rollover = true;
      loan.rollover_generation = cycleNo;
      loan.rollover_payment_amount = paymentAmount;
      loan.rollover_notes = notes || "";
      loan.rollover_override = overrideInfo
        ? { ...overrideSnapshot, from_loan_no: loan.loan_no, payment_collected: 0, arrears_carried_forward: carriedForwardArrears }
        : null;

      if (consumedApproval) {
        loan.pending_rollover_approval.status = "consumed";
        loan.pending_rollover_approval.consumed_by_cycle_no = cycleNo;
      }

      await loan.save({ session, validateModifiedOnly: true });

      // The asset never leaves storage and never re-points — it's still the same loan.
      await Asset.findByIdAndUpdate(loan.asset, { status: "pawned", active_loan: loan._id }, { session });

      await session.commitTransaction();

      // Every rollover gets an audit log entry now — previously only an override did.
      auditLogService
        .logLoanAction(
          loan._id,
          userId,
          overrideInfo ? "rollover_override" : "rollover",
          { status: prevStatus, current_balance: prevBalance, principal_amount: prevPrincipal, rollover_count: currentRolloverCount },
          {
            status: loan.status,
            current_balance: loan.current_balance,
            principal_amount: loan.principal_amount,
            rollover_count: loan.rollover_count,
            due_date: loan.due_date,
          },
          requestMeta.ip,
          requestMeta.userAgent,
          {
            loan_no: loan.loan_no,
            cycle_no: cycleNo,
            payment_amount: paymentAmount,
            arrears_carried_forward: carriedForwardArrears,
            ...(overrideInfo
              ? {
                  reason_category: overrideInfo.reason_category,
                  reason_label: overrideInfo.reason_label,
                  override_notes: overrideInfo.notes,
                  overridden_by: actorName,
                  overridden_by_role: actorRole,
                }
              : {}),
          },
        )
        .catch((err) => console.error("Rollover audit log failed:", err.message));

      // One loan, one allocation for its whole life now — extend it with this cycle
      // instead of closing one allocation and opening another.
      investorAllocationService
        .recordRolloverCycle(loan._id, cycleNo)
        .catch((err) => console.error(`[InvestorAllocation] Rollover cycle record error for loan ${loan.loan_no}:`, err.message));

      // Xero: post the rollover payment (skipped on an override / $0 payment) and reverse
      // any auction reclass this loan was carrying.
      if (paymentAmount > 0) {
        xeroSyncService
          .syncLoanRollover(loan, newCycleId)
          .catch((err) => console.error(`[Xero] Rollover sync error for loan ${loan.loan_no}:`, err.message));
      }
      if (auctionReclassAmountToReverse) {
        xeroSyncService
          .syncRolloverAuctionReversal(loan, newCycleId, auctionReclassAmountToReverse)
          .catch((err) => console.error(`[Xero] Rollover auction-reversal sync error for loan ${loan.loan_no}:`, err.message));
      }

      // Agent commission — a rollover payment previously never accrued interest commission
      // at all. The exact interest portion is passed in rather than left to re-derive from
      // generic ratios, which assume the whole payment spans principal too (it doesn't here).
      if (paymentAmount > 0 && interestPortion > 0) {
        agentCommissionService
          .accrueInterestCommission(loan, paymentAmount, paymentEntryId, { interestPortion })
          .catch((err) => console.error(`[AgentCommission] Rollover accrual error for loan ${loan.loan_no}:`, err.message));
      }

      // ── Notifications (outside the transaction — non-critical) ──
      try {
        const customer = await User.findById(loan.customer_user).select("first_name last_name email phone");
        if (customer && customer._id) {
          const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer";
          const frontendUrl = process.env.FRONTEND_URL || "https://www.rtcapital.co.zw/";
          await NotificationService.createNotification(
            {
              title: "Loan Rolled Over",
              message: `Your loan ${loan.loan_no} was renewed (rollover ${cycleNo}). New due date: ${dueDate.toDateString()}.`,
              type: "loan_disbursed",
              priority: "high",
              audience: { scope: "user", user_id: customer._id },
              channels: ["in_app", "email", "sms"],
              entity_type: "loan",
              entity_id: loan._id,
              action_text: "View Loan Details",
              action_url: `${frontendUrl}/customer/loans/${loan._id}`,
              data: { loan_id: loan._id, loan_no: loan.loan_no, cycle_no: cycleNo },
            },
            userId,
          ).catch((err) => console.error("Rollover customer notification error:", err.message));

          // An override rollover sends its own, more informative admin notification below
          // (who overrode, why, what carried forward) — skip the plain "$0 payment" email so
          // admins don't get two emails for one event.
          if (!overrideInfo) {
            sendLoanRolloverAdminEmail({
              loanNo: loan.loan_no,
              newLoanNo: loan.loan_no,
              customerName,
              principalAmount: loan.principal_amount,
              paymentAmount,
              carriedForwardArrears,
              loanPeriodType: loan.loan_period_type,
              dueDate: loan.due_date,
            }).catch((err) => console.error("Rollover admin email error:", err.message));
          } else {
            NotificationService.createNotification(
              {
                title: `Override Rollover — Loan #${loan.loan_no}`,
                message:
                  `${actorName}${actorRole ? ` (${actorRole})` : ""} rolled over loan #${loan.loan_no} (${customerName}, cycle ${cycleNo}) with NO payment collected. ` +
                  `Reason: ${overrideInfo.reason_label}.` +
                  `${carriedForwardArrears > 0 ? ` $${carriedForwardArrears.toFixed(2)} carried forward as arrears.` : ""}` +
                  `${overrideInfo.notes ? ` Notes: ${overrideInfo.notes}` : ""}`,
                type: "system_notice",
                priority: "high",
                audience: { scope: "roles", roles: ["super_admin_vendor", "admin_pawn_limited", "management"] },
                channels: ["in_app", "email"],
                entity_type: "loan",
                entity_id: loan._id,
                action_url: `/loans/${loan._id}`,
                action_text: "View Loan",
              },
              userId,
            ).catch((err) => console.error("Override rollover notification failed:", err.message));
          }
        }
      } catch (notifyErr) {
        console.error("Rollover notification error (non-fatal):", notifyErr.message);
      }

      const populatedLoan = await Loan.findById(loan._id).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status asset_images" },
      ]);

      return {
        success: true,
        // old_loan/new_loan both point at the SAME loan now — kept for one release so a
        // stale cached frontend build doesn't break. New code should read data.loan/data.cycle.
        data: { loan: populatedLoan, cycle: cycleRecord, old_loan: populatedLoan, new_loan: populatedLoan },
        message: `Loan ${loan.loan_no} rolled over (cycle ${cycleNo})${overrideInfo ? " — override, no payment collected" : ""}`,
      };
    } catch (error) {
      await session.abortTransaction();
      throw this.handleMongoError(error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Request admin approval for a loan's 4th+ rollover. No money changes hands here — the
   * actual rollover (payment collection) only happens after an admin approves this.
   */
  async requestRolloverApproval(loanId, { reason, proposed_payment_amount, proposed_loan_period_type } = {}, requesterId) {
    const loan = await Loan.findById(loanId);
    if (!loan) throw { status: 404, message: `Loan with ID ${loanId} not found` };

    if ((loan.rollover_count || 0) < ROLLOVER_FREE_LIMIT) {
      throw { status: 400, message: `Loan ${loan.loan_no} hasn't reached the ${ROLLOVER_FREE_LIMIT}-rollover cap yet — no approval is needed.` };
    }
    if (loan.pending_rollover_approval && ["pending", "approved"].includes(loan.pending_rollover_approval.status)) {
      throw { status: 400, message: "A rollover approval request is already open for this loan." };
    }
    if (!reason || !reason.trim()) {
      throw { status: 400, message: "A reason is required to request rollover approval." };
    }

    const requester = requesterId ? await User.findById(requesterId).select("first_name last_name email") : null;
    const requesterName = requester ? `${requester.first_name || ""} ${requester.last_name || ""}`.trim() || requester.email : "Unknown";
    const approvers = await User.find({ roles: { $in: ROLLOVER_APPROVER_ROLES }, status: "active" }).select("_id email phone first_name last_name");

    loan.pending_rollover_approval = {
      request_id: new mongoose.Types.ObjectId(),
      status: "pending",
      requested_by: requesterId || null,
      requested_by_name: requesterName,
      requested_at: new Date(),
      reason: reason.trim(),
      proposed_payment_amount: proposed_payment_amount != null ? Number(proposed_payment_amount) : null,
      proposed_loan_period_type: proposed_loan_period_type || null,
      requested_admins: approvers.map((a) => a._id),
    };
    await loan.save({ validateModifiedOnly: true });

    auditLogService
      .logLoanAction(loan._id, requesterId, "rollover_approval_requested", null, { reason: reason.trim(), rollover_count: loan.rollover_count }, null, null, { loan_no: loan.loan_no })
      .catch((err) => console.error("Rollover approval request audit failed:", err.message));

    const frontendUrl = process.env.FRONTEND_URL || "https://www.rtcapital.co.zw/";
    for (const a of approvers) {
      if (a.email) {
        await sendEmail({
          to: a.email,
          subject: `Rollover approval needed: ${loan.loan_no}`,
          text: `${requesterName} is requesting approval to roll over loan ${loan.loan_no} again — it has already rolled over ${loan.rollover_count} times. Reason: ${reason.trim()}. Review: ${frontendUrl}/loans/${loan._id}`,
        }).catch((err) => console.error(`Rollover approval email to ${a.email} failed:`, err.message));
      }
    }
    NotificationService.createNotification(
      {
        title: `Rollover Approval Needed — Loan #${loan.loan_no}`,
        message: `${requesterName} wants to roll loan #${loan.loan_no} over again (already rolled over ${loan.rollover_count} times). Reason: ${reason.trim()}`,
        type: "system_notice",
        priority: "high",
        audience: { scope: "roles", roles: ROLLOVER_APPROVER_ROLES },
        channels: ["in_app", "email"],
        entity_type: "loan",
        entity_id: loan._id,
        action_url: `/loans/${loan._id}`,
        action_text: "Review Request",
      },
      requesterId,
    ).catch((err) => console.error("Rollover approval notification failed:", err.message));

    return { success: true, message: "Rollover approval requested.", data: { request_id: loan.pending_rollover_approval.request_id } };
  }

  /**
   * An admin approves or rejects a pending rollover approval request.
   */
  async decideRolloverApproval(loanId, requestId, decision, decisionNotes, deciderId) {
    if (!["approve", "reject"].includes(decision)) {
      throw { status: 400, message: 'decision must be "approve" or "reject".' };
    }
    const loan = await Loan.findById(loanId);
    if (!loan) throw { status: 404, message: `Loan with ID ${loanId} not found` };

    const pending = loan.pending_rollover_approval;
    if (!pending || String(pending.request_id) !== String(requestId) || pending.status !== "pending") {
      throw { status: 404, message: "No pending rollover approval request with that ID for this loan." };
    }

    const decider = deciderId ? await User.findById(deciderId).select("first_name last_name email roles") : null;
    if (!decider || !ROLLOVER_APPROVER_ROLES.some((r) => (decider.roles || []).includes(r))) {
      throw { status: 403, message: `Only ${ROLLOVER_APPROVER_ROLES.join(" or ")} can decide a rollover approval request.` };
    }
    const deciderName = `${decider.first_name || ""} ${decider.last_name || ""}`.trim() || decider.email;

    pending.status = decision === "approve" ? "approved" : "rejected";
    pending.decided_by = deciderId;
    pending.decided_by_name = deciderName;
    pending.decided_at = new Date();
    pending.decision_notes = decisionNotes || null;
    if (decision === "approve") {
      pending.expires_at = new Date(Date.now() + ROLLOVER_APPROVAL_VALID_HOURS * 60 * 60 * 1000);
    }
    await loan.save({ validateModifiedOnly: true });

    auditLogService
      .logLoanAction(loan._id, deciderId, `rollover_approval_${decision === "approve" ? "approved" : "rejected"}`, { status: "pending" }, { status: pending.status, notes: decisionNotes || null }, null, null, { loan_no: loan.loan_no })
      .catch((err) => console.error("Rollover approval decision audit failed:", err.message));

    if (pending.requested_by) {
      const requester = await User.findById(pending.requested_by).select("email");
      if (requester?.email) {
        await sendEmail({
          to: requester.email,
          subject: `Rollover request ${decision === "approve" ? "approved" : "rejected"}: ${loan.loan_no}`,
          text:
            decision === "approve"
              ? `${deciderName} approved your rollover request for loan ${loan.loan_no}. You can now complete the rollover — the approval expires in ${ROLLOVER_APPROVAL_VALID_HOURS} hours.`
              : `${deciderName} rejected your rollover request for loan ${loan.loan_no}.${decisionNotes ? ` Reason: ${decisionNotes}` : ""}`,
        }).catch((err) => console.error("Rollover decision email failed:", err.message));
      }
    }

    return { success: true, message: `Rollover request ${pending.status}.`, data: { status: pending.status, expires_at: pending.expires_at || null } };
  }

  /**
   * The requester (or an approver) withdraws a still-pending rollover approval request.
   */
  async cancelRolloverApproval(loanId, requestId, userId) {
    const loan = await Loan.findById(loanId);
    if (!loan) throw { status: 404, message: `Loan with ID ${loanId} not found` };
    const pending = loan.pending_rollover_approval;
    if (!pending || String(pending.request_id) !== String(requestId) || pending.status !== "pending") {
      throw { status: 404, message: "No pending rollover approval request with that ID for this loan." };
    }
    pending.status = "cancelled";
    pending.decided_by = userId || null;
    pending.decided_at = new Date();
    await loan.save({ validateModifiedOnly: true });
    return { success: true, message: "Rollover approval request cancelled." };
  }

  /**
   * A loan's own rollover history — trivial now that a rollover no longer spans separate
   * documents. Kept as its own endpoint (deprecated) for one release; new frontend code
   * should just read loan.rollover_cycles off the normal loan-detail response instead.
   * `role` redacts staff/override/approval detail for a customer or agent caller — same
   * redaction getLoan() applies (see loan_controller.js).
   */
  async getRolloverChain(loanId, role) {
    try {
      const loan = await Loan.findById(loanId).select(
        "loan_no rollover_count retired_loan_nos rollover_cycles merged_into_loan status",
      );
      if (!loan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      const restricted = role === "customer" || role === "agent";
      const cycles = (loan.rollover_cycles || []).map((c) => {
        const cycle = c.toObject ? c.toObject() : c;
        if (!restricted) return cycle;
        const { performed_by, performed_by_name, performed_by_role, override, approval, ...rest } = cycle;
        if (rest.payment) {
          const { received_by, notes, ...paymentRest } = rest.payment;
          rest.payment = paymentRest;
        }
        return rest;
      });

      return {
        success: true,
        data: {
          loan_id: loan._id,
          loan_no: loan.loan_no,
          retired_loan_nos: loan.retired_loan_nos || [],
          rollover_count: loan.rollover_count || 0,
          merged_into_loan: loan.merged_into_loan || null,
          cycles,
        },
        message: "Rollover history retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Per-loan-processor rollover performance stats — now aggregated across every loan's
   * rollover_cycles[] entries rather than counting separate is_rollover:true documents.
   */
  async getRolloverPerformanceStats(filters = {}) {
    try {
      const match = { "rollover_cycles.0": { $exists: true } };
      const dateFilter = {};
      if (filters.created_from) dateFilter.$gte = new Date(filters.created_from);
      if (filters.created_to) dateFilter.$lte = new Date(filters.created_to);

      const pipeline = [
        { $match: match },
        { $unwind: "$rollover_cycles" },
      ];
      if (dateFilter.$gte || dateFilter.$lte) {
        pipeline.push({ $match: { "rollover_cycles.performed_at": dateFilter } });
      }
      pipeline.push(
        {
          $group: {
            _id: "$rollover_cycles.performed_by",
            count: { $sum: 1 },
            total_principal: { $sum: "$rollover_cycles.new_principal" },
            total_arrears: { $sum: "$rollover_cycles.arrears_carried_forward" },
            total_collected: { $sum: { $ifNull: ["$rollover_cycles.payment.amount", 0] } },
          },
        },
        { $sort: { count: -1 } },
      );

      const stats = await Loan.aggregate(pipeline);

      const processorIds = stats.map((s) => s._id).filter(Boolean);
      const processors = await User.find({ _id: { $in: processorIds } })
        .select("first_name last_name email roles")
        .lean();
      const processorsById = new Map(processors.map((p) => [String(p._id), p]));

      const data = stats.map((s) => ({
        processor: s._id ? processorsById.get(String(s._id)) || { _id: s._id } : null,
        rollover_count: s.count,
        total_principal_renewed: s.total_principal,
        total_arrears_carried: s.total_arrears,
        total_collected: s.total_collected,
      }));

      return {
        success: true,
        data,
        message: "Rollover performance stats retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Validate loan status transition
   */
  validateStatusTransition(currentStatus, newStatus, loan) {
    const validTransitions = {
      draft: ["pending_approval", "active", "cancelled"],
      pending_approval: ["approved", "active", "cancelled"],
      approved: ["active", "cancelled"],
      active: [
        "overdue",
        "in_grace",
        "redeemed",
        "closed",
        "partially_paid",
        "defaulted",
      ],
      overdue: ["in_grace", "auction", "redeemed", "closed", "partially_paid"],
      in_grace: ["auction", "redeemed", "closed", "overdue"],
      // "rolled_over" removed 2026-09-30 — a rollover no longer changes the loan's own
      // status (see rolloverLoan) and this map is never consulted for it anyway.
      auction: ["sold", "closed"],
      sold: ["closed"],
      redeemed: ["closed"],
      partially_paid: ["active", "overdue", "redeemed", "closed"],
      defaulted: ["auction", "written_off"],
      written_off: ["closed"],
      closed: [],
      cancelled: [],
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw {
        status: 400,
        message: `Invalid status transition from ${currentStatus} to ${newStatus}`,
      };
    }

    // Additional business rules
    if (newStatus === "redeemed" && loan.current_balance > 0) {
      throw {
        status: 400,
        message: "Cannot redeem loan with outstanding balance",
      };
    }
  }

  /**
   * Update asset status based on loan status
   */
  async updateAssetStatusBasedOnLoan(loan) {
    const assetStatusMap = {
      active: "pawned",
      overdue: "overdue",
      in_grace: "overdue",
      auction: "auction",
      sold: "sold",
      redeemed: "redeemed",
      closed: "closed",
      cancelled: "closed",
      defaulted: "auction",
      partially_paid: "pawned",
    };

    const newAssetStatus = assetStatusMap[loan.status];
    if (!newAssetStatus || !loan.asset) return;

    const assetId = loan.asset._id || loan.asset;

    if (loan.status === "active" || loan.status === "partially_paid") {
      await Asset.findByIdAndUpdate(assetId, {
        status: newAssetStatus,
        active_loan: loan._id,
      });
    } else if (["redeemed", "closed", "cancelled", "sold"].includes(loan.status)) {
      await Asset.findByIdAndUpdate(assetId, {
        status: newAssetStatus,
        $unset: { active_loan: "" },
      });
    } else {
      await Asset.findByIdAndUpdate(assetId, { status: newAssetStatus });
    }
  }

  /**
   * Calculate interest, storage charge, and total repayable from loan terms.
   * Sets interest_amount, storage_charge_amount, expected_total_repayable,
   * repayment_breakdown, and current_balance on loanData in-place.
   */
  /**
   * Validates the admin fee (0-10% of principal) and computes admin_fee_amount from
   * admin_fee_pct + principal_amount. Negotiated by the Loan Processor/Super Admin at
   * loan CREATION time — not at application. Pure RTC revenue; kept entirely separate
   * from interest/storage so it never bleeds into an investor's profit split (see
   * investor_allocation_service.assignLoan).
   */
  validateAdminFee(loanData) {
    const pct = loanData.admin_fee_pct;
    if (pct == null || pct === 0) {
      // No fee on this loan — reset any stray fields to a clean, consistent "no fee" state.
      loanData.admin_fee_pct = 0;
      loanData.admin_fee_amount = 0;
      loanData.admin_fee_type = null;
      loanData.admin_fee_collected = false;
      loanData.admin_fee_collected_at = null;
      return;
    }

    if (typeof pct !== "number" || pct < 0 || pct > 10) {
      throw { status: 400, message: "admin_fee_pct must be a number between 0 and 10." };
    }
    if (!["upfront", "deferred"].includes(loanData.admin_fee_type)) {
      throw {
        status: 400,
        message: 'admin_fee_type must be "upfront" or "deferred" when admin_fee_pct is set.',
      };
    }

    loanData.admin_fee_amount = parseFloat(
      ((loanData.principal_amount || 0) * (pct / 100)).toFixed(2)
    );

    if (loanData.admin_fee_type === "upfront" && loanData.admin_fee_collected) {
      loanData.admin_fee_collected_at = new Date();
    } else {
      loanData.admin_fee_collected = false;
      loanData.admin_fee_collected_at = null;
    }
  }

  /**
   * Add more principal to an already-active loan (Loan Processor/Admin only). The loan's
   * start_date/due_date never change — a top-up just adds money mid-term. Interest and
   * storage on the added amount are prorated for the days actually remaining until
   * due_date (not the loan's full original period), since that's the only time the extra
   * money is really out there earning. Admin fee (if any) applies to the added amount
   * only — the original principal's fee was already assessed at creation.
   */
  async topUpLoan(loanId, topUpData, userId) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      throw { status: 400, message: "Invalid loan ID." };
    }
    const {
      amount,
      admin_fee_pct,
      admin_fee_type,
      notes,
      bank_account_key,
      admin_fee_payment_method,
      admin_fee_bank_account_key,
      admin_fee_commission_pct,
    } = topUpData;
    if (!amount || amount <= 0) {
      throw { status: 400, message: "Top-up amount must be greater than 0." };
    }

    const loan = await Loan.findById(loanId);
    if (!loan) throw { status: 404, message: "Loan not found." };
    if (loan.status !== "active") {
      throw { status: 400, message: `Loan must be active to top up (current status: "${loan.status}").` };
    }

    // Admin fee for THIS top-up defaults to whatever's already negotiated on the loan, but
    // can be renegotiated per top-up.
    const feePct = admin_fee_pct != null ? admin_fee_pct : (loan.admin_fee_pct || 0);
    if (typeof feePct !== "number" || feePct < 0 || feePct > 10) {
      throw { status: 400, message: "admin_fee_pct must be a number between 0 and 10." };
    }
    const feeType = feePct > 0 ? (admin_fee_type || loan.admin_fee_type || "deferred") : null;
    if (feePct > 0 && !["upfront", "deferred"].includes(feeType)) {
      throw { status: 400, message: 'admin_fee_type must be "upfront" or "deferred" when admin_fee_pct is set.' };
    }

    // Referral commission on THIS top-up's fee — defaults to the loan's negotiated rate,
    // same "carry forward unless renegotiated" behavior as the fee % itself. Only
    // meaningful on a referral loan; commissionPct is capped at feePct exactly like
    // agentCommissionService.validateReferralCommission caps it against admin_fee_pct.
    const commissionPct = loan.is_referral_loan
      ? (admin_fee_commission_pct != null ? admin_fee_commission_pct : (loan.admin_fee_commission_pct || 0))
      : 0;
    if (typeof commissionPct !== "number" || commissionPct < 0) {
      throw { status: 400, message: "admin_fee_commission_pct must be a number 0 or greater." };
    }
    if (commissionPct > feePct) {
      throw {
        status: 400,
        message: `admin_fee_commission_pct (${commissionPct}) cannot exceed this top-up's admin_fee_pct (${feePct}).`,
      };
    }

    const now = new Date();
    const dueDate = new Date(loan.due_date);
    const remainingDays = Math.max(Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)), 0);
    if (remainingDays === 0) {
      throw { status: 400, message: "This loan's due date has already passed — top-ups aren't supported on an overdue loan." };
    }
    const interestPeriodDays = loan.interest_period_days || 30;
    const numberOfPeriods = remainingDays / interestPeriodDays;

    const feeIsDeferred = feeType === "deferred";
    const adminFeeAmount = parseFloat((amount * (feePct / 100)).toFixed(2));
    const interestBase = feeIsDeferred ? amount + adminFeeAmount : amount;

    const topUpInterest = parseFloat((interestBase * (loan.interest_rate_percent / 100) * numberOfPeriods).toFixed(2));
    const topUpStorage = parseFloat((interestBase * (loan.storage_charge_percent / 100) * numberOfPeriods).toFixed(2));
    const balanceIncrease = parseFloat((interestBase + topUpInterest + topUpStorage).toFixed(2));

    // Confirm the investor side can actually take the extra money BEFORE touching the
    // Loan document — if this throws, nothing below has been written yet.
    await investorAllocationService.topUpAllocation(loan._id, {
      amount,
      interestAmount: topUpInterest,
      storageAmount: topUpStorage,
      adminFeePct: feePct,
      adminFeeType: feeType,
      adminFeeAmount,
      adminFeePaymentMethod: admin_fee_payment_method,
      adminFeeBankAccountKey: admin_fee_bank_account_key,
      loanNo: loan.loan_no,
    });

    loan.principal_amount = parseFloat((loan.principal_amount + amount).toFixed(2));
    loan.interest_amount = parseFloat((loan.interest_amount + topUpInterest).toFixed(2));
    loan.storage_charge_amount = parseFloat((loan.storage_charge_amount + topUpStorage).toFixed(2));
    loan.expected_total_repayable = parseFloat((loan.expected_total_repayable + balanceIncrease).toFixed(2));
    loan.current_balance = parseFloat((loan.current_balance + balanceIncrease).toFixed(2));
    loan.admin_fee_amount = parseFloat(((loan.admin_fee_amount || 0) + adminFeeAmount).toFixed(2));
    const commissionAmount = parseFloat((amount * (commissionPct / 100)).toFixed(2));
    loan.top_ups.push({
      amount,
      interest_amount: topUpInterest,
      storage_charge_amount: topUpStorage,
      admin_fee_pct: feePct,
      admin_fee_amount: adminFeeAmount,
      admin_fee_type: feeType,
      admin_fee_commission_pct: commissionPct,
      admin_fee_commission_amount: commissionAmount,
      bank_account_key: bank_account_key || null,
      admin_fee_bank_account_key: admin_fee_bank_account_key || null,
      added_at: now,
      added_by: userId,
      notes,
    });
    await loan.save();

    const newTopUpIndex = loan.top_ups.length - 1;

    // Post this top-up's admin fee to Xero as real RTC revenue (Admin Fee Income) —
    // same fix as the original loan's fee, see investorAllocationService.assignLoan.
    xeroSyncService
      .syncAdminFeeRecognized(loan, {
        topUpIndex: newTopUpIndex,
        feeAmount: adminFeeAmount,
        feeType,
        paymentMethod: admin_fee_payment_method,
        bankAccountKey: admin_fee_bank_account_key,
        date: now,
      })
      .catch((err) => console.error(`[Xero] top-up admin fee sync error for loan ${loan.loan_no}:`, err.message));

    // Agent admin-fee commission on this top-up's fee — mirrors the loan-creation accrual
    // in investorAllocationService.assignLoan. Caught independently so a commission
    // failure never blocks the top-up itself.
    try {
      await agentCommissionService.accrueAdminFeeCommission(loan, {
        sourceEvent: "top_up",
        topUpIndex: newTopUpIndex,
        feeAmount: adminFeeAmount,
        relevantPrincipal: amount,
        commissionPct,
      });
    } catch (err) {
      console.error(`[AgentCommission] top-up admin-fee accrual failed for loan ${loan.loan_no}:`, err.message);
    }

    return { success: true, loan, topUp: loan.top_ups[loan.top_ups.length - 1] };
  }

  calculateRepaymentBreakdown(loanData) {
    const principal = loanData.principal_amount;
    const interestRate = loanData.interest_rate_percent;
    const storageRate = loanData.storage_charge_percent;
    const interestPeriodDays = loanData.interest_period_days || 30;
    const adminFeeAmount = loanData.admin_fee_amount || 0;
    const feeIsDeferred = loanData.admin_fee_type === "deferred";

    if (!principal || interestRate == null || storageRate == null) {
      // Not enough data to calculate — fall back to principal (+ deferred fee) as balance
      if (!loanData.current_balance && principal) {
        loanData.current_balance = principal + (feeIsDeferred ? adminFeeAmount : 0);
      }
      return;
    }

    // Every loan is exactly one billing cycle (one "two_weeks" or "one_month" term),
    // so interest/storage are always charged for exactly 1 period — never prorated by
    // the literal day-count between start_date and due_date. That day-count can drift
    // a little from the nominal period length (e.g. a calendar month can land the due
    // date 28-31 days out), which used to produce odd multipliers like 1.0333 periods
    // and overcharge the customer for a few extra days they didn't actually borrow for.
    let loanPeriodDays = null;
    const numberOfPeriods = 1;

    if (loanData.start_date && loanData.due_date) {
      const startDate = new Date(loanData.start_date);
      const dueDate = new Date(loanData.due_date);
      loanPeriodDays = Math.ceil((dueDate - startDate) / (1000 * 60 * 60 * 24));
    }

    // Deferred admin fee is added to the customer's owed balance, so interest is charged
    // on principal + fee together. An upfront fee is collected as separate cash at signing
    // and never touches what the customer owes back — interest stays on principal alone.
    const interestBase = feeIsDeferred ? principal + adminFeeAmount : principal;

    const interestAmount = parseFloat(
      (interestBase * (interestRate / 100) * numberOfPeriods).toFixed(2)
    );
    const storageChargeAmount = parseFloat(
      (interestBase * (storageRate / 100) * numberOfPeriods).toFixed(2)
    );
    const totalRepayable = parseFloat(
      (interestBase + interestAmount + storageChargeAmount).toFixed(2)
    );

    loanData.interest_amount = interestAmount;
    loanData.storage_charge_amount = storageChargeAmount;
    loanData.expected_total_repayable = totalRepayable;
    loanData.current_balance = totalRepayable;

    loanData.repayment_breakdown = {
      principal_amount: principal,
      admin_fee_pct: loanData.admin_fee_pct || 0,
      admin_fee_amount: adminFeeAmount,
      admin_fee_type: loanData.admin_fee_type || null,
      interest_base: interestBase,
      loan_period_days: loanPeriodDays,
      interest_period_days: interestPeriodDays,
      number_of_periods: parseFloat(numberOfPeriods.toFixed(4)),
      interest_rate_percent: interestRate,
      interest_amount: interestAmount,
      storage_charge_percent: storageRate,
      storage_charge_amount: storageChargeAmount,
      expected_total_repayable: totalRepayable,
      calculation_note: feeIsDeferred
        ? "Total = (Principal + Admin Fee) + ((Principal + Admin Fee) × Interest% × Periods) + ((Principal + Admin Fee) × Storage% × Periods). Admin fee is added to what the customer owes."
        : adminFeeAmount > 0
          ? "Total = Principal + (Principal × Interest% × Periods) + (Principal × Storage% × Periods). Admin fee is collected separately upfront and does not affect the amount owed."
          : "Total = Principal + (Principal × Interest% × Periods) + (Principal × Storage% × Periods).",
    };
  }

  /**
   * Validate loan dates
   */
  validateLoanDates(loanData) {
    if (loanData.start_date && loanData.due_date) {
      const startDate = new Date(loanData.start_date);
      const dueDate = new Date(loanData.due_date);

      if (dueDate <= startDate) {
        throw {
          status: 400,
          message: "Due date must be after start date",
        };
      }
    }
  }

  /**
   * Admin override: bypass all status-transition guards, optionally record a
   * payment, cancel any live auction, and force-set the loan to any status.
   * Restricted to super_admin_vendor at the route layer.
   */
  async adminOverrideLoan(loanId, overrideData, adminUserId, requestMeta = {}) {
    if (!mongoose.Types.ObjectId.isValid(loanId)) {
      throw { status: 400, message: "Invalid loan ID." };
    }

    const {
      new_status,
      payment_amount,
      payment_method,
      payment_reference,
      payment_notes,
      admin_notes,
      reason_category,
      waive_penalty,
      bank_account_key,
    } = overrideData || {};

    if (!reason_category || !OVERRIDE_REASON_CATEGORIES[reason_category]) {
      throw {
        status: 400,
        message: `reason_category is required and must be one of: ${Object.keys(OVERRIDE_REASON_CATEGORIES).join(", ")}`,
      };
    }
    const reasonLabel = OVERRIDE_REASON_CATEGORIES[reason_category];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const loan = await Loan.findById(loanId).session(session);
      if (!loan) throw { status: 404, message: `Loan ${loanId} not found` };

      const before = {
        status: loan.status,
        current_balance: loan.current_balance,
        total_paid: loan.total_paid,
      };

      const updateData = { updated_at: new Date() };

      // ── Optional payment ──────────────────────────────────────────────────
      const payAmt = Number(payment_amount);
      if (payAmt > 0) {
        const validMethods = ["cash", "bank_transfer", "mobile_money", "cheque"];
        if (!validMethods.includes(payment_method)) {
          throw { status: 400, message: `payment_method must be one of: ${validMethods.join(", ")}` };
        }

        const paymentRecord = {
          amount:         payAmt,
          payment_date:   new Date(),
          payment_method,
          status:         "paid",
          reference_no:   payment_reference || `ADMIN-OVR-${Date.now()}`,
          received_by:    adminUserId,
          notes:          payment_notes || `Admin override (${reasonLabel}) — ${admin_notes || ""}`,
          bank_account_key: bank_account_key || null,
        };

        updateData.$push       = { payments: paymentRecord };
        updateData.total_paid  = parseFloat((loan.total_paid + payAmt).toFixed(2));

        const newBalance = Math.max(0, parseFloat((loan.current_balance - payAmt).toFixed(2)));
        updateData.current_balance = newBalance;
      }

      // ── Force status ──────────────────────────────────────────────────────
      if (new_status) {
        updateData.status = new_status;

        // When forcing "redeemed" or "closed" — zero the balance if a payment
        // fully covered it (guard: don't zero if balance remains)
        if (["redeemed", "closed"].includes(new_status)) {
          const balanceAfterPay = updateData.current_balance ?? loan.current_balance;
          if (balanceAfterPay <= 0) updateData.current_balance = 0;
        }

        // Stamp audit trail
        updateData.$push = updateData.$push || {};
        if (!updateData.$push.status_history) {
          updateData.$push.status_history = {
            from:       loan.status,
            to:         new_status,
            changed_by: adminUserId,
            changed_at: new Date(),
            notes:      `Admin override (${reasonLabel}): ${admin_notes || "no notes"}`,
          };
        }
      }

      // ── Cancel any live auction when loan is being resolved ───────────────
      const resolvedStatuses = ["redeemed", "closed", "active", "in_grace", "overdue"];
      if (new_status && resolvedStatuses.includes(new_status)) {
        await Auction.findOneAndUpdate(
          { asset: loan.asset, status: { $in: ["draft", "live"] } },
          { $set: { status: "cancelled" } },
          { session },
        );
      }

      await Loan.findByIdAndUpdate(loan._id, updateData, { session });

      // ── Sync asset status ─────────────────────────────────────────────────
      const assetStatusMap = {
        active:       "pawned",
        overdue:      "overdue",
        in_grace:     "overdue",
        auction:      "auction",
        sold:         "sold",
        redeemed:     "redeemed",
        closed:       "closed",
        cancelled:    "closed",
        partially_paid: "pawned",
      };
      const newAssetStatus = assetStatusMap[new_status];
      if (newAssetStatus && loan.asset) {
        const assetUpdate = { status: newAssetStatus };
        if (["redeemed", "closed", "cancelled", "sold"].includes(new_status)) {
          assetUpdate.$unset = { active_loan: "" };
        }
        await Asset.findByIdAndUpdate(loan.asset, assetUpdate, { session });
      }

      await session.commitTransaction();

      let updated = await Loan.findById(loan._id).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset",         select: "asset_no title status" },
        { path: "payments.received_by", select: "first_name last_name email" },
      ]);

      const customer = updated.customer_user;
      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "Unknown Client";
      const actor = await User.findById(adminUserId).select("first_name last_name email roles");
      const actorName = actor
        ? `${actor.first_name || ""} ${actor.last_name || ""}`.trim() || actor.email
        : "Unknown";

      // Audit trail — every override is now categorized, not just free text.
      auditLogService
        .logLoanAction(
          loanId,
          adminUserId,
          "admin_override",
          before,
          { status: updated.status, current_balance: updated.current_balance, total_paid: updated.total_paid },
          requestMeta.ip,
          requestMeta.userAgent,
          {
            loan_no: updated.loan_no,
            customer_name: customerName,
            reason_category: reason_category,
            reason_label: reasonLabel,
            admin_notes: admin_notes || null,
            new_status: new_status || null,
            payment_amount: payAmt > 0 ? payAmt : null,
            overridden_by: actorName,
          }
        )
        .catch((err) => console.error("Admin override audit log failed:", err.message));

      // Notify admins/management what actually happened — the reason category makes
      // this readable ("asset sold", "late payment received") instead of just "status
      // changed to redeemed".
      NotificationService.createNotification(
        {
          title: `Admin Override — Loan #${updated.loan_no}`,
          message: `${actorName} applied an admin override on loan #${updated.loan_no} (${customerName}). Reason: ${reasonLabel}.${new_status ? ` Status → ${new_status.replace(/_/g, " ")}.` : ""}${payAmt > 0 ? ` Payment recorded: $${payAmt.toFixed(2)}.` : ""}${admin_notes ? ` Notes: ${admin_notes}` : ""}`,
          type: "system_notice",
          priority: "high",
          audience: {
            scope: "roles",
            roles: ["super_admin_vendor", "admin_pawn_limited", "management"],
          },
          channels: ["in_app", "email"],
          entity_type: "loan",
          entity_id: loanId,
          action_url: `/loans/${loanId}`,
          action_text: "View Loan",
        },
        adminUserId
      ).catch((err) => console.error("Admin override notification failed:", err.message));

      let penaltyWaiveNote = "";
      if (waive_penalty) {
        try {
          const waiveResult = await this.waivePenalty(
            loanId,
            { reason: `Admin override (${reasonLabel})${admin_notes ? `: ${admin_notes}` : ""}` },
            adminUserId,
            requestMeta
          );
          updated = waiveResult.data;
          penaltyWaiveNote = ` ${waiveResult.message}`;
        } catch (waiveErr) {
          // Don't fail the whole override if there's simply nothing to waive
          // (e.g. no penalty applied, or already waived) — just note it.
          penaltyWaiveNote = ` (Penalty waiver skipped: ${waiveErr.message || "not applicable"})`;
        }
      }

      return {
        success: true,
        data:    updated,
        message: `Loan ${loan.loan_no} updated via admin override${new_status ? ` → ${new_status}` : ""}.${penaltyWaiveNote}`,
      };
    } catch (err) {
      await session.abortTransaction();
      throw this.handleMongoError(err);
    } finally {
      session.endSession();
    }
  }

  /**
   * Handle MongoDB errors
   */
  handleMongoError(error) {
    console.error("Loan Service Error:", error);

    if (error.status && error.message) {
      return error;
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return {
        status: 409,
        message: `${field.replace("_", " ")} already exists`,
        field,
      };
    }

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return {
        status: 400,
        message: "Validation failed",
        errors,
      };
    }

    if (error.name === "CastError") {
      return {
        status: 400,
        message: `Invalid ${error.path}: ${error.value}`,
      };
    }

    return {
      status: 500,
      message: "Internal server error",
      detail: error.message,
    };
  }
}

module.exports = new LoanService();
