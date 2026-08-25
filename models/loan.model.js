const mongoose = require("mongoose");
const { LOAN_PERIOD_TYPES } = require("../configs/loan_periods");

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
    status: {
      type: String,
      enum: ["paid", "pending"],
      default: "pending",
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

    // Staff-selected investor, set at loan CREATION time — Loan Processor/Super Admin
    // choosing who funds this loan instead of the default automatic round-robin
    // assignment. Only meaningful for motor_vehicle/jewellery (small_loans are always
    // RTC's own book — see investor_allocation_service.assignLoan/getEligibleInvestors).
    // Re-validated for eligibility at disbursement time; falls back to normal
    // auto-assignment if the chosen investor is no longer eligible by then.
    preferred_investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Financials
    principal_amount: { type: Number, required: true, min: 0 },
    current_balance: { type: Number, required: true, min: 0 }, // reduces with payments; starts at expected_total_repayable
    currency: { type: String, default: "USD" },

    // Loan period (hardcoded: two_weeks = 2%/18%, one_month = 4%/21%)
    loan_period_type: {
      type: String,
      enum: LOAN_PERIOD_TYPES,
      required: true,
    },

    // Terms snapshot (set at loan creation from loan_period_type)
    interest_rate_percent: { type: Number, required: true },
    interest_period_days: { type: Number, required: true },
    storage_charge_percent: { type: Number, required: true },
    penalty_percent: { type: Number, default: 10 }, // late payment penalty %
    grace_days: { type: Number, default: 7 },

    // Calculated financial breakdown (set at loan creation)
    interest_amount: { type: Number, min: 0, default: 0 },        // interest charged
    storage_charge_amount: { type: Number, min: 0, default: 0 },  // storage fee charged
    expected_total_repayable: { type: Number, min: 0 },           // principal + interest + storage (+ admin fee if deferred)
    repayment_breakdown: { type: mongoose.Schema.Types.Mixed, default: null }, // full calculation detail

    // Admin fee (0-10% of principal_amount) — negotiated by the Loan Processor/Super Admin
    // at loan CREATION time, not at application. This is pure RTC revenue: it never touches
    // an investor's principal_amount or profit split (see investor_allocation_service.assignLoan).
    //   - "upfront":  collected as a separate cash payment at signing. Customer still owes
    //                 back only principal_amount; interest is charged on principal_amount alone.
    //   - "deferred": added on top of what the customer owes. Customer owes back
    //                 principal_amount + admin_fee_amount; interest is charged on that total.
    admin_fee_pct: { type: Number, min: 0, max: 10, default: 0 },
    admin_fee_amount: { type: Number, min: 0, default: 0 },
    admin_fee_type: { type: String, enum: ["upfront", "deferred", null], default: null },
    // Only meaningful when admin_fee_type is "upfront" — has the staff member collecting
    // the loan actually taken the separate cash fee at signing?
    admin_fee_collected: { type: Boolean, default: false },
    admin_fee_collected_at: { type: Date, default: null },
    admin_fee_payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque", null],
      default: null,
    },
    admin_fee_notes: { type: String, trim: true },

    // All loans are once-off payments
    repayment_type: {
      type: String,
      enum: ["once_off"],
      default: "once_off",
      required: true,
    },

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
        "auction",         // grace period expired → asset listed for auction
        "redeemed",        // fully paid → asset returned to customer
        "defaulted",       // failed to repay → asset moved to auction
        "written_off",
        "cancelled",
        "rolled_over",     // closed via rollover → balance moved to a new loan on the same asset
      ],
      default: "draft",
      index: true,
    },

    // Rollover chain — set when this loan was closed by rolling it into a new loan,
    // or when this loan itself was created by rolling over a previous one.
    is_rollover: { type: Boolean, default: false },
    rollover_of: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    rolled_over_to: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    rollover_generation: { type: Number, default: 0 },
    root_loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    carried_forward_arrears: { type: Number, default: 0, min: 0 },
    rollover_payment_amount: { type: Number, min: 0 },
    rollover_notes: { type: String, trim: true },

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

// Virtual: remaining balance after payments (current_balance already reduces with each payment)
LoanSchema.virtual("remaining_balance").get(function () {
  return this.current_balance;
});

LoanSchema.set("toJSON", { virtuals: true });
LoanSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Loan", LoanSchema);