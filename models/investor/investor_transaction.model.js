"use strict";

const mongoose = require("mongoose");
const { XERO_BANK_ACCOUNT_KEYS } = require("../../configs/xero_bank_accounts");

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

    // The real-world date this transaction happened (a deposit made last week, entered
    // today) — distinct from created_at, which is always "when this record was saved" and
    // can't be backdated. Defaults to now for the common case of recording same-day.
    transaction_date: { type: Date, default: Date.now },

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

    // How this transaction actually moved money — investor transactions didn't track
    // this before; needed now to resolve which real Xero bank account it posted to.
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque", null],
      default: null,
    },
    bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },

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

    // Xero BankTransaction this investor transaction was posted as
    xero_bank_transaction_id: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

InvestorTransactionSchema.index({ investor_id: 1, created_at: -1 });
InvestorTransactionSchema.index({ investor_id: 1, transaction_date: -1 });

module.exports = mongoose.model("InvestorTransaction", InvestorTransactionSchema);
