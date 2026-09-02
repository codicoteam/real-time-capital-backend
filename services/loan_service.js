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
} = require("../utils/emails_util");
const NotificationService = require("../services/notifications_service");
const investorAllocationService = require("../services/investor_allocation_service");

class LoanService {
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

      // Apply hardcoded rates from loan_period_type
      if (loanData.loan_period_type) {
        const period = LOAN_PERIODS[loanData.loan_period_type];
        if (!period) {
          throw { status: 400, message: `Invalid loan_period_type. Must be one of: ${Object.keys(LOAN_PERIODS).join(", ")}` };
        }
        loanData.interest_rate_percent = period.interest_rate_percent;
        loanData.storage_charge_percent = period.storage_charge_percent;
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
      if (filters.loan_no)
        query.loan_no = { $regex: filters.loan_no, $options: "i" };
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
            "asset_no title category evaluated_value declared_value status storage_location asset_images brand model serial_no make registration_no engine_no chassis_no metal_type purity weight_grams",
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
      if (filters.loan_no)
        query.loan_no = { $regex: filters.loan_no, $options: "i" };
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

      const { amount, payment_method, notes, reference_no, received_by } =
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
   * Roll over a loan: the customer pays down the interest/storage owed on the
   * current loan (in full or in part) instead of the collateral going to
   * auction. The current loan is closed with status "rolled_over" and a new
   * loan cycle is opened on the SAME asset (and, when present, the same
   * application — so collateral photos/details carry over with no re-upload).
   *
   * - Payment beyond what was owed above principal reduces the new loan's principal.
   * - A shortfall (payment less than what was owed above principal) becomes
   *   carried_forward_arrears on the new loan, added on top of its fresh
   *   interest/storage charge.
   * - The new loan skips the disbursement/approval workflow and goes straight
   *   to "active" — no new cash is disbursed, so there is nothing to approve
   *   for payout. `requires_super_admin_approval` is still recorded for
   *   audit on high-value rollovers, but does not block activation.
   */
  async rolloverLoan(loanId, rolloverData, userId) {
    const {
      payment_amount,
      payment_method,
      payment_reference,
      payment_notes,
      new_loan_period_type,
      start_date,
      notes,
    } = rolloverData || {};

    const paymentAmount = Number(payment_amount);
    if (!paymentAmount || paymentAmount <= 0) {
      throw { status: 400, message: "Rollover payment amount must be greater than 0" };
    }

    const validPaymentMethods = ["cash", "bank_transfer", "mobile_money", "cheque"];
    if (!validPaymentMethods.includes(payment_method)) {
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
      const oldLoan = await Loan.findById(loanId).session(session);
      if (!oldLoan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      if (!ROLLOVER_ELIGIBLE_STATUSES.includes(oldLoan.status)) {
        throw {
          status: 400,
          message: `Cannot roll over a loan with status: ${oldLoan.status}. Loan must be active, overdue, in_grace, partially_paid, or auction.`,
        };
      }

      const loanPeriodType = new_loan_period_type || oldLoan.loan_period_type;
      const period = LOAN_PERIODS[loanPeriodType];
      if (!period) {
        throw {
          status: 400,
          message: `Invalid new_loan_period_type. Must be one of: ${Object.keys(LOAN_PERIODS).join(", ")}`,
        };
      }

      // ── Split the rollover payment between what was owed above principal and any excess ──
      const owedAbovePrincipal = Math.max(0, oldLoan.current_balance - oldLoan.principal_amount);
      let carriedForwardArrears = 0;
      let newPrincipal = oldLoan.principal_amount;

      if (paymentAmount >= owedAbovePrincipal) {
        const excess = paymentAmount - owedAbovePrincipal;
        newPrincipal = parseFloat((oldLoan.principal_amount - excess).toFixed(2));
      } else {
        carriedForwardArrears = parseFloat((owedAbovePrincipal - paymentAmount).toFixed(2));
      }

      if (newPrincipal <= 0) {
        throw {
          status: 400,
          message:
            "This payment covers the full amount owed and would leave nothing to roll over. Use Record Payment / redeem the loan instead.",
        };
      }

      // ── If the loan was already sent to auction, cancel that auction listing ──
      // The rollover reverses the auction decision: the customer is paying interest
      // and continuing the pawn, so the asset must be pulled out of the auction queue.
      if (oldLoan.status === "auction") {
        await Auction.findOneAndUpdate(
          { asset: oldLoan.asset, status: { $in: ["draft", "live"] } },
          { $set: { status: "cancelled" } },
          { session },
        );
      }

      // ── Record the rollover payment on the OLD loan and close it out ──
      const paymentRecord = {
        amount: paymentAmount,
        payment_date: new Date(),
        payment_method,
        status: "paid",
        reference_no: payment_reference || `ROLLOVER-${Date.now()}`,
        received_by: userId || oldLoan.processed_by || oldLoan.created_by,
        notes: payment_notes || "Rollover interest payment",
      };

      oldLoan.payments.push(paymentRecord);
      oldLoan.total_paid = parseFloat((oldLoan.total_paid + paymentAmount).toFixed(2));
      oldLoan.current_balance = 0;
      oldLoan.status = "rolled_over";
      await oldLoan.save({ session, validateModifiedOnly: true });

      // ── Build and save the new loan cycle ──
      const rolloverStart = start_date ? new Date(start_date) : new Date();
      const dueDate = new Date(rolloverStart);
      dueDate.setDate(dueDate.getDate() + period.days);

      const newLoanData = {
        loan_no: this.generateLoanNo(),
        customer_user: oldLoan.customer_user,
        application: oldLoan.application,
        asset: oldLoan.asset,
        collateral_category: oldLoan.collateral_category,
        principal_amount: newPrincipal,
        currency: oldLoan.currency,
        loan_period_type: loanPeriodType,
        interest_rate_percent: period.interest_rate_percent,
        storage_charge_percent: period.storage_charge_percent,
        interest_period_days: period.days,
        penalty_percent: period.penalty_percent,
        grace_days: period.grace_days,
        repayment_type: "once_off",
        start_date: rolloverStart,
        due_date: dueDate,
        status: "active",
        disbursement_date: rolloverStart,
        disbursed_by: userId,
        disbursement_notes: `Rollover — no new funds disbursed; renewed from loan ${oldLoan.loan_no}`,
        approval_status: "approved",
        requires_super_admin_approval: newPrincipal > 500,
        is_rollover: true,
        rollover_of: oldLoan._id,
        root_loan: oldLoan.root_loan || oldLoan._id,
        rollover_generation: (oldLoan.rollover_generation || 0) + 1,
        carried_forward_arrears: carriedForwardArrears,
        rollover_payment_amount: paymentAmount,
        rollover_notes: notes || "",
        created_by: userId,
        processed_by: userId,
        approved_by: userId,
      };

      this.calculateRepaymentBreakdown(newLoanData);
      if (carriedForwardArrears > 0) {
        newLoanData.expected_total_repayable = parseFloat(
          (newLoanData.expected_total_repayable + carriedForwardArrears).toFixed(2),
        );
        newLoanData.current_balance = newLoanData.expected_total_repayable;
        if (newLoanData.repayment_breakdown) {
          newLoanData.repayment_breakdown.carried_forward_arrears = carriedForwardArrears;
        }
      }

      const [newLoan] = await Loan.create([newLoanData], { session });

      oldLoan.rolled_over_to = newLoan._id;
      await oldLoan.save({ session, validateModifiedOnly: true });

      // ── Move the SAME asset onto the new loan; collateral never leaves storage ──
      await Asset.findByIdAndUpdate(
        oldLoan.asset,
        { status: "pawned", active_loan: newLoan._id },
        { session },
      );

      // ── Keep the application's loan pointer on the current, open loan ──
      if (oldLoan.application) {
        await LoanApplication.findByIdAndUpdate(
          oldLoan.application,
          { $set: { loan_id: newLoan._id, loan_created: true, status: "loan_created" } },
          { session },
        );
      }

      await session.commitTransaction();

      const populatedOldLoan = await Loan.findById(oldLoan._id).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status asset_images" },
      ]);
      const populatedNewLoan = await Loan.findById(newLoan._id).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title category status asset_images" },
        { path: "application", select: "application_no collateral_category collateral_description collateral_images small_loan_details motor_vehicle_details jewellery_details" },
        { path: "created_by", select: "first_name last_name email roles" },
      ]);

      // ── Notifications (outside the transaction — non-critical) ──
      try {
        const customer = populatedNewLoan.customer_user;
        if (customer && customer._id) {
          const customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Customer";
          const frontendUrl = process.env.FRONTEND_URL || "https://www.rtcapital.co.zw/";
          await NotificationService.createNotification(
            {
              title: "Loan Rolled Over",
              message: `Your loan ${oldLoan.loan_no} has been rolled over into a new loan ${newLoan.loan_no}. New due date: ${dueDate.toDateString()}.`,
              type: "loan_disbursed",
              priority: "high",
              audience: { scope: "user", user_id: customer._id },
              channels: ["in_app", "email", "sms"],
              entity_type: "loan",
              entity_id: newLoan._id,
              action_text: "View Loan Details",
              action_url: `${frontendUrl}/customer/loans/${newLoan._id}`,
              data: {
                old_loan_id: oldLoan._id,
                old_loan_no: oldLoan.loan_no,
                new_loan_id: newLoan._id,
                new_loan_no: newLoan.loan_no,
              },
            },
            userId,
          ).catch((err) => console.error("Rollover customer notification error:", err.message));

          sendLoanRolloverAdminEmail({
            loanNo: oldLoan.loan_no,
            newLoanNo: newLoan.loan_no,
            customerName,
            principalAmount: newLoan.principal_amount,
            paymentAmount,
            carriedForwardArrears,
            loanPeriodType: newLoan.loan_period_type,
            dueDate: newLoan.due_date,
          }).catch((err) => console.error("Rollover admin email error:", err.message));
        }
      } catch (notifyErr) {
        console.error("Rollover notification error (non-fatal):", notifyErr.message);
      }

      return {
        success: true,
        data: { old_loan: populatedOldLoan, new_loan: populatedNewLoan },
        message: `Loan ${oldLoan.loan_no} rolled over into new loan ${newLoan.loan_no}`,
      };
    } catch (error) {
      await session.abortTransaction();
      throw this.handleMongoError(error);
    } finally {
      session.endSession();
    }
  }

  /**
   * Get the full rollover chain for a loan (root loan through every renewal),
   * ordered oldest to newest.
   */
  async getRolloverChain(loanId) {
    try {
      const loan = await Loan.findById(loanId).select("root_loan rollover_of");
      if (!loan) {
        throw { status: 404, message: `Loan with ID ${loanId} not found` };
      }

      let rootId = loan.root_loan || loan._id;

      // Fall back to walking rollover_of for loans that predate the root_loan field
      if (!loan.root_loan && loan.rollover_of) {
        let cursor = await Loan.findById(loan.rollover_of).select("root_loan rollover_of");
        while (cursor) {
          rootId = cursor._id;
          if (!cursor.rollover_of) break;
          cursor = await Loan.findById(cursor.rollover_of).select("root_loan rollover_of");
        }
      }

      const chain = await Loan.find({
        $or: [{ _id: rootId }, { root_loan: rootId }],
      })
        .sort({ rollover_generation: 1 })
        .populate([
          { path: "customer_user", select: "first_name last_name email" },
          { path: "asset", select: "asset_no title status" },
          { path: "processed_by", select: "first_name last_name email" },
          { path: "created_by", select: "first_name last_name email" },
        ]);

      return {
        success: true,
        data: chain,
        message: "Rollover chain retrieved successfully",
      };
    } catch (error) {
      throw this.handleMongoError(error);
    }
  }

  /**
   * Per-loan-processor rollover performance stats.
   */
  async getRolloverPerformanceStats(filters = {}) {
    try {
      const match = { is_rollover: true };
      if (filters.created_from || filters.created_to) {
        match.created_at = {};
        if (filters.created_from) match.created_at.$gte = new Date(filters.created_from);
        if (filters.created_to) match.created_at.$lte = new Date(filters.created_to);
      }

      const stats = await Loan.aggregate([
        { $match: match },
        {
          $group: {
            _id: "$created_by",
            count: { $sum: 1 },
            total_principal: { $sum: "$principal_amount" },
            total_arrears: { $sum: "$carried_forward_arrears" },
          },
        },
        { $sort: { count: -1 } },
      ]);

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
      auction: ["sold", "closed", "rolled_over"],
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
    const { amount, admin_fee_pct, admin_fee_type, notes } = topUpData;
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
      loanNo: loan.loan_no,
    });

    loan.principal_amount = parseFloat((loan.principal_amount + amount).toFixed(2));
    loan.interest_amount = parseFloat((loan.interest_amount + topUpInterest).toFixed(2));
    loan.storage_charge_amount = parseFloat((loan.storage_charge_amount + topUpStorage).toFixed(2));
    loan.expected_total_repayable = parseFloat((loan.expected_total_repayable + balanceIncrease).toFixed(2));
    loan.current_balance = parseFloat((loan.current_balance + balanceIncrease).toFixed(2));
    loan.admin_fee_amount = parseFloat(((loan.admin_fee_amount || 0) + adminFeeAmount).toFixed(2));
    loan.top_ups.push({
      amount,
      interest_amount: topUpInterest,
      storage_charge_amount: topUpStorage,
      admin_fee_pct: feePct,
      admin_fee_amount: adminFeeAmount,
      admin_fee_type: feeType,
      added_at: now,
      added_by: userId,
      notes,
    });
    await loan.save();

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

    let loanPeriodDays = null;
    let numberOfPeriods = 1;

    if (loanData.start_date && loanData.due_date) {
      const startDate = new Date(loanData.start_date);
      const dueDate = new Date(loanData.due_date);
      loanPeriodDays = Math.ceil((dueDate - startDate) / (1000 * 60 * 60 * 24));
      numberOfPeriods = loanPeriodDays / interestPeriodDays;
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
  async adminOverrideLoan(loanId, overrideData, adminUserId) {
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
    } = overrideData || {};

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const loan = await Loan.findById(loanId).session(session);
      if (!loan) throw { status: 404, message: `Loan ${loanId} not found` };

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
          notes:          payment_notes || `Admin override payment — ${admin_notes || ""}`,
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
            notes:      `Admin override: ${admin_notes || "no notes"}`,
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

      const updated = await Loan.findById(loan._id).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset",         select: "asset_no title status" },
        { path: "payments.received_by", select: "first_name last_name email" },
      ]);

      return {
        success: true,
        data:    updated,
        message: `Loan ${loan.loan_no} updated via admin override${new_status ? ` → ${new_status}` : ""}`,
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
