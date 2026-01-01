const mongoose = require("mongoose");

const EmploymentSchema = new mongoose.Schema(
  {
    employment_type: { type: String, trim: true },
    title: { type: String, trim: true },
    duration: { type: String, trim: true },
    location: { type: String, trim: true },
    contacts: { type: String, trim: true },
  },
  { _id: false }
);

const LoanApplicationSchema = new mongoose.Schema(
  {
    application_no: { type: String, unique: true, index: true },

    customer_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // PERSONAL DETAILS (from form)
    full_name: { type: String, required: true, trim: true },
    national_id_number: { type: String, required: true, trim: true, index: true },
    gender: { type: String, trim: true },
    date_of_birth: { type: Date },
    marital_status: { type: String, trim: true },

    contact_details: { type: String, trim: true },
    alternative_number: { type: String, trim: true },
    email_address: { type: String, trim: true, lowercase: true },
    home_address: { type: String, trim: true },

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

    // DECLARATION
    declaration_text: { type: String, trim: true },
    declaration_signed_at: { type: Date },
    declaration_signature_name: { type: String, trim: true },

    // Workflow
    status: {
      type: String,
      enum: ["draft", "submitted", "processing", "approved", "rejected", "cancelled"],
      default: "draft",
      index: true,
    },

    // Debtors list checks (to be evaluated during processing)
    debtor_check: {
      checked: { type: Boolean, default: false },
      matched: { type: Boolean, default: false },
      matched_debtor_records: [{ type: mongoose.Schema.Types.ObjectId, ref: "DebtorRecord" }],
      notes: { type: String, trim: true },
      checked_at: { type: Date },
      checked_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },

    // Attachments: ID scans, signed loan request form, etc.
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],

    // Optional internal notes
    internal_notes: { type: String },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

LoanApplicationSchema.index({ customer_user: 1, created_at: -1 });
LoanApplicationSchema.index({ national_id_number: 1, created_at: -1 });

module.exports = mongoose.model("LoanApplication", LoanApplicationSchema);
