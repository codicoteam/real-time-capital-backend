const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");
const DebtorRecord = require("../models/debtorRecord.model");
const mongoose = require("mongoose");
(async () => {
  ({ v4: uuidv4 } = await import("uuid"));
})();
const emailService = require("../utils/emails_util");
const documentService = require("./document_service");
const { getTemplateInfo } = require("../utils/template_selector");

class LoanApplicationService {
  /**
   * Generate unique application number
   */
  generateApplicationNo() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    return `APP${year}${month}${random}`;
  }

  /**
   * Create a new loan application (draft)
   */
  async createLoanApplication(applicationData, userId) {
    try {
      // Validate required fields first (allow 0 for requested_loan_amount for pawn applications)
      const requiredFields = [
        "full_name",
        "national_id_number",
        "collateral_category",
      ];

      for (const field of requiredFields) {
        if (applicationData[field] === undefined || applicationData[field] === null || applicationData[field] === "") {
          throw new Error(`${field.replace(/_/g, " ")} is required`);
        }
      }

      // Validate requested_loan_amount - must be present (can be 0 for pawn)
      if (applicationData.requested_loan_amount === undefined || applicationData.requested_loan_amount === null) {
        throw new Error("requested_loan_amount is required");
      }

      // Validate collateral category
     const validCategories = [
  "small_loans",
  "motor_vehicle",
  "jewellery",
  "electronics",
  "furniture",
  "land",
  "machinery",
];
      if (!validCategories.includes(applicationData.collateral_category)) {
        throw new Error(
          `Invalid collateral category. Must be one of: ${validCategories.join(", ")}`,
        );
      }

      // ========================================
      // TEMPLATE-SPECIFIC VALIDATION
      // ========================================

      // Determine intent for template selection
      const intent = applicationData.intent || "loan";
      const collateralCategory = applicationData.collateral_category;

      // LOAN REQUEST FORM validation (for intent="loan" or small_loans)
      if (intent === "loan" || collateralCategory === "small_loans") {
        const loanRequiredFields = [
          "gender",
          "date_of_birth",
          "marital_status",
          "contact_details",
          "home_address",
          "employment.employment_type",
          "employment.title",
          "employment.duration",
          "surety_description",
        ];
        
        for (const field of loanRequiredFields) {
          const value = field.split(".").reduce((obj, key) => obj && obj[key], applicationData);
          if (!value) {
            throw new Error(`${field.replace(/_/g, " ")} is required for Loan Request Form`);
          }
        }
      }

      // PAWN CONTRACT MOTOR VEHICLE validation
      if (intent === "pawn" && collateralCategory === "motor_vehicle") {
        // Only require home_address and contact_details - auto-generate the rest
        const pawnMotorVehicleRequiredFields = [
          "home_address",
          "contact_details",
        ];
        
        for (const field of pawnMotorVehicleRequiredFields) {
          if (!applicationData[field]) {
            throw new Error(`${field.replace(/_/g, " ")} is required for Pawn Contract (Motor Vehicle)`);
          }
        }
        
        // Auto-generate amount_in_words if not provided
        if (!applicationData.amount_in_words && applicationData.requested_loan_amount) {
          applicationData.amount_in_words = this._numberToWords(applicationData.requested_loan_amount);
        }
        
        // Auto-generate due_date if not provided (default: 30 days from now)
        if (!applicationData.due_date) {
          const dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 30);
          applicationData.due_date = dueDate.toISOString();
        }
        
      }

      // PAWN CONTRACT ELECTRICALS/JEWELLERY validation
      if (intent === "pawn" && collateralCategory === "jewellery") {
        const pawnElectricalsRequiredFields = [
          "home_address",
          "contact_details",
          "amount_in_words",
          "due_date",
          "item_type",
        ];
        
        for (const field of pawnElectricalsRequiredFields) {
          if (!applicationData[field]) {
            throw new Error(`${field.replace(/_/g, " ")} is required for Pawn Contract (Electricals/Jewellery)`);
          }
        }
      }

      // Generate application number
      const applicationNo = this.generateApplicationNo();

      // Create the loan application
      const loanApplication = new LoanApplication({
        ...applicationData,
        application_no: applicationNo,
        customer_user: userId,
        status: "draft",
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Try with transaction, fall back to simple save if transactions not supported (e.g., standalone MongoDB)
      let session;
      try {
        session = await mongoose.startSession();
        session.startTransaction();
        await loanApplication.save({ session });
        await session.commitTransaction();
        session.endSession();
      } catch (txError) {
        if (session) {
          try {
            await session.abortTransaction();
            session.endSession();
          } catch (e) {}
        }
        // Fallback: save without transaction (for non-replica-set MongoDB)
        if (txError.message.includes("replica set") || txError.message.includes("mongos")) {
          await loanApplication.save();
        } else {
          throw txError;
        }
      }

      // Populate customer info
      await loanApplication.populate(
        "customer_user",
        "first_name last_name email phone",
      );

      // Auto-generate PDF document after successful creation
      let documentGeneration = null;
      try {
        // Template selection based on intent and collateral category
        let templateCode = "LOAN_REQUEST_FORM";

        const collateralCategory = loanApplication.collateral_category;
        const amount = loanApplication.requested_loan_amount;
        
        // Decision logic based on intent field (explicit user intent)
        const applicationIntent = loanApplication.intent || "loan";
        
        if (applicationIntent === "pawn" && collateralCategory === "motor_vehicle") {
          templateCode = "PAWN_CONTRACT_MOTOR_VEHICLE";
        } else if (applicationIntent === "pawn" && collateralCategory === "jewellery") {
          templateCode = "PAWN_CONTRACT_ELECTRICALS";
        } else if (amount <= 1000) {
          templateCode = "small_loans";
        }

        console.log(`=== Document Generation (CREATE Step) ===`);
        console.log(`Application ID: ${loanApplication._id}`);
        console.log(`Intent: ${applicationIntent}`);
        console.log(`Collateral Category: ${collateralCategory}`);
        console.log(`Selected Template: ${templateCode}`);
        
        const templateInfo = getTemplateInfo(templateCode);
        console.log(`Template path: ${templateInfo.path}`);
        console.log(`Generating document...`);
        
        documentGeneration = await documentService.generateDocumentFromTemplate(
          loanApplication._id,
          templateCode
        );
        
        console.log(`Document generated:`, documentGeneration ? "YES" : "NO");
      } catch (docError) {
        console.error("=== Document Generation Error (CREATE) ===");
        console.error("Failed to auto-generate document:", docError.message);
      }

      // Convert to plain object to ensure _id is included
      const responseData = loanApplication.toObject();
      
      return {
        success: true,
        data: responseData,
        document: documentGeneration,
        message: "Loan application draft created successfully",
      };
    } catch (error) {
      console.error("Error creating loan application:", error);
      throw new Error(`Failed to create loan application: ${error.message}`);
    }
  }

  /**
   * Submit a draft loan application
   */
  async submitLoanApplication(applicationId, userId, submitData = {}) {
    try {
      const loanApplication = await LoanApplication.findOne({
        _id: applicationId,
        status: "draft",
      });

      if (!loanApplication) {
        throw new Error("Loan application not found or cannot be submitted");
      }

      // If customer_user is null (from dev bypass mode), associate it with current user
      if (!loanApplication.customer_user) {
        loanApplication.customer_user = userId;
      }

      // Update loan application with submission data
      Object.assign(loanApplication, submitData);

      // Check if all required fields are filled
      // For pawn applications (motor_vehicle, jewellery), employment fields are optional
      const isPawnApplication = ["motor_vehicle", "jewellery"].includes(loanApplication.collateral_category);
      
      const requiredFields = [
        "full_name",
        "national_id_number",
        "collateral_description",
        "declaration_signed_at",
        "declaration_signature_name",
      ];
      
      // Add employment fields only for non-pawn applications
      if (!isPawnApplication) {
        requiredFields.push("date_of_birth", "contact_details", "home_address", "employment.employment_type", "employment.title", "employment.duration");
      }

      for (const field of requiredFields) {
        const value = field
          .split(".")
          .reduce((obj, key) => obj && obj[key], loanApplication);
        if (!value) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Update status to submitted
      loanApplication.status = "submitted";
      loanApplication.submitted_at = new Date();

      // Try with transaction, fall back to simple save if transactions not supported
      let session;
      try {
        session = await mongoose.startSession();
        session.startTransaction();
        await loanApplication.save({ session });
        await session.commitTransaction();
        session.endSession();
      } catch (txError) {
        if (session) {
          try {
            await session.abortTransaction();
            session.endSession();
          } catch (e) {}
        }
        // Fallback: save without transaction
        if (txError.message.includes("replica set") || txError.message.includes("mongos")) {
          await loanApplication.save();
        } else {
          throw txError;
        }
      }

      // Get customer details for email
      await loanApplication.populate(
        "customer_user",
        "first_name last_name email",
      );

      // Auto-generate PDF document after successful submission
      let documentGeneration = null;
      try {
        // Template selection based on collateral category
        let templateCode = "LOAN_REQUEST_FORM"; // default

        const asset = loanApplication.collateral_description?.toLowerCase() || "";
        const amount = loanApplication.requested_loan_amount;
        const hasEmployment = loanApplication.employment?.employment_type;
        const hasSurety = loanApplication.surety_description;
        const hasDeclaration = loanApplication.declaration_signature_name;
        const collateralCategory = loanApplication.collateral_category;
        const hasVehicleDetails = asset.includes("toyota") || asset.includes("regius") || asset.includes("nissan");
        
        // Check if it's a pawn application based on collateral_category (motor_vehicle or jewellery)
        const isPawnCollateral = ["motor_vehicle", "jewellery"].includes(collateralCategory);

        // Decision logic based on intent field (explicit user intent)
        const applicationIntent = loanApplication.intent || "loan";
        
        if (applicationIntent === "pawn" && collateralCategory === "motor_vehicle") {
          templateCode = "PAWN_CONTRACT_MOTOR_VEHICLE";
        } else if (applicationIntent === "pawn" && (collateralCategory === "jewellery" || isPawnCollateral)) {
          templateCode = "PAWN_CONTRACT_ELECTRICALS";
        } else if (hasEmployment && hasSurety && hasDeclaration) {
          templateCode = "LOAN_REQUEST_FORM";
        } else if (amount <= 1000) {
          templateCode = "small_loans";
        }

        console.log(`=== Document Generation Debug ===`);
        console.log(`Application ID: ${applicationId}`);
        console.log(`Collateral Category: ${collateralCategory}`);
        console.log(`Collateral Description: ${loanApplication.collateral_description}`);
        console.log(`Requested Amount: ${amount}`);
        console.log(`Selected Template: ${templateCode}`);
        
        // Pass templateCode to template_selector.js
        const templateInfo = getTemplateInfo(templateCode);
        
        console.log(`Template path: ${templateInfo.path}`);
        console.log(`Generating document...`);
        
        documentGeneration = await documentService.generateDocumentFromTemplate(
          applicationId,
          templateCode
        );
        
        console.log(`Document generated successfully:`, documentGeneration ? "YES" : "NO");
      } catch (docError) {
        console.error("=== Document Generation Error ===");
        console.error("Failed to auto-generate document:", docError.message);
        console.error("Stack trace:", docError.stack);
        // Don't throw - document generation failure shouldn't break the application submission
      }

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
        // Don't throw - email failure shouldn't break the application
      }

      return {
        success: true,
        data: loanApplication,
        message: "Loan application submitted successfully",
        document: documentGeneration, // Include document info in response
      };
    } catch (error) {
      console.error("Error submitting loan application:", error);
      throw new Error(`Failed to submit loan application: ${error.message}`);
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

      // =========================
      // Role-based filtering
      // =========================
      if (userRole === "customer") {
        query.customer_user = userId;
      } else if (userRole === "loan_officer_processor") {
        query.status = { $in: ["submitted", "processing"] };
      }

      // =========================
      // Filters
      // =========================
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

      // =========================
      // Field selection by role
      // =========================
      const selectFields =
        userRole === "call_centre_support"
          ? "application_no full_name status collateral_category requested_loan_amount created_at attachments"
          : "";

      // =========================
      // Query execution
      // =========================
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
          .select(selectFields)
          .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        LoanApplication.countDocuments(query),
      ]);

      // =========================
      // Statistics
      // =========================
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
   * Get a single loan application by ID with role-based access
   */
  async getLoanApplicationById(id, userRole, userId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new Error("Invalid application ID");
      }

      const query = { _id: id };

      // Role-based access control
      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const application = await LoanApplication.findOne(query)
        .populate(
          "customer_user",
          "first_name last_name email phone national_id_number date_of_birth address",
        )
        .populate("debtor_check.checked_by", "first_name last_name email")
        .populate("debtor_check.matched_debtor_records")
        .populate({
          path: "attachments",
          select: "filename mime_type url category signed signed_at",
        })
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

      // Validate status transition
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

        // Check permissions based on status
        if (status === "approved" || status === "rejected") {
          // Only loan_officer_approval or higher can approve/reject
          const canApprove =
            user.roles.includes("loan_officer_approval") ||
            user.roles.includes("super_admin_vendor") ||
            user.roles.includes("management");

          if (!canApprove) {
            throw new Error(
              "You do not have permission to approve/reject applications",
            );
          }
        }

        // Update application
        application.status = status;
        application.updated_at = new Date();

        if (notes) {
          application.internal_notes = application.internal_notes
            ? `${application.internal_notes}\n[${new Date().toISOString()}] ${user.first_name}: ${notes}`
            : `[${new Date().toISOString()}] ${user.first_name}: ${notes}`;
        }

        await application.save({ session });

        // Get customer details for email
        await application.populate(
          "customer_user",
          "first_name last_name email",
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

        // Check if debtor check already performed
        if (application.debtor_check.checked) {
          throw new Error("Debtor check already performed on this application");
        }

        // Search for matching debtor records
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
            account_status: { $nin: ["Paid up", "Sold", "Current"] }, // Exclude good statuses
          }).session(session);
        }

        // Update debtor check information
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

        // Populate matched records
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

      // Role-based access control
      if (userRole === "customer") {
        query.customer_user = userId;
        query.status = "draft"; // Customers can only update drafts
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

      // Update application
      Object.assign(application, updateData);
      application.updated_at = new Date();

      await application.save();

      return {
        success: true,
        data: application,
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

      // Role-based access control
      if (userRole === "customer") {
        query.customer_user = userId;
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found");
      }

      // Check if attachment already added
      if (application.attachments.includes(attachmentId)) {
        throw new Error("Attachment already added to this application");
      }

      // Add attachment
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

      // Role-based access control
      if (userRole === "customer") {
        query.customer_user = userId;
        query.status = "draft"; // Customers can only remove from drafts
      }

      const application = await LoanApplication.findOne(query);

      if (!application) {
        throw new Error("Loan application not found or cannot be modified");
      }

      // Check if attachment exists
      const attachmentIndex = application.attachments.indexOf(attachmentId);
      if (attachmentIndex === -1) {
        throw new Error("Attachment not found in this application");
      }

      // Remove attachment
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

      // Role-based filtering
      if (userRole === "customer") {
        query.customer_user = userId;
      }

      // Overall statistics
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

      // Statistics by collateral category
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

      // Monthly trend (last 6 months)
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

      // Format monthly stats
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

      // Check if user has permission
      const canRequestDocuments =
        user.roles.includes("loan_officer_processor") ||
        user.roles.includes("loan_officer_approval") ||
        user.roles.includes("super_admin_vendor") ||
        user.roles.includes("management");

      if (!canRequestDocuments) {
        throw new Error("You do not have permission to request documents");
      }

      // Send email to customer
      await emailService.sendDocumentRequirementEmail({
        to: application.customer_user.email,
        fullName: application.full_name,
        applicationNo: application.application_no,
        requiredDocuments,
      });

      // Add note to application
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
   * Convert number to words (for amount_in_words field)
   * e.g., 2000 -> "Two Thousand"
   */
  _numberToWords(number) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const scales = ['', 'Thousand', 'Million', 'Billion'];

    if (number === 0) return 'Zero';

    const numStr = number.toString();
    const numLen = numStr.length;
    
    let words = '';
    let segment = 0;
    
    for (let i = numLen; i > 0; i -= 3) {
      const start = Math.max(0, i - 3);
      const part = parseInt(numStr.substring(start, i));
      
      if (part > 0) {
        let partWords = '';
        
        if (part >= 100) {
          partWords += ones[Math.floor(part / 100)] + ' Hundred';
          part = part % 100;
          if (part > 0) partWords += ' ';
        }
        
        if (part >= 20) {
          partWords += tens[Math.floor(part / 10)];
          if (part % 10 > 0) partWords += ' ' + ones[part % 10];
        } else if (part > 0) {
          partWords += ones[part];
        }
        
        if (segment > 0) {
          words = partWords + ' ' + scales[segment] + (words ? ' ' + words : '');
        } else {
          words = partWords + (words ? ' ' + words : '');
        }
      }
      
      segment++;
    }
    
    return words;
  }
}

module.exports = new LoanApplicationService();
