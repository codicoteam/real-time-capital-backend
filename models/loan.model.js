const mongoose = require("mongoose");

const LoanSchema = new mongoose.Schema(
  {
    loan_no: { type: String, unique: true, index: true },

    customer_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "LoanApplication", index: true },

    asset: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", required: true, index: true },

    collateral_category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
      index: true,
    },

    // Principal / balances
    principal_amount: { type: Number, required: true, min: 0 },
    current_balance: { type: Number, required: true, min: 0 }, // reducing balance

    currency: { type: String, default: "USD" },

    // Terms snapshot (set at creation)
    interest_rate_percent: { type: Number, required: true }, // e.g. 4 or 2
    interest_period_days: { type: Number, required: true },  // 30 or 14
    storage_charge_percent: { type: Number, required: true }, // e.g. 21 or 18
    penalty_percent: { type: Number, default: 10 }, // from contracts for late payment
    grace_days: { type: Number, default: 7 }, // grace before auction

    // Dates
    disbursed_at: { type: Date },
    start_date: { type: Date, required: true },
    due_date: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: ["draft", "active", "overdue", "in_grace", "auction", "sold", "redeemed", "closed", "cancelled"],
      default: "draft",
      index: true,
    },

    // Contract/forms
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],

    // Control approvals / workflow
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    processed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

LoanSchema.index({ customer_user: 1, status: 1, due_date: 1 });
LoanSchema.index({ asset: 1, status: 1 });

module.exports = mongoose.model("Loan", LoanSchema);
