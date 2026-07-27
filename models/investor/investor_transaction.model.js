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
      enum: ["deposit", "profit_withdrawal", "capital_withdrawal"],
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

    recorded_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Audit trail — committed_capital snapshot before and after this transaction
    committed_capital_before: { type: Number, required: true },
    committed_capital_after: { type: Number, required: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

InvestorTransactionSchema.index({ investor_id: 1, created_at: -1 });

module.exports = mongoose.model("InvestorTransaction", InvestorTransactionSchema);
