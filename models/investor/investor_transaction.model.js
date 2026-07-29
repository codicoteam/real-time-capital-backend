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

    // Identifies who recorded this transaction — works for both investor admins and pawn super admins
    actor: {
      type: new mongoose.Schema(
        {
          id: { type: String },
          name: { type: String },
          email: { type: String },
          actor_type: { type: String, enum: ["investor_admin", "pawn_super_admin"] },
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
