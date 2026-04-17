const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Attachment = require("../models/attachment.model");
const { sendSmsWithMessage } = require("../utils/sms_utils");
const { sendEmail } = require("../utils/emails_util");

class LoanService {
  /**
   * Create a new loan from an approved loan application
   * This creates both the loan and converts collateral to an asset
   */
  async createLoan(loanData, userId) {
    try {
      // Generate loan number if not provided
      if (!loanData.loan_no) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const random = Math.floor(1000 + Math.random() * 9000);
        loanData.loan_no = `LON${year}${month}${random}`;
      }

      // Set created_by if not provided
      if (!loanData.created_by && userId) {
        loanData.created_by = userId;
      }

      // Set initial current_balance to principal_amount if not provided
      if (!loanData.current_balance && loanData.principal_amount) {
        loanData.current_balance = loanData.principal_amount;
      }

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
        );
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
      }

      // Create or associate asset from collateral
      if (loanData.create_asset_from_collateral && loanData.application) {
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

      // Populate necessary fields
      const populatedLoan = await loan.populate([
        {
          path: "customer_user",
          select:
            "first_name last_name email phone national_id_number address profile_pic_url",
        },
        {
          path: "asset",
          select:
            "asset_no title category evaluated_value status storage_location",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category collateral_description status",
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

      // Update application status to indicate loan created
      if (loanData.application) {
        await LoanApplication.findByIdAndUpdate(loanData.application, {
          $set: {
            loan_created: true,
            loan_id: loan._id,
          },
        });
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
   * Create an asset from a loan application's collateral details
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

      // Build asset data based on collateral category
      let assetData = {
        asset_no: assetNo,
        customer_user: application.customer_user._id,
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
        source: "loan_application",
        source_id: application._id,
        storage_location: "pending_assignment",
        condition: "good",
      };

      // Add category-specific details
      if (
        application.collateral_category === "small_loans" &&
        application.small_loan_details
      ) {
        assetData.small_loan_details = {
          type: application.small_loan_details.type,
          model: application.small_loan_details.model,
          serial_no: application.small_loan_details.serial_no,
        };
        assetData.title =
          assetData.title ||
          application.small_loan_details.model ||
          "Small Loan Item";
      } else if (
        application.collateral_category === "motor_vehicle" &&
        application.motor_vehicle_details
      ) {
        assetData.motor_vehicle_details = {
          make: application.motor_vehicle_details.make,
          model: application.motor_vehicle_details.model,
          registration_no: application.motor_vehicle_details.registration_no,
          cc_serial_no: application.motor_vehicle_details.cc_serial_no,
          engine_no: application.motor_vehicle_details.engine_no,
          chassis_no: application.motor_vehicle_details.chassis_no,
          year: application.motor_vehicle_details.year,
        };
        assetData.title = `${application.motor_vehicle_details.make} ${application.motor_vehicle_details.model}`;
      } else if (
        application.collateral_category === "jewellery" &&
        application.jewellery_details
      ) {
        assetData.jewellery_details = {
          type: application.jewellery_details.type,
          description: application.jewellery_details.description,
          weight: application.jewellery_details.weight,
          purity: application.jewellery_details.purity,
          estimated_value: application.jewellery_details.estimated_value,
        };
        assetData.title = `${application.jewellery_details.type || "Jewellery"} - ${application.jewellery_details.purity || ""}`;
      }

      // Add collateral images as asset attachments
      if (
        application.collateral_images &&
        application.collateral_images.length > 0
      ) {
        assetData.images = application.collateral_images;
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
      small_loans: "electronics",
      motor_vehicle: "vehicle",
      jewellery: "jewellery",
    };
    return mapping[collateralCategory] || "other";
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
   * Get loan by ID with full population
   */
  async getLoanById(loanId) {
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
            "asset_no title category evaluated_value declared_value status storage_location attachments images small_loan_details motor_vehicle_details jewellery_details",
        },
        {
          path: "application",
          select:
            "application_no requested_loan_amount collateral_category collateral_description declared_asset_value small_loan_details motor_vehicle_details jewellery_details collateral_images repayment_type installment_count installment_frequency",
        },
        {
          path: "attachments",
          select: "filename url mime_type category signed signed_at",
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
   * Get loans with pagination
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
              select: "first_name last_name email phone",
            },
            {
              path: "asset",
              select: "asset_no title category evaluated_value status",
            },
            {
              path: "application",
              select:
                "application_no requested_loan_amount collateral_category status",
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
            select: "asset_no title category evaluated_value status",
          },
          {
            path: "application",
            select: "application_no requested_loan_amount collateral_category",
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
          select: "first_name last_name email phone",
        },
        {
          path: "asset",
          select: "asset_no title category status",
        },
        {
          path: "application",
          select: "application_no status",
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
  async updateLoanStatus(loanId, status, notes = "", userId) {
    try {
      const validStatuses = [
        "draft",
        "pending_approval",
        "active",
        "overdue",
        "in_grace",
        "auction",
        "sold",
        "redeemed",
        "closed",
        "cancelled",
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

      // Set approval/processing user based on status
      if (status === "active" && !loan.processed_by && userId) {
        updateData.processed_by = userId;
        updateData.disbursed_at = new Date();
      }

      if (status === "active" && !loan.approved_by && userId) {
        updateData.approved_by = userId;
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
      }).populate([
        { path: "customer_user", select: "first_name last_name email phone" },
        { path: "asset", select: "asset_no title status" },
      ]);

      // Update associated asset status
      await this.updateAssetStatusBasedOnLoan(updatedLoan);

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
      await loan.save();

      // Prepare notification content
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
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

      await loan.save();

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
      await loan.save();

      // Remove loan reference from asset
      if (loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          $unset: { active_loan: "" },
          status: "available",
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

      // Calculate penalty if overdue
      let penalty = 0;
      if (now > dueDate && loan.status === "overdue") {
        const overdueDays = Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24));
        penalty =
          loan.current_balance * (loan.penalty_percent / 100) * overdueDays;
      }

      const totalDue =
        loan.current_balance + interestAccrued + storageCharge + penalty;

      return {
        success: true,
        data: {
          principal: loan.principal_amount,
          current_balance: loan.current_balance,
          days_elapsed: daysElapsed,
          total_loan_days: totalLoanDays,
          interest_rate: loan.interest_rate_percent,
          interest_accrued: parseFloat(interestAccrued.toFixed(2)),
          storage_charge_percent: loan.storage_charge_percent,
          storage_charge: parseFloat(storageCharge.toFixed(2)),
          penalty_percent: loan.penalty_percent,
          penalty: parseFloat(penalty.toFixed(2)),
          total_due: parseFloat(totalDue.toFixed(2)),
          due_date: loan.due_date,
          is_overdue: now > dueDate,
          overdue_days:
            now > dueDate
              ? Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24))
              : 0,
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

      if (loan.status !== "active" && loan.status !== "overdue") {
        throw {
          status: 400,
          message: `Cannot process payment for loan with status: ${loan.status}`,
        };
      }

      const { amount, payment_method, notes } = paymentData;

      if (!amount || amount <= 0) {
        throw {
          status: 400,
          message: "Payment amount must be greater than 0",
        };
      }

      // Calculate charges first
      const charges = await this.calculateLoanCharges(loanId);

      // Update loan balance
      const newBalance = Math.max(0, loan.current_balance - amount);

      const updateData = {
        current_balance: newBalance,
        updated_at: new Date(),
        $push: {
          payment_history: {
            amount,
            payment_method,
            notes,
            paid_at: new Date(),
            previous_balance: loan.current_balance,
            new_balance: newBalance,
          },
        },
      };

      // Update status if fully paid
      if (newBalance === 0) {
        updateData.status = "redeemed";
        updateData.closed_at = new Date();
      }

      const updatedLoan = await Loan.findByIdAndUpdate(loanId, updateData, {
        new: true,
      });

      // Update asset status if loan is redeemed
      if (newBalance === 0 && loan.asset) {
        await Asset.findByIdAndUpdate(loan.asset, {
          status: "redeemed",
          $unset: { active_loan: "" },
        });
      }

      return {
        success: true,
        data: {
          loan: updatedLoan,
          payment: {
            amount,
            payment_method,
            previous_balance: loan.current_balance,
            new_balance: newBalance,
            remaining_balance: newBalance,
            fully_paid: newBalance === 0,
          },
        },
        message: `Payment of ${amount} processed successfully`,
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
      pending_approval: ["active", "cancelled"],
      approved: ["active", "cancelled"],
      active: ["overdue", "in_grace", "redeemed", "closed"],
      overdue: ["in_grace", "auction", "redeemed", "closed"],
      in_grace: ["auction", "redeemed", "closed"],
      auction: ["sold", "closed"],
      sold: ["closed"],
      redeemed: ["closed"],
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
      closed: "available",
      cancelled: "available",
    };

    if (assetStatusMap[loan.status] && loan.asset) {
      await Asset.findByIdAndUpdate(loan.asset, {
        status: assetStatusMap[loan.status],
      });
    }
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
