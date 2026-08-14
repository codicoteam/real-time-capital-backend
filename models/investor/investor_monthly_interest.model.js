"use strict";

const mongoose = require("mongoose");

const InvestorMonthlyInterestSchema = new mongoose.Schema(
  {
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },
    allocation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestorLoanAllocation",
      required: true,
      index: true,
    },
    loan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      index: true,
      default: null,
    },
    loan_no: { type: String, trim: true },

    // e.g. "2026-03" — the month this interest covers
    period_month: { type: String, required: true, trim: true },

    // Total interest the borrower paid this month (from which investor + RTC splits are derived)
    borrower_interest_paid: { type: Number, required: true, min: 0 },

    investor_share_pct: { type: Number, required: true, min: 0, max: 100 },
    investor_amount: { type: Number, required: true, min: 0 },
    rtc_amount: { type: Number, required: true, min: 0 },

    payment_date: { type: Date, default: Date.now },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque"],
      default: "cash",
    },

    // Investor admin (or pawn super admin) who recorded this payment
    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },
    actor: {
      type: new mongoose.Schema(
        {
          id: { type: String },
          name: { type: String },
          email: { type: String },
          actor_type: { type: String, enum: ["investor_admin", "pawn_super_admin", "pawn_staff"] },
        },
        { _id: false },
      ),
      default: null,
    },

    notes: { type: String, trim: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

InvestorMonthlyInterestSchema.index({ investor_id: 1, created_at: -1 });
InvestorMonthlyInterestSchema.index({ allocation_id: 1, period_month: 1 }, {
  unique: true,
  name: "allocation_month_unique",
});

module.exports = mongoose.model("InvestorMonthlyInterest", InvestorMonthlyInterestSchema);
