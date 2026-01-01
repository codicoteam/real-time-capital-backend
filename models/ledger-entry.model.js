const mongoose = require("mongoose");

const LedgerEntrySchema = new mongoose.Schema(
  {
    entry_date: { type: Date, default: Date.now, index: true },

    branch_code: { type: String, trim: true, index: true },

    category: {
      type: String,
      enum: [
        "interest_income",
        "storage_income",
        "penalty_income",
        "loan_disbursement",
        "loan_principal_repayment",
        "asset_sale_revenue",
        "asset_sale_cogs",
        "write_off",
        "adjustment",
        "other",
      ],
      required: true,
      index: true,
    },

    // signed allowed: +income, -expense/outflow
    amount: { type: Number, required: true },

    currency: { type: String, enum: ["USD", "ZWG"], default: "USD" },

    refs: {
      loan_id: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
      payment_id: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" }, // ✅ align with your Payment model
      asset_id: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", index: true },
      inventory_txn_id: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryTransaction" },
    },

    memo: { type: String, trim: true },

    created_by_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    created_at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

LedgerEntrySchema.index({ category: 1, entry_date: -1 });
LedgerEntrySchema.index({ branch_code: 1, entry_date: -1 });

module.exports = mongoose.model("LedgerEntry", LedgerEntrySchema);
