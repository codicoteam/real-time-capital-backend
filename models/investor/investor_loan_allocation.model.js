"use strict";

const mongoose = require("mongoose");

// Tracks each loan assigned to a specific investor.
//
// IMPORTANT – index migration note:
//   The old schema had `unique: true` on `loan_id` (a single-field unique index).
//   That index must be dropped before running the updated app if the collection
//   already exists, otherwise MongoDB will reject any manual allocation that
//   reuses the same loan_id for a co-investor:
//
//     db.investorloanallocations.dropIndex("loan_id_1")
//
//   The replacement is a sparse compound unique on {investor_id, loan_no, loan_date}
//   which prevents exact duplicates while allowing ROI + Cranbrook to both hold
//   the same loan (different investor_id) and allowing the same investor to hold
//   two tranches of the same borrower (different loan_date).
const InvestorLoanAllocationSchema = new mongoose.Schema(
  {
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },

    // Optional — may be null for manually-entered standalone loans
    // that have no corresponding record in the pawn system.
    loan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      index: true,
      default: null,
    },

    loan_no: { type: String, trim: true, index: true },

    collateral_category: {
      type: String,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
    },

    // Normalized investor term key (two_week / one_month).
    // No longer required so that standalone loans (not in pawn system) can be
    // seeded without a formal term key.
    loan_period_key: {
      type: String,
      enum: ["two_week", "one_month"],
    },

    principal_amount: { type: Number, required: true, min: 0 },

    // expected_total_repayable - principal_amount
    total_loan_profit: { type: Number, min: 0, default: 0 },
    investor_share_pct: { type: Number, required: true, min: 0, max: 100 },
    investor_profit: { type: Number, min: 0, default: 0 },
    rtc_revenue: { type: Number, min: 0, default: 0 },

    status: {
      type: String,
      enum: ["active", "completed", "defaulted", "cancelled"],
      default: "active",
      index: true,
    },

    completed_at: { type: Date, default: null },
    notes: { type: String, trim: true },

    // ── Manual / CSV-seeded allocation fields ────────────────────────────────

    // true when this investor is a co-investor (secondary funder) on a loan
    // whose primary funder is a different investor.
    // Example: Cranbrook gets 12% co-investor share on every ROI-funded loan.
    is_co_investor: { type: Boolean, default: false },

    // Borrower display name — used when loan_id is null (standalone loan) or when
    // the pawn system record has no customer_user populated.
    borrower_name: { type: String, trim: true },

    // Human-readable collateral description, e.g. "Volvo XC60 - AGX 9697".
    // Fallback when the pawn system asset record is unavailable.
    collateral_description: { type: String, trim: true },

    // Loan disbursement date — mirrors Loan.start_date for standalone loans.
    loan_date: { type: Date },

    // Contractual maturity / due date — mirrors Loan.due_date for standalone loans.
    maturity_date: { type: Date },

    // Loan term in months (e.g. 1 for a 1-month loan, 3 for a 3-month loan).
    loan_term_months: { type: Number, min: 0 },

    // Monthly interest rate charged to the borrower (%).
    // e.g. 25 means 25 % per month.
    monthly_interest_rate: { type: Number, min: 0 },

    // Total interest receivable on the loan as agreed at origination.
    // For standalone loans this equals principal × rate × term; for
    // pawn-system loans it is derived from expected_total_repayable.
    total_interest_receivable: { type: Number, min: 0, default: 0 },

    // Display-status override for standalone or manually-imported loans.
    // When set, the controller uses this value instead of looking up
    // the underlying Loan.status.
    //
    // Mapping to internal status used by the UI:
    //   "Outstanding"  → active
    //   "Paid"         → completed
    //   "Defaulted"    → defaulted
    //   "Auctioned"    → completed
    //   "Court Order"  → defaulted
    loan_status_override: {
      type: String,
      enum: ["Outstanding", "Paid", "Defaulted", "Auctioned", "Court Order", null],
      default: null,
    },

    // Fixed installment plan for a restructured/court-ordered recovery (e.g. a
    // defaulted loan where the borrower is now repaying a settled amount on a
    // schedule). Each installment's actual receipt is recorded separately as an
    // InvestorMonthlyInterest record (via the normal "Record Payment" flow) —
    // this array is the plan itself, so admin/investor views can show what's
    // due, what's paid, and what's still upcoming.
    repayment_schedule: [
      {
        _id: false,
        label: { type: String, trim: true },
        due_date: { type: Date, required: true },
        amount: { type: Number, required: true, min: 0 },
        status: { type: String, enum: ["pending", "paid", "overdue"], default: "pending" },
        paid_date: { type: Date, default: null },
        paid_amount: { type: Number, default: null },
        monthly_interest_id: { type: mongoose.Schema.Types.ObjectId, ref: "InvestorMonthlyInterest", default: null },
      },
    ],
  },
  { timestamps: { createdAt: "allocated_at", updatedAt: "updated_at" } },
);

InvestorLoanAllocationSchema.index({ investor_id: 1, status: 1 });
InvestorLoanAllocationSchema.index({ investor_id: 1, allocated_at: -1 });
InvestorLoanAllocationSchema.index({ status: 1, allocated_at: -1 });

// Sparse compound unique: prevents the same investor from having two identical
// allocations for the same loan_no on the same loan_date, while still allowing
// different investors (ROI + Cranbrook) to hold the same loan.
InvestorLoanAllocationSchema.index(
  { investor_id: 1, loan_no: 1, loan_date: 1 },
  { unique: true, sparse: true, name: "investor_loan_date_unique" },
);

module.exports = mongoose.model("InvestorLoanAllocation", InvestorLoanAllocationSchema);
