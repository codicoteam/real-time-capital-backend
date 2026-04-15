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
   * Create a new loan application (draft)
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
      const requiredFields = [
        "full_name",
        "national_id_number",
        "requested_loan_amount",
        "collateral_category",
      ];
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
        "first_name last_name email phone",
      );

      return {
        success: true,
        data: loanApplication,
        message: "Loan application submitted created successfully",
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw new Error(`Failed to create loan application: ${error.message}`);
    }
  }

  /**
   * Submit a draft loan application
   * @param {String} applicationId - The ID of the application
   * @param {Object} user - The user performing the submission (full user object)
   */
  async submitLoanApplication(applicationId, user) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Build query: if user is customer, restrict to their own; if staff, allow any draft
      const query = { _id: applicationId, status: "draft" };
      const isCustomer = user.roles.includes("customer");
      if (isCustomer) {
        query.customer_user = user._id;
      }

      const loanApplication =
        await LoanApplication.findOne(query).session(session);

      if (!loanApplication) {
        throw new Error("Loan application not found or cannot be submitted");
      }

      // Check if all required fields are filled (same as before)
      const requiredFields = [
        "full_name",
        "national_id_number",
        "date_of_birth",
        "contact_details",
        "home_address",
        "employment.employment_type",
        "employment.title",
        "employment.duration",
        "collateral_description",
        "declaration_signed_at",
        "declaration_signature_name",
      ];
      for (const field of requiredFields) {
        const value = field
          .split(".")
          .reduce((obj, key) => obj && obj[key], loanApplication);
        if (!value) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Update status and submission audit
      loanApplication.status = "submitted";
      loanApplication.submitted_by = user._id;
      await loanApplication.save({ session });

      // Get customer details for email
      await loanApplication.populate(
        "customer_user",
        "first_name last_name email",
      );

      await session.commitTransaction();
      session.endSession();

      // Send email notifications
      try {
        // Send to customer
        await emailService.sendLoanApplicationSubmittedEmail({
          to: loanApplication.customer_user.email,
          fullName: loanApplication.full_name,
          applicationNo: loanApplication.application_no,
        });

        // Send to admin team
        await emailService.sendLoanApplicationAdminNotification({
          applicationNo: loanApplication.application_no,
          customerName: loanApplication.full_name,
          requestedAmount: loanApplication.requested_loan_amount,
          collateralCategory: loanApplication.collateral_category,
        });
      } catch (emailError) {
        console.error("Failed to send email notifications:", emailError);
        // Don't throw – email failure shouldn't break the application
      }

      return {
        success: true,
        data: loanApplication,
        message: "Loan application submitted successfully",
      };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Error submitting loan application:", error);
      throw new Error(`Failed to submit loan application: ${error.message}`);
    }
  }

  /**
   * Get loan applications with pagination and filtering
   * Now populates created_by, submitted_by, processed_by
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
        query.$or = [
          { application_no: { $regex: search, $options: "i" } },
          { full_name: { $regex: search, $options: "i" } },
          { national_id_number: { $regex: search, $options: "i" } },
          { email_address: { $regex: search, $options: "i" } },
        ];
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const selectFields =
        userRole === "call_centre_support"
          ? "application_no full_name status collateral_category requested_loan_amount created_at attachments"
          : "";

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate("customer_user", "first_name last_name email phone")
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate({
            path: "attachments",
            select: `
            category filename mime_type storage url
            signed signed_at
            created_at
          `,
          })
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .select(selectFields)
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
   * Get loan applications by agent ID (created_by = agentId and application_source = 'agent')
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
        query.$or = [
          { application_no: { $regex: search, $options: "i" } },
          { full_name: { $regex: search, $options: "i" } },
          { national_id_number: { $regex: search, $options: "i" } },
          { email_address: { $regex: search, $options: "i" } },
        ];
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate("customer_user", "first_name last_name email phone")
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .populate({
            path: "attachments",
            select:
              "category filename mime_type storage url signed signed_at created_at",
          })
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
   * Get loan applications by processor ID (processed_by = processorId)
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
        query.$or = [
          { application_no: { $regex: search, $options: "i" } },
          { full_name: { $regex: search, $options: "i" } },
          { national_id_number: { $regex: search, $options: "i" } },
          { email_address: { $regex: search, $options: "i" } },
        ];
      }

      if (startDate || endDate) {
        query.created_at = {};
        if (startDate) query.created_at.$gte = new Date(startDate);
        if (endDate) query.created_at.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [applications, total] = await Promise.all([
        LoanApplication.find(query)
          .populate("customer_user", "first_name last_name email phone")
          .populate("created_by", "first_name last_name email roles")
          .populate("submitted_by", "first_name last_name email roles")
          .populate("processed_by", "first_name last_name email roles")
          .populate("debtor_check.checked_by", "first_name last_name")
          .populate(
            "admin_notes.created_by",
            "first_name last_name email roles",
          )
          .populate({
            path: "attachments",
            select:
              "category filename mime_type storage url signed signed_at created_at",
          })
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
          "first_name last_name email phone national_id_number date_of_birth address",
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
   * Add admin note to loan application
   * @param {String} id - Application ID
   * @param {String} note - Note content
   * @param {Object} user - The user adding the note (full object)
   */
  async addAdminNote(id, note, user) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      if (!note || note.trim() === "") {
        throw new Error("Note content is required");
      }

      const application = await LoanApplication.findById(id);

      if (!application) {
        throw new Error("Loan application not found");
      }

      const adminNote = {
        note: note.trim(),
        created_by: user._id,
        created_at: new Date(),
      };

      application.admin_notes.push(adminNote);
      await application.save();

      await application.populate(
        "admin_notes.created_by",
        "first_name last_name email roles",
      );

      return {
        success: true,
        data: application.admin_notes,
        message: "Admin note added successfully",
      };
    } catch (error) {
      console.error("Error adding admin note:", error);
      throw new Error(`Failed to add admin note: ${error.message}`);
    }
  }

  /**
   * Get all admin notes for a loan application
   * @param {String} id - Application ID
   */
  async getAdminNotes(id) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const application = await LoanApplication.findById(id)
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
   * Update loan application status (for loan officers)
   * @param {String} id - Application ID
   * @param {String} status - New status
   * @param {Object} user - The user performing the update (full object)
   * @param {String} notes - Optional internal notes
   */
  async updateLoanApplicationStatus(id, status, user, notes = "") {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const validStatuses = ["processing", "approved", "rejected", "cancelled"];
      if (!validStatuses.includes(status)) {
        throw new Error(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const application = await LoanApplication.findById(id).session(session);

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

        await application.save({ session });

        await application.populate(
          "customer_user",
          "first_name last_name email phone",
        );

        await session.commitTransaction();
        session.endSession();

        // Send status update email to customer
        try {
          await emailService.sendLoanApplicationStatusUpdateEmail({
            to: application.customer_user.email,
            fullName: application.full_name,
            applicationNo: application.application_no,
            status,
            notes,
            officerName: `${user.first_name} ${user.last_name}`,
            contactDetails:
              "Please contact our loan department at +263 xxx xxx xxx for any questions.",
          });
        } catch (emailError) {
          console.error("Failed to send status update email:", emailError);
        }

        // If status is approved, also send an SMS notification
        if (status === "approved" && application.customer_user.phone) {
          const smsMessage = `Your loan application (${application.application_no}) has been APPROVED. Please contact our loan department for further steps.`;
          await sendSmsWithMessage(application.customer_user.phone, smsMessage);
        }

        return {
          success: true,
          data: application,
          message: `Loan application status updated to ${status}`,
        };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
      }
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
        const application =
          await LoanApplication.findById(applicationId).session(session);

        if (!application) {
          throw new Error("Loan application not found");
        }

        if (application.debtor_check.checked) {
          throw new Error("Debtor check already performed on this application");
        }

        const searchCriteria = [
          { client_name: { $regex: application.full_name, $options: "i" } },
          { national_id_number: application.national_id_number },
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
   * Update loan application details
   */
  async updateLoanApplication(id, updateData, userRole, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const query = { _id: id };

      if (userRole === "customer") {
        query.customer_user = userId;
        query.status = "draft";
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found or cannot be updated");
      }

      // Remove fields that shouldn't be updated directly
      delete updateData.application_no;
      delete updateData.customer_user;
      delete updateData.status;
      delete updateData.debtor_check;
      delete updateData.attachments;
      delete updateData.internal_notes;
      delete updateData.created_by;
      delete updateData.application_source;
      delete updateData.submitted_by;
      delete updateData.processed_by;
      delete updateData.admin_notes;

      Object.assign(application, updateData);
      application.updated_at = new Date();

      await application.save();

      const updatedApplication = await LoanApplication.findOne(query)
        .populate("customer_user", "first_name last_name email phone")
        .populate("debtor_check.checked_by", "first_name last_name")
        .populate("admin_notes.created_by", "first_name last_name email roles")
        .populate({
          path: "attachments",
          select:
            "category filename mime_type storage url signed signed_at created_at",
        })
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
   * Add attachment to loan application
   */
  async addAttachment(applicationId, attachmentId, userRole, userId) {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(applicationId) ||
        !mongoose.Types.ObjectId.isValid(attachmentId)
      ) {
        throw new Error("Invalid application or attachment ID");
      }

      const query = { _id: applicationId };

      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found");
      }

      if (application.attachments.includes(attachmentId)) {
        throw new Error("Attachment already added to this application");
      }

      application.attachments.push(attachmentId);
      application.updated_at = new Date();

      await application.save();

      return {
        success: true,
        data: application,
        message: "Attachment added to loan application successfully",
      };
    } catch (error) {
      console.error("Error adding attachment:", error);
      throw new Error(`Failed to add attachment: ${error.message}`);
    }
  }

  /**
   * Remove attachment from loan application
   */
  async removeAttachment(applicationId, attachmentId, userRole, userId) {
    try {
      if (
        !mongoose.Types.ObjectId.isValid(applicationId) ||
        !mongoose.Types.ObjectId.isValid(attachmentId)
      ) {
        throw new Error("Invalid application or attachment ID");
      }

      const query = { _id: applicationId };

      if (userRole === "customer") {
        query.customer_user = userId;
        query.status = "draft";
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found or cannot be modified");
      }

      const attachmentIndex = application.attachments.indexOf(attachmentId);
      if (attachmentIndex === -1) {
        throw new Error("Attachment not found in this application");
      }

      application.attachments.splice(attachmentIndex, 1);
      application.updated_at = new Date();

      await application.save();

      return {
        success: true,
        data: application,
        message: "Attachment removed from loan application successfully",
      };
    } catch (error) {
      console.error("Error removing attachment:", error);
      throw new Error(`Failed to remove attachment: ${error.message}`);
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
            draftCount: {
              $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] },
            },
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
            draftCount: 0,
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

      await emailService.sendDocumentRequirementEmail({
        to: application.customer_user.email,
        fullName: application.full_name,
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
}

module.exports = new LoanApplicationService();
