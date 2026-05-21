const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");
const DebtorRecord = require("../models/debtorRecord.model");
const mongoose = require("mongoose");
const emailService = require("../utils/emails_util");
const twilio = require("twilio");
const { sendSmsWithMessage } = require("../utils/sms_utils");

class LoanApplicationService {
  constructor() {
    // Initialize Twilio client if credentials exist
    if (
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
    ) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );
      this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    } else {
      console.warn("Twilio credentials missing – SMS will not be sent.");
    }
  }

  /**
   * Send SMS via Twilio
   */
  async sendSms(to, message) {
    if (!this.twilioClient) {
      console.log("SMS not sent – Twilio not configured");
      return;
    }
    try {
      await this.twilioClient.messages.create({
        body: message,
        from: this.twilioPhoneNumber,
        to,
      });
      console.log(`SMS sent to ${to}`);
    } catch (error) {
      console.error("SMS sending failed:", error);
      // Don't throw – we don't want to break the flow if SMS fails
    }
  }

  /**
   * Get all loan processors
   */
  async getAllLoanProcessors() {
    try {
      const processors = await User.find({
        roles: { $in: ["loan_officer_processor", "loan_officer_approval"] },
        status: "active",
      }).select("_id first_name last_name email phone");
      return processors;
    } catch (error) {
      console.error("Error fetching loan processors:", error);
      return [];
    }
  }

  /**
   * Notify all loan processors about a user with unverified KYC trying to apply
   */
  async notifyProcessorsAboutUnverifiedKyc(user, applicationData) {
    try {
      const processors = await this.getAllLoanProcessors();

      if (processors.length === 0) {
        console.log("No loan processors found to notify");
        return;
      }

      const customerFullName = `${user.first_name} ${user.last_name}`;
      const subject = `KYC VERIFICATION REQUIRED: New loan application from ${customerFullName}`;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #d32f2f;">⚠️ KYC Verification Required</h2>
          <p>A customer has attempted to submit a loan application but their KYC is not yet verified.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #333;">Customer Details:</h3>
            <p><strong>Name:</strong> ${customerFullName}</p>
            <p><strong>Email:</strong> ${user.email || "Not provided"}</p>
            <p><strong>Phone:</strong> ${user.phone || "Not provided"}</p>
            <p><strong>National ID:</strong> ${user.national_id_number || "Not provided"}</p>
            <p><strong>KYC Status:</strong> <span style="color: #d32f2f; font-weight: bold;">${user.kyc_verification_status}</span></p>
            <p><strong>Registered On:</strong> ${new Date(user.created_at).toLocaleDateString()}</p>
          </div>
          
          <div style="background-color: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <h3 style="margin-top: 0; color: #333;">Application Details:</h3>
            <p><strong>Requested Amount:</strong> $${applicationData.requested_loan_amount?.toLocaleString() || "N/A"}</p>
            <p><strong>Collateral Category:</strong> ${applicationData.collateral_category || "N/A"}</p>
            <p><strong>Collateral Description:</strong> ${applicationData.collateral_description || "N/A"}</p>
            <p><strong>Declared Asset Value:</strong> $${applicationData.declared_asset_value?.toLocaleString() || "N/A"}</p>
            <p><strong>Repayment Type:</strong> ${applicationData.repayment_type || "N/A"}</p>
          </div>
          
          <div style="margin-top: 20px;">
            <p><strong>Action Required:</strong></p>
            <p>Please review the customer's KYC documents and verify their profile before they can submit loan applications.</p>
            <p>Once KYC is verified, the customer will be able to complete their loan application.</p>
          </div>
          
          <hr style="margin: 20px 0; border-color: #e0e0e0;">
          <p style="color: #666; font-size: 12px;">This is an automated notification from the Loan Management System.</p>
        </div>
      `;

      // Send email to all processors
      for (const processor of processors) {
        if (processor.email) {
          await emailService.sendEmail({
            to: processor.email,
            subject: subject,
            html: htmlContent,
          });
          console.log(`Notification sent to processor: ${processor.email}`);
        }

        // Send SMS if phone number available
        if (processor.phone) {
          const smsMessage = `KYC Verification Required: ${customerFullName} (${user.phone || user.email}) attempted to apply for a loan. Please verify their KYC in the system.`;
          await this.sendSms(processor.phone, smsMessage);
        }
      }

      return true;
    } catch (error) {
      console.error("Error notifying processors about unverified KYC:", error);
      return false;
    }
  }

  /**
   * Notify customer that their KYC needs to be verified
   */
  async notifyCustomerAboutKycVerification(user) {
    try {
      const customerFullName = `${user.first_name} ${user.last_name}`;

      // Send email to customer
      if (user.email) {
        const emailSubject =
          "KYC Verification Required Before Loan Application";
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #ff9800;">KYC Verification Required</h2>
            <p>Dear ${customerFullName},</p>
            <p>Thank you for your interest in applying for a loan. Before you can submit a loan application, we need to verify your KYC documents.</p>
            
            <div style="background-color: #fff3e0; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <p style="margin: 0;"><strong>Status:</strong> Your KYC verification is currently <span style="color: #ff9800;">${user.kyc_verification_status}</span></p>
            </div>
            
            <p>Our loan processing team has been notified and will review your KYC documents. Once verified, you will be able to submit your loan application.</p>
            
            <p>You will receive an email notification once your KYC is verified.</p>
            
            <p>If you have any questions, please contact our customer support.</p>
            
            <br>
            <p>Best regards,<br>Loan Management Team</p>
            <hr style="margin: 20px 0; border-color: #e0e0e0;">
            <p style="color: #666; font-size: 12px;">This is an automated notification from the Loan Management System.</p>
          </div>
        `;

        await emailService.sendEmail({
          to: user.email,
          subject: emailSubject,
          html: emailHtml,
        });
      }

      // Send SMS if phone available
      if (user.phone) {
        const smsMessage = `Dear ${customerFullName}, your KYC verification status is ${user.kyc_verification_status}. Please complete KYC verification before applying for a loan. Our team has been notified.`;
        await this.sendSms(user.phone, smsMessage);
      }

      return true;
    } catch (error) {
      console.error("Error notifying customer about KYC verification:", error);
      return false;
    }
  }

  /**
   * Notify customer that KYC is verified and they can now apply
   */
  async notifyCustomerKycVerified(user) {
    try {
      const customerFullName = `${user.first_name} ${user.last_name}`;

      if (user.email) {
        const emailSubject =
          "KYC Verification Complete - You Can Now Apply for Loans";
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
            <h2 style="color: #4caf50;">✅ KYC Verification Complete</h2>
            <p>Dear ${customerFullName},</p>
            <p>Great news! Your KYC documents have been successfully verified.</p>
            
            <div style="background-color: #e8f5e9; padding: 15px; border-radius: 8px; margin: 15px 0;">
              <p style="margin: 0;"><strong>Status:</strong> <span style="color: #4caf50; font-weight: bold;">VERIFIED</span></p>
            </div>
            
            <p>You can now submit loan applications through our platform.</p>
            
            <p>To apply for a loan:</p>
            <ul>
              <li>Log into your account</li>
              <li>Navigate to "Apply for Loan"</li>
              <li>Fill in the required information</li>
              <li>Submit your application</li>
            </ul>
            
            <p>If you have any questions, please contact our customer support.</p>
            
            <br>
            <p>Best regards,<br>Loan Management Team</p>
          </div>
        `;

        await emailService.sendEmail({
          to: user.email,
          subject: emailSubject,
          html: emailHtml,
        });
      }

      if (user.phone) {
        const smsMessage = `Dear ${customerFullName}, your KYC has been verified! You can now apply for loans on our platform.`;
        await this.sendSms(user.phone, smsMessage);
      }

      return true;
    } catch (error) {
      console.error("Error notifying customer about KYC verified:", error);
      return false;
    }
  }

  /**
   * Generate unique application number
   */
  generateApplicationNo() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    return `APP${year}${month}${random}`;
  }

  /**
   * Determine the application source based on user roles.
   * Priority: agent > processor > customer
   */
  determineApplicationSource(user) {
    const roles = user.roles || [];
    if (roles.includes("agent")) return "agent";
    if (roles.includes("loan_officer_processor")) return "processor";
    return "customer";
  }

  /**
   * Create a new loan application with KYC verification check
   * @param {Object} applicationData - The application data from request body
   * @param {Object} createdByUser - The user performing the creation (full user object)
   * @param {String} customerUserId - Optional: the ID of the customer (if staff is creating on behalf)
   */
  async createLoanApplication(
    applicationData,
    createdByUser,
    customerUserId = null,
  ) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Validate required fields
      const requiredFields = ["requested_loan_amount", "collateral_category"];
      for (const field of requiredFields) {
        if (!applicationData[field]) {
          throw new Error(`${field.replace("_", " ")} is required`);
        }
      }

      const validCategories = ["small_loans", "motor_vehicle", "jewellery"];
      if (!validCategories.includes(applicationData.collateral_category)) {
        throw new Error(
          `Invalid collateral category. Must be one of: ${validCategories.join(", ")}`,
        );
      }

      // Determine the customer (borrower)
      const finalCustomerUserId = customerUserId || createdByUser._id;

      // Verify customer exists and get their KYC status
      const customer =
        await User.findById(finalCustomerUserId).session(session);
      if (!customer) {
        throw new Error("Customer user not found");
      }

      // Check if customer is a customer role
      if (!customer.roles.includes("customer")) {
        throw new Error(
          "User is not a customer. Only customers can apply for loans.",
        );
      }

      // KYC VERIFICATION CHECK
      const isKycVerified = customer.kyc_verification_status === "verified";

      // If KYC is not verified, do NOT create the loan application
      if (!isKycVerified) {
        // Notify processors about unverified KYC
        await this.notifyProcessorsAboutUnverifiedKyc(
          customer,
          applicationData,
        );

        // Notify customer that KYC needs to be verified
        await this.notifyCustomerAboutKycVerification(customer);

        throw new Error(
          `KYC verification required. Your current status is: ${customer.kyc_verification_status}. Please complete KYC verification before applying for a loan. Our team has been notified.`,
        );
      }

      let loanApplication;
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          const applicationNo = this.generateApplicationNo();

          loanApplication = new LoanApplication({
            ...applicationData,
            application_no: applicationNo,
            customer_user: finalCustomerUserId,
            created_by: createdByUser._id,
            application_source: this.determineApplicationSource(createdByUser),
            status: "submitted",
            created_at: new Date(),
            updated_at: new Date(),
          });

          await loanApplication.save({ session });
          break; // success
        } catch (err) {
          if (err.code === 11000) {
            attempts++;
            if (attempts >= maxAttempts) {
              throw new Error("Failed to generate unique application number");
            }
          } else {
            throw err;
          }
        }
      }

      await session.commitTransaction();
      session.endSession();

      await loanApplication.populate(
        "customer_user",
        "first_name last_name email phone national_id_number date_of_birth address gender marital_status kyc_verification_status",
      );

      return {
        success: true,
        data: loanApplication,
        message: "Loan application submitted successfully",
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw new Error(`Failed to create loan application: ${error.message}`);
    }
  }

  /**
   * Get loan applications with pagination and filtering
   */
  async getLoanApplications(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status = "",
        collateral_category = "",
        search = "",
        customer_user = "",
        startDate = "",
        endDate = "",
        userRole = "customer",
        userId = null,
      } = options;

      const query = {};

      // Role-based filtering
      if (userRole === "customer") {
        query.customer_user = userId;
      } else if (userRole === "loan_officer_processor") {
        query.status = { $in: ["submitted", "processing"] };
      }

      // Additional filters
      if (status) query.status = status;
      if (collateral_category) query.collateral_category = collateral_category;
      if (customer_user) query.customer_user = customer_user;

      if (search) {
        // Search by application number only since customer data is in User model
        query.application_no = { $regex: search, $options: "i" };
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate(
            "customer_user",
            "first_name last_name email phone national_id_number date_of_birth address gender marital_status kyc_verification_status",
          )
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        LoanApplication.countDocuments(query),
      ]);

      const stats = await LoanApplication.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            totalAmount: { $sum: "$requested_loan_amount" },
          },
        },
      ]);

      return {
        success: true,
        data: {
          applications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
          stats,
        },
        message: "Loan applications retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching loan applications:", error);
      throw new Error(`Failed to fetch loan applications: ${error.message}`);
    }
  }

  /**
   * Get loan applications by agent ID
   */
  async getLoanApplicationsByAgentId(agentId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status = "",
        collateral_category = "",
        search = "",
        startDate = "",
        endDate = "",
      } = options;

      const query = {
        created_by: agentId,
        application_source: "agent",
      };

      if (status) query.status = status;
      if (collateral_category) query.collateral_category = collateral_category;

      if (search) {
        query.application_no = { $regex: search, $options: "i" };
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate(
            "customer_user",
            "first_name last_name email phone national_id_number kyc_verification_status",
          )
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        LoanApplication.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          applications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
        message: "Applications retrieved successfully for agent",
      };
    } catch (error) {
      console.error("Error fetching applications by agent ID:", error);
      throw new Error(
        `Failed to fetch applications by agent ID: ${error.message}`,
      );
    }
  }

  /**
   * Get loan applications by processor ID
   */
  async getLoanApplicationsByProcessorId(processorId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "desc",
        status = "",
        collateral_category = "",
        search = "",
        startDate = "",
        endDate = "",
      } = options;

      const query = {
        processed_by: processorId,
      };

      if (status) query.status = status;
      if (collateral_category) query.collateral_category = collateral_category;

      if (search) {
        query.application_no = { $regex: search, $options: "i" };
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate(
            "customer_user",
            "first_name last_name email phone national_id_number kyc_verification_status",
          )
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        LoanApplication.countDocuments(query),
      ]);

      return {
        success: true,
        data: {
          applications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
          },
        },
        message: "Applications retrieved successfully for processor",
      };
    } catch (error) {
      console.error("Error fetching applications by processor ID:", error);
      throw new Error(
        `Failed to fetch applications by processor ID: ${error.message}`,
      );
    }
  }

  /**
   * Get a single loan application by ID with role-based access
   */
  async getLoanApplicationById(id, userRole, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const query = { _id: id };

      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const application = await LoanApplication.findOne(query)
        .populate(
          "customer_user",
          "first_name last_name email phone national_id_number date_of_birth address gender marital_status alternative_phone employment_details next_of_kin kyc_verification_status",
        )
        .populate("created_by", "first_name last_name email roles")
        .populate("submitted_by", "first_name last_name email roles")
        .populate("processed_by", "first_name last_name email roles")
        .populate("admin_notes.created_by", "first_name last_name email roles")
        .lean();

      if (!application) {
        throw new Error("Loan application not found");
      }

      return {
        success: true,
        data: application,
        message: "Loan application retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching loan application:", error);
      throw new Error(`Failed to fetch loan application: ${error.message}`);
    }
  }

  /**
   * Update loan application status (for loan officers)
   */
  async updateLoanApplicationStatus(id, status, user, notes = "") {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const validStatuses = [
        "draft", "submitted", "processing",
        "under_review", "pending_approval", "awaiting_approval",
        "admin_review", "in_review",
        "approved", "rejected", "cancelled", "loan_created",
        "disbursed", "declined", "denied",
      ];
      if (!validStatuses.includes(status)) {
        throw new Error(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }

      const session = await mongoose.startSession();
      let application = null;

      try {
        await session.startTransaction();

        application = await LoanApplication.findById(id).session(session);

        if (!application) {
          throw new Error("Loan application not found");
        }

        // Update application
        application.status = status;
        application.updated_at = new Date();

        // Set processed_by only for final decisions
        if (status === "approved" || status === "rejected") {
          application.processed_by = user._id;
        }

        if (notes) {
          application.internal_notes = application.internal_notes
            ? `${application.internal_notes}\n[${new Date().toISOString()}] ${user.first_name}: ${notes}`
            : `[${new Date().toISOString()}] ${user.first_name}: ${notes}`;
        }

        // Append to status timeline
        if (!application.status_updates) application.status_updates = [];
        application.status_updates.push({
          status,
          note: notes || "",
          created_by: user._id,
          created_at: new Date(),
          attachments: [],
        });

        await application.save({ session });

        await application.populate(
          "customer_user",
          "first_name last_name email phone",
        );

        await session.commitTransaction();
      } catch (error) {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        throw error;
      } finally {
        await session.endSession();
      }

      // Send notifications AFTER transaction is complete
      try {
        const customerFullName = `${application.customer_user.first_name} ${application.customer_user.last_name}`;
        await emailService.sendLoanApplicationStatusUpdateEmail({
          to: application.customer_user.email,
          fullName: customerFullName,
          applicationNo: application.application_no,
          status,
          notes,
          officerName: `${user.first_name} ${user.last_name}`,
          contactDetails:
            "Please contact our loan department for any questions.",
        });
      } catch (emailError) {
        console.error("Failed to send status update email:", emailError);
      }

      if (status === "approved" && application.customer_user.phone) {
        try {
          const smsMessage = `Your loan application (${application.application_no}) has been APPROVED. Please contact our loan department for further steps.`;
          await sendSmsWithMessage(application.customer_user.phone, smsMessage);
        } catch (smsError) {
          console.error("Failed to send SMS notification:", smsError);
        }
      }

      return {
        success: true,
        data: application,
        message: `Loan application status updated to ${status}`,
      };
    } catch (error) {
      console.error("Error updating loan application status:", error);
      throw new Error(
        `Failed to update loan application status: ${error.message}`,
      );
    }
  }

  /**
   * Perform debtor check on loan application
   */
  async performDebtorCheck(applicationId, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        throw new Error("Invalid application ID");
      }

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const application = await LoanApplication.findById(applicationId)
          .populate("customer_user", "first_name last_name national_id_number")
          .session(session);

        if (!application) {
          throw new Error("Loan application not found");
        }

        if (application.debtor_check.checked) {
          throw new Error("Debtor check already performed on this application");
        }

        const customerFullName = `${application.customer_user.first_name} ${application.customer_user.last_name}`;

        const searchCriteria = [
          { client_name: { $regex: customerFullName, $options: "i" } },
          { national_id_number: application.customer_user.national_id_number },
        ].filter((criteria) => {
          const value = Object.values(criteria)[0];
          return value && value !== "";
        });

        let matchedRecords = [];
        if (searchCriteria.length > 0) {
          matchedRecords = await DebtorRecord.find({
            $or: searchCriteria,
            account_status: { $nin: ["Paid up", "Sold", "Current"] },
          }).session(session);
        }

        application.debtor_check = {
          checked: true,
          matched: matchedRecords.length > 0,
          matched_debtor_records: matchedRecords.map((record) => record._id),
          checked_at: new Date(),
          checked_by: user._id,
          notes:
            matchedRecords.length > 0
              ? `Found ${matchedRecords.length} matching debtor record(s)`
              : "No matching debtor records found",
        };

        await application.save({ session });

        await session.commitTransaction();
        session.endSession();

        await application.populate("debtor_check.matched_debtor_records");

        return {
          success: true,
          data: {
            application,
            debtorCheck: application.debtor_check,
            matchedCount: matchedRecords.length,
          },
          message: `Debtor check completed. ${matchedRecords.length} matching record(s) found.`,
        };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
    } catch (error) {
      console.error("Error performing debtor check:", error);
      throw new Error(`Failed to perform debtor check: ${error.message}`);
    }
  }

  /**
   * Update loan application details - INCLUDING COLLATERAL IMAGES
   */
  async updateLoanApplication(id, updateData, userRole, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const query = { _id: id };

      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found or cannot be updated");
      }

      // Check if application can be updated based on status
      const nonEditableStatuses = ["approved", "rejected", "cancelled"];
      if (nonEditableStatuses.includes(application.status)) {
        throw new Error(
          `Cannot update application with status: ${application.status}`,
        );
      }

      // Remove fields that shouldn't be updated directly
      delete updateData.application_no;
      delete updateData.customer_user;
      delete updateData.status;
      delete updateData.debtor_check;
      delete updateData.internal_notes;
      delete updateData.created_by;
      delete updateData.application_source;
      delete updateData.submitted_by;
      delete updateData.processed_by;
      delete updateData.admin_notes;

      // ALLOWED FIELDS - INCLUDING collateral_images
      const allowedFields = [
        "requested_loan_amount",
        "interest_rate",
        "interest_amount",
        "total_repayable_amount",
        "collateral_category",
        "collateral_description",
        "surety_description",
        "declared_asset_value",
        "small_loan_details",
        "motor_vehicle_details",
        "jewellery_details",
        "collateral_images", // ✅ ALLOW collateral_images to be updated
        "repayment_type",
        "repayment_days",
        "installment_count",
        "installment_frequency",
        "installment_amount",
        "declaration_text",
        "declaration_signed_at",
        "declaration_signature_name",
        "custom_terms_and_conditions",
        "terms_accepted_at",
        "terms_accepted_by",
      ];

      // Update allowed fields
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          application[field] = updateData[field];
        }
      }

      application.updated_at = new Date();
      await application.save();

      const updatedApplication = await LoanApplication.findOne(query)
        .populate(
          "customer_user",
          "first_name last_name email phone national_id_number kyc_verification_status",
        )
        .populate("debtor_check.checked_by", "first_name last_name")
        .populate("admin_notes.created_by", "first_name last_name email")
        .lean();

      return {
        success: true,
        data: updatedApplication,
        message: "Loan application updated successfully",
      };
    } catch (error) {
      console.error("Error updating loan application:", error);
      throw new Error(`Failed to update loan application: ${error.message}`);
    }
  }

  /**
   * Add admin note to loan application
   */
  async addAdminNote(applicationId, noteText, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        throw new Error("Invalid application ID");
      }

      if (!noteText || noteText.trim() === "") {
        throw new Error("Note text is required");
      }

      const application = await LoanApplication.findById(applicationId);

      if (!application) {
        throw new Error("Loan application not found");
      }

      const adminNote = {
        note: noteText.trim(),
        created_by: user._id,
        created_at: new Date(),
      };

      application.admin_notes.push(adminNote);
      application.updated_at = new Date();
      await application.save();

      await application.populate(
        "admin_notes.created_by",
        "first_name last_name email roles",
      );

      return {
        success: true,
        data: application.admin_notes[application.admin_notes.length - 1],
        message: "Admin note added successfully",
      };
    } catch (error) {
      console.error("Error adding admin note:", error);
      throw new Error(`Failed to add admin note: ${error.message}`);
    }
  }

  /**
   * Get all admin notes for a loan application
   */
  async getAdminNotes(applicationId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        throw new Error("Invalid application ID");
      }

      const application = await LoanApplication.findById(applicationId)
        .populate("admin_notes.created_by", "first_name last_name email roles")
        .select("admin_notes application_no");

      if (!application) {
        throw new Error("Loan application not found");
      }

      return {
        success: true,
        data: {
          application_no: application.application_no,
          notes: application.admin_notes,
        },
        message: "Admin notes retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching admin notes:", error);
      throw new Error(`Failed to fetch admin notes: ${error.message}`);
    }
  }

  /**
   * Update an admin note
   */
  async updateAdminNote(applicationId, noteId, noteText, user) {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(applicationId) ||
        !mongoose.Types.ObjectId.isValid(noteId)
      ) {
        throw new Error("Invalid application or note ID");
      }

      if (!noteText || noteText.trim() === "") {
        throw new Error("Note text is required");
      }

      const application = await LoanApplication.findById(applicationId);

      if (!application) {
        throw new Error("Loan application not found");
      }

      const noteIndex = application.admin_notes.findIndex(
        (note) => note._id.toString() === noteId,
      );

      if (noteIndex === -1) {
        throw new Error("Admin note not found");
      }

      const isCreator =
        application.admin_notes[noteIndex].created_by.toString() ===
        user._id.toString();
      const isAdmin = user.roles.some((role) =>
        ["super_admin_vendor", "admin_pawn_limited", "management"].includes(
          role,
        ),
      );

      if (!isCreator && !isAdmin) {
        throw new Error("You are not authorized to update this note");
      }

      application.admin_notes[noteIndex].note = noteText.trim();
      application.updated_at = new Date();
      await application.save();

      await application.populate(
        "admin_notes.created_by",
        "first_name last_name email roles",
      );

      return {
        success: true,
        data: application.admin_notes[noteIndex],
        message: "Admin note updated successfully",
      };
    } catch (error) {
      console.error("Error updating admin note:", error);
      throw new Error(`Failed to update admin note: ${error.message}`);
    }
  }

  /**
   * Delete an admin note
   */
  async deleteAdminNote(applicationId, noteId, user) {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(applicationId) ||
        !mongoose.Types.ObjectId.isValid(noteId)
      ) {
        throw new Error("Invalid application or note ID");
      }

      const application = await LoanApplication.findById(applicationId);

      if (!application) {
        throw new Error("Loan application not found");
      }

      const noteIndex = application.admin_notes.findIndex(
        (note) => note._id.toString() === noteId,
      );

      if (noteIndex === -1) {
        throw new Error("Admin note not found");
      }

      const isCreator =
        application.admin_notes[noteIndex].created_by.toString() ===
        user._id.toString();
      const isAdmin = user.roles.some((role) =>
        ["super_admin_vendor", "admin_pawn_limited", "management"].includes(
          role,
        ),
      );

      if (!isCreator && !isAdmin) {
        throw new Error("You are not authorized to delete this note");
      }

      application.admin_notes.splice(noteIndex, 1);
      application.updated_at = new Date();
      await application.save();

      return {
        success: true,
        message: "Admin note deleted successfully",
      };
    } catch (error) {
      console.error("Error deleting admin note:", error);
      throw new Error(`Failed to delete admin note: ${error.message}`);
    }
  }

  /**
   * Get loan application statistics
   */
  async getStatistics(userRole, userId) {
    try {
      const query = {};

      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const overallStats = await LoanApplication.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalApplications: { $sum: 1 },
            totalRequestedAmount: { $sum: "$requested_loan_amount" },
            avgRequestedAmount: { $avg: "$requested_loan_amount" },
            submittedCount: {
              $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] },
            },
            processingCount: {
              $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] },
            },
            approvedCount: {
              $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
            },
            rejectedCount: {
              $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
            },
            cancelledCount: {
              $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
            },
          },
        },
      ]);

      const collateralStats = await LoanApplication.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$collateral_category",
            count: { $sum: 1 },
            totalAmount: { $sum: "$requested_loan_amount" },
            avgAmount: { $avg: "$requested_loan_amount" },
          },
        },
        { $sort: { count: -1 } },
      ]);

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const monthlyStats = await LoanApplication.aggregate([
        {
          $match: {
            ...query,
            created_at: { $gte: sixMonthsAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$created_at" },
              month: { $month: "$created_at" },
            },
            count: { $sum: 1 },
            totalAmount: { $sum: "$requested_loan_amount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]);

      const formattedMonthlyStats = monthlyStats.map((stat) => ({
        month: `${stat._id.year}-${stat._id.month.toString().padStart(2, "0")}`,
        count: stat.count,
        totalAmount: stat.totalAmount,
      }));

      return {
        success: true,
        data: {
          overall: overallStats[0] || {
            totalApplications: 0,
            totalRequestedAmount: 0,
            avgRequestedAmount: 0,
            submittedCount: 0,
            processingCount: 0,
            approvedCount: 0,
            rejectedCount: 0,
            cancelledCount: 0,
          },
          byCollateral: collateralStats,
          monthlyTrend: formattedMonthlyStats,
        },
        message: "Statistics retrieved successfully",
      };
    } catch (error) {
      console.error("Error fetching statistics:", error);
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }
  }

  /**
   * Send document requirement notification
   */
  async sendDocumentRequirement(applicationId, requiredDocuments, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        throw new Error("Invalid application ID");
      }

      const application = await LoanApplication.findById(
        applicationId,
      ).populate("customer_user", "first_name last_name email");

      if (!application) {
        throw new Error("Loan application not found");
      }

      const canRequestDocuments =
        user.roles.includes("loan_officer_processor") ||
        user.roles.includes("loan_officer_approval") ||
        user.roles.includes("super_admin_vendor") ||
        user.roles.includes("management");

      if (!canRequestDocuments) {
        throw new Error("You do not have permission to request documents");
      }

      const customerFullName = `${application.customer_user.first_name} ${application.customer_user.last_name}`;

      await emailService.sendDocumentRequirementEmail({
        to: application.customer_user.email,
        fullName: customerFullName,
        applicationNo: application.application_no,
        requiredDocuments,
      });

      application.internal_notes = application.internal_notes
        ? `${application.internal_notes}\n[${new Date().toISOString()}] ${user.first_name}: Requested additional documents: ${requiredDocuments.join(", ")}`
        : `[${new Date().toISOString()}] ${user.first_name}: Requested additional documents: ${requiredDocuments.join(", ")}`;

      await application.save();

      return {
        success: true,
        message: "Document requirement notification sent successfully",
      };
    } catch (error) {
      console.error("Error sending document requirement:", error);
      throw new Error(`Failed to send document requirement: ${error.message}`);
    }
  }

  /**
   * Delete a loan application permanently (admin/super_admin only)
   * Customers cannot delete their own applications.
   */
  async deleteLoanApplication(id, requestingUser) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const allowedRoles = [
        "super_admin_vendor",
        "admin_pawn_limited",
        "management",
        "loan_officer_processor",
        "loan_officer_approval",
      ];
      const userRoles = requestingUser?.roles || [];
      const isAllowed = userRoles.some((r) => allowedRoles.includes(r));
      if (!isAllowed) {
        throw new Error(
          "Not authorized to delete loan applications. Admin or loan officer access required.",
        );
      }

      const application = await LoanApplication.findById(id);
      if (!application) {
        throw new Error("Loan application not found");
      }

      await LoanApplication.findByIdAndDelete(id);

      return {
        success: true,
        message: `Loan application ${application.application_no || id} deleted successfully`,
      };
    } catch (error) {
      console.error("Error deleting loan application:", error);
      throw new Error(error.message || "Failed to delete loan application");
    }
  }
}

module.exports = new LoanApplicationService();
