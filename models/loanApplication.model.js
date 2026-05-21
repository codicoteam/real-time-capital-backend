const mongoose = require("mongoose");

// Small loan collateral details
const SmallLoanDetailsSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },
    model: { type: String, trim: true },
    serial_no: { type: String, trim: true },
  },
  { _id: false },
);

// Motor vehicle collateral details
const MotorVehicleDetailsSchema = new mongoose.Schema(
  {
    make: { type: String, trim: true },
    model: { type: String, trim: true },
    registration_no: { type: String, trim: true },
    cc_serial_no: { type: String, trim: true },
    engine_no: { type: String, trim: true },
    chassis_no: { type: String, trim: true },
    year: { type: Number },
  },
  { _id: false },
);

// Jewellery collateral details
const JewelleryDetailsSchema = new mongoose.Schema(
  {
    type: { type: String, trim: true },
    description: { type: String, trim: true },
    weight: { type: Number },
    purity: { type: String, trim: true },
    estimated_value: { type: Number, min: 0 },
  },
  { _id: false },
);

// Status update timeline subdocument
const StatusUpdateSchema = new mongoose.Schema(
  {
    status: { type: String, trim: true },
    note: { type: String, trim: true, default: "" },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    created_at: { type: Date, default: Date.now },
    attachments: [
      {
        url: { type: String },
        filename: { type: String },
      },
    ],
  },
  { _id: true },
);

// Admin notes subdocument
const AdminNoteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true, trim: true },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const LoanApplicationSchema = new mongoose.Schema(
  {
    application_no: { type: String, unique: true, index: true },

    // Reference to the customer – all KYC data is taken from User
    customer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Loan specific fields
    requested_loan_amount: { type: Number, required: true, min: 0 },

    // Interest and total repayment (set by admin/loan officer)
    interest_rate: { type: Number, min: 0 }, // percentage, e.g., 5.5
    interest_amount: { type: Number, min: 0 }, // calculated or entered interest value
    total_repayable_amount: { type: Number, min: 0 }, // principal + interest

    collateral_category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
      index: true,
    },
    collateral_description: { type: String, trim: true },
    surety_description: { type: String, trim: true },
    declared_asset_value: { type: Number, min: 0 },

    // Collateral details (depending on category)
    small_loan_details: { type: SmallLoanDetailsSchema, default: {} },
    motor_vehicle_details: { type: MotorVehicleDetailsSchema, default: {} },
    jewellery_details: { type: JewelleryDetailsSchema, default: {} },

    // Collateral images (array of URLs)
    collateral_images: { type: [String], default: [] },

    // Repayment preferences
    repayment_type: {
      type: String,
      enum: ["once_off", "installment"],
      default: "once_off",
    },
    repayment_days: { type: Number, min: 1 }, // expected days to repay (for once_off or total duration)

    // Installment specific fields (only used if repayment_type = "installment")
    installment_count: { type: Number, min: 1 },
    installment_frequency: {
      type: String,
      enum: ["weekly", "biweekly", "monthly", "quarterly"],
    },
    installment_amount: { type: Number, min: 0 },

    // Declaration (signed by customer)
    declaration_text: { type: String, trim: true },
    declaration_signed_at: { type: Date },
    declaration_signature_name: { type: String, trim: true },

    // Workflow status
    status: {
      type: String,
      enum: [
        "draft", "submitted", "processing",
        "under_review", "pending_approval", "awaiting_approval",
        "admin_review", "in_review",
        "approved", "rejected", "cancelled", "loan_created",
        "disbursed", "declined", "denied",
      ],
      default: "submitted",
      index: true,
    },

    // Set once a loan is created from this application
    loan_created: { type: Boolean, default: false },
    loan_id: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },

    // Debtors list check
    debtor_check: {
      checked: { type: Boolean, default: false },
      matched: { type: Boolean, default: false },
      matched_debtor_records: [
        { type: mongoose.Schema.Types.ObjectId, ref: "DebtorRecord" },
      ],
      notes: { type: String, trim: true },
      checked_at: { type: Date },
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    // Admin notes (for corrections, problems, etc.)
    admin_notes: { type: [AdminNoteSchema], default: [] },

    // Status change timeline
    status_updates: { type: [StatusUpdateSchema], default: [] },

    // Custom terms & conditions for this specific loan
    custom_terms_and_conditions: { type: String, trim: true },
    terms_accepted_at: { type: Date },
    terms_accepted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Internal notes (simple string)
    internal_notes: { type: String, trim: true },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    application_source: {
      type: String,
      enum: ["customer", "agent", "processor"],
      required: true,
      default: "customer",
    },
    submitted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    processed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// Indexes
LoanApplicationSchema.index({ customer_user: 1, created_at: -1 });

module.exports = mongoose.model("LoanApplication", LoanApplicationSchema);
