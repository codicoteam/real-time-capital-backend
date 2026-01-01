const mongoose = require("mongoose");

const LoanTermSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, index: true },

    term_no: { type: Number, required: true }, // 1,2,3...
    start_date: { type: Date, required: true },
    due_date: { type: Date, required: true },

    opening_balance: { type: Number, required: true, min: 0 },
    closing_balance: { type: Number, required: true, min: 0 },

    interest_rate_percent: { type: Number, required: true },
    interest_period_days: { type: Number, required: true },

    storage_charge_percent: { type: Number, required: true },

    renewal_type: {
      type: String,
      enum: ["initial", "interest_only_renewal", "partial_principal_renewal", "full_settlement"],
      default: "initial",
    },

    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved_at: { type: Date },

    notes: { type: String },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

LoanTermSchema.index({ loan: 1, term_no: 1 }, { unique: true });

module.exports = mongoose.model("LoanTerm", LoanTermSchema);
