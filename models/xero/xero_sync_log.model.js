"use strict";

const mongoose = require("mongoose");

const XeroSyncLogSchema = new mongoose.Schema(
  {
    source_collection: {
      type: String,
      enum: ["Loan", "Payment", "Expense", "InvestorTransaction", "BidPayment", "Auction"],
      required: true,
      index: true,
    },
    source_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    event_type: {
      type: String,
      enum: [
        "loan_disbursed",
        "loan_repayment",
        "loan_written_off",
        "expense_approved",
        "investor_deposit",
        "investor_capital_withdrawal",
        "investor_profit_withdrawal",
        "investor_drawing",
        "auction_sale",
      ],
      required: true,
      index: true,
    },

    xero_endpoint: {
      type: String,
      enum: ["Contacts", "BankTransactions", "ManualJournals"],
      required: true,
    },
    xero_id: { type: String, default: null },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },

    attempts: { type: Number, default: 0 },
    last_error: { type: String, default: null },
    next_retry_at: { type: Date, default: null, index: true },
    alert_sent: { type: Boolean, default: false },

    // Snapshot of the payload sent (or about to be sent) to Xero — for debugging/reprocessing.
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

XeroSyncLogSchema.index({ status: 1, next_retry_at: 1 });
XeroSyncLogSchema.index({ source_collection: 1, source_id: 1 });

module.exports = mongoose.model("XeroSyncLog", XeroSyncLogSchema);
