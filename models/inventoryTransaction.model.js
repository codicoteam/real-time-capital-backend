const mongoose = require("mongoose");

const InventoryTransactionSchema = new mongoose.Schema(
  {
    tx_no: { type: String, unique: true, index: true },

    type: {
      type: String,
      enum: [
        "loan_disbursement",
        "repayment",
        "interest_income",
        "storage_income",
        "penalty_income",
        "asset_sale",
        "asset_purchase",
        "expense",
        "adjustment",
      ],
      required: true,
      index: true,
    },

    amount: { type: Number, required: true },
    currency: { type: String, default: "USD" },

    // Optional links
    asset: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", index: true },
    loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },

    // For P&L classification
    account_code: { type: String, trim: true }, // optional GL mapping
    notes: { type: String },

    occurred_at: { type: Date, required: true, index: true },
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

InventoryTransactionSchema.index({ occurred_at: -1, type: 1 });

module.exports = mongoose.model("InventoryTransaction", InventoryTransactionSchema);
