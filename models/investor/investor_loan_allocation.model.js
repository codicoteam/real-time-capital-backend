"use strict";

const mongoose = require("mongoose");

// Tracks each loan assigned to a specific investor via the round-robin algorithm.
// One allocation per loan — capital is never pooled across investors.
const InvestorLoanAllocationSchema = new mongoose.Schema(
  {
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },
    loan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Loan",
      required: true,
      unique: true,
      index: true,
    },
    loan_no: { type: String, trim: true },
    collateral_category: {
      type: String,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
    },
    // Normalized investor term key (two_week / one_month)
    loan_period_key: {
      type: String,
      enum: ["two_week", "one_month"],
      required: true,
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
  },
  { timestamps: { createdAt: "allocated_at", updatedAt: "updated_at" } },
);

InvestorLoanAllocationSchema.index({ investor_id: 1, status: 1 });
InvestorLoanAllocationSchema.index({ investor_id: 1, allocated_at: -1 });
InvestorLoanAllocationSchema.index({ status: 1, allocated_at: -1 });

module.exports = mongoose.model("InvestorLoanAllocation", InvestorLoanAllocationSchema);
