const mongoose = require("mongoose");

const EmploymentSchema = new mongoose.Schema(
  {
    employment_type: { type: String, trim: true },
    title: { type: String, trim: true },
    duration: { type: String, trim: true },
    location: { type: String, trim: true },
    contacts: { type: String, trim: true },
  },
  { _id: false },
);

// Next of Kin subdocument
const NextOfKinSchema = new mongoose.Schema(
  {
    full_name: { type: String, trim: true },
    relationship: { type: String, trim: true },
    phone_number: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
  },
  { _id: false },
);

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
    type: { type: String, trim: true }, // e.g., ring, necklace, bracelet
    description: { type: String, trim: true },
    weight: { type: Number }, // in grams or appropriate unit
    purity: { type: String, trim: true }, // e.g., 18k, 22k, platinum
    estimated_value: { type: Number, min: 0 },
  },
  { _id: false },
);

const LoanApplicationSchema = new mongoose.Schema(
  {
    application_no: { type: String, unique: true, index: true },

    customer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // PERSONAL DETAILS (from form)
    full_name: { type: String, required: true, trim: true },
    national_id_number: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    gender: { type: String, trim: true },
    date_of_birth: { type: Date },
    marital_status: { type: String, trim: true },

    contact_details: { type: String, trim: true },
    alternative_number: { type: String, trim: true },
    email_address: { type: String, trim: true, lowercase: true },
    home_address: { type: String, trim: true },

    // Document URLs (direct links to uploaded files)
    national_id_url: { type: String, trim: true },
    passport_url: { type: String, trim: true }, // if user has passport
    proof_of_resident_url: { type: String, trim: true },
    proof_of_employment_url: { type: String, trim: true },

    // NEXT OF KIN
    next_of_kin: { type: NextOfKinSchema, default: {} },

    // EMPLOYMENT DETAILS (from form)
    employment: { type: EmploymentSchema, default: {} },

    // BASIC INFORMATION (from form)
    requested_loan_amount: { type: Number, required: true, min: 0 },
    collateral_category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
      index: true,
    },
    collateral_description: { type: String, trim: true }, // "Collateral" / surety description
    surety_description: { type: String, trim: true },
    declared_asset_value: { type: Number, min: 0 },

    // Collateral-specific details based on category
    small_loan_details: { type: SmallLoanDetailsSchema, default: {} },
    motor_vehicle_details: { type: MotorVehicleDetailsSchema, default: {} },
    jewellery_details: { type: JewelleryDetailsSchema, default: {} },

    // DECLARATION
    declaration_text: { type: String, trim: true },
    declaration_signed_at: { type: Date },
    declaration_signature_name: { type: String, trim: true },

    // Workflow
    status: {
      type: String,
      enum: [
        "draft",
        "submitted",
        "processing",
        "approved",
        "rejected",
        "cancelled",
      ],
      default: "draft",
      index: true,
    },

    // Debtors list checks (to be evaluated during processing)
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

    // Attachments: ID scans, signed loan request form, etc. (references to Attachment documents)
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /**
     * Source of the application – helps reporting and business rules.
     */
    application_source: {
      type: String,
      enum: ["customer", "agent", "processor"],
      required: true,
      default: "customer",
    },

    /**
     * The user who submitted the application (if submission is a distinct action).
     * Useful when creation and submission are separate steps.
     */
    submitted_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    /**
     * The user who performed the final approval or rejection.
     */
    processed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // Optional internal notes
    internal_notes: { type: String },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// Indexes for common queries
LoanApplicationSchema.index({ customer_user: 1, created_at: -1 });
LoanApplicationSchema.index({ national_id_number: 1, created_at: -1 });

module.exports = mongoose.model("LoanApplication", LoanApplicationSchema);
