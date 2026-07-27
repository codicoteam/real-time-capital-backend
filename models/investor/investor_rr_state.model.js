"use strict";

const mongoose = require("mongoose");

// Singleton document that persists the Smooth Weighted Round-Robin state.
// Each investor has a current_weight that accumulates their committed_capital
// on every assignment cycle and decreases by total_eligible_capital after selection.
const RRWeightEntrySchema = new mongoose.Schema(
  {
    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
    },
    current_weight: { type: Number, default: 0 },
  },
  { _id: false },
);

const InvestorRRStateSchema = new mongoose.Schema(
  {
    weights: { type: [RRWeightEntrySchema], default: [] },
    _singleton: { type: Boolean, default: true, unique: true, select: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("InvestorRRState", InvestorRRStateSchema);
