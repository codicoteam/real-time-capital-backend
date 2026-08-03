"use strict";

const mongoose = require("mongoose");

const InvestorTransactionSchema = new mongoose.Schema(
  {
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["deposit", "profit_withdrawal", "capital_withdrawal", "drawing", "expense"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },

    notes: {
      type: String,
      trim: true,
      default: null,
    },

    // Deposit-only: where the money came from (e.g. "Owner Contribution", "Business Income")
    source: {
      type: String,
      trim: true,
      default: null,
    },

    // Expense-only: links this cash-out entry back to the approved pawn Expense record
    expense_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      default: null,
    },
    expense_category: {
      type: String,
      trim: true,
      default: null,
    },

    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Audit trail — committed_capital snapshot before and after this transaction
    committed_capital_before: { type: Number, required: true },
    committed_capital_after: { type: Number, required: true },

    // Identifies who recorded this transaction — works for investor admins, pawn super admins,
    // and pawn staff (e.g. a loan processor approving an expense)
    actor: {
      type: new mongoose.Schema(
        {
          id: { type: String },
          name: { type: String },
          email: { type: String },
          actor_type: { type: String, enum: ["investor_admin", "pawn_super_admin", "pawn_staff"] },
          // Human-readable role label, set when actor_type is "pawn_staff" (e.g. "loan_officer_processor")
          role: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

InvestorTransactionSchema.index({ investor_id: 1, created_at: -1 });

module.exports = mongoose.model("InvestorTransaction", InvestorTransactionSchema);
