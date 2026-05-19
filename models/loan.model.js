const mongoose = require("mongoose");

// Payment subdocument (records each repayment)
const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    payment_date: { type: Date, default: Date.now },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque"],
      required: true,
    },
    reference_no: { type: String, trim: true },
    received_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },
  },
  { _id: true }
);

const LoanSchema = new mongoose.Schema(
  {
    loan_no: { type: String, unique: true, index: true },

    // References
    customer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoanApplication",
      index: true,
    },
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true,
    },

    // Collateral category (from application)
    collateral_category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
      index: true,
    },

    // Financials
    principal_amount: { type: Number, required: true, min: 0 },
    current_balance: { type: Number, required: true, min: 0 }, // reduces with payments
    currency: { type: String, default: "USD" },

    // Terms snapshot (set at loan creation)
    interest_rate_percent: { type: Number, required: true }, // e.g. 4% per period
    interest_period_days: { type: Number, required: true }, // 30 days for monthly
    storage_charge_percent: { type: Number, required: true },
    penalty_percent: { type: Number, default: 10 }, // late payment penalty %
    grace_days: { type: Number, default: 7 },

    // Repayment structure (mirror from application)
    repayment_type: {
      type: String,
      enum: ["once_off", "installment"],
      required: true,
    },
    installment_count: { type: Number, min: 1 },
    installment_frequency: {
      type: String,
      enum: ["weekly", "biweekly", "monthly", "quarterly"],
    },
    installment_amount: { type: Number, min: 0 },
    expected_total_repayable: { type: Number, min: 0 },

    // Disbursement details (when money is given to customer)
    disbursement_date: { type: Date },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque"],
    },
    disbursement_reference: { type: String, trim: true },
    disbursed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    disbursement_notes: { type: String, trim: true },

    // Dates
    start_date: { type: Date, required: true },
    due_date: { type: Date, required: true, index: true },

    // Repayment tracking
    payments: { type: [PaymentSchema], default: [] },
    total_paid: { type: Number, default: 0, min: 0 },
    next_installment_due_date: { type: Date },
    remaining_installments: { type: Number, min: 0 },

    // Loan status (loan lifecycle)
    status: {
      type: String,
      enum: [
        "draft",
        "pending_approval",
        "approved",
        "active",          // disbursed, being repaid
        "overdue",
        "in_grace",
        "partially_paid",
        "redeemed",        // fully paid → asset returned to customer
        "defaulted",       // failed to repay → asset moved to auction
        "written_off",
        "cancelled",
      ],
      default: "draft",
      index: true,
    },

    // Approval workflow for high‑value loans
    requires_super_admin_approval: { type: Boolean, default: false },
    requested_super_admins: [
      {
        super_admin: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        requested_at: { type: Date, default: Date.now },
      },
    ],
    super_admin_approvals: [
      {
        approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved_at: { type: Date, default: Date.now },
      },
    ],
    approval_status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // Audit / workflow
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    processed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// Indexes
LoanSchema.index({ customer_user: 1, status: 1, due_date: 1 });
LoanSchema.index({ asset: 1, status: 1 });

// Virtual: remaining balance after payments
LoanSchema.virtual("remaining_balance").get(function () {
  return Math.max(0, this.current_balance - this.total_paid);
});

LoanSchema.set("toJSON", { virtuals: true });
LoanSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Loan", LoanSchema);