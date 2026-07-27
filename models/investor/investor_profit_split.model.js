"use strict";

const mongoose = require("mongoose");

// Singleton document — one config record for the whole platform
const LoanTermSplitSchema = new mongoose.Schema(
  {
    borrower_rate: { type: Number, required: true, min: 0, max: 100 },
    investor_share: { type: Number, required: true, min: 0, max: 100 },
    label: { type: String, required: true, trim: true },
    days: { type: Number, required: true },
  },
  { _id: false },
);

const InvestorProfitSplitSchema = new mongoose.Schema(
  {
    two_week: { type: LoanTermSplitSchema, required: true },
    one_month: { type: LoanTermSplitSchema, required: true },
    // Ensures only one config document exists
    _singleton: { type: Boolean, default: true, unique: true, select: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("InvestorProfitSplit", InvestorProfitSplitSchema);
