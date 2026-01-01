const mongoose = require("mongoose");
const { Schema } = mongoose;

const PaymentSchema = new Schema(
  {
    /* -------------------- Loan Context -------------------- */
    loan: {
      type: Schema.Types.ObjectId,
      ref: "Loan",
      required: true,
      index: true,
    },

    loan_term: {
      type: Schema.Types.ObjectId,
      ref: "LoanTerm",
      index: true,
    },

    /* -------------------- Payment Amounts -------------------- */
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ["USD", "ZWL"], default: "USD" },

    // Allocation for reducing balance
    interest_component: { type: Number, default: 0, min: 0 },
    principal_component: { type: Number, default: 0, min: 0 },
    storage_component: { type: Number, default: 0, min: 0 },
    penalty_component: { type: Number, default: 0, min: 0 },

    /* -------------------- Payment Provider -------------------- */
    provider: {
      type: String,
      enum: ["paynow", "ecocash", "bank_transfer", "cash"],
      default: "cash",
      index: true,
    },

    method: {
      type: String,
      enum: ["card", "wallet", "bank", "cash"],
      default: "cash",
    },

    payment_status: {
      type: String,
      enum: [
        "paid",
        "pending",
        "failed",
        "cancelled",
        "awaiting_confirmation",
      ],
      default: "pending",
      index: true,
    },

    /* -------------------- Paynow / Provider Fields -------------------- */
    poll_url: { type: String, trim: true, default: null },
    provider_ref: { type: String, trim: true, index: true, sparse: true },
    paynow_invoice_id: { type: String, trim: true, sparse: true },

    captured_at: { type: Date, default: null },

    /* -------------------- Refunds -------------------- */
    refunds: [
      {
        amount: { type: Number, required: true },
        provider_ref: { type: String, trim: true },
        at: { type: Date, default: Date.now },
      },
    ],

    /* -------------------- Audit -------------------- */
    payment_method_label: { type: String, trim: true }, // free-text eg "EcoCash USD"
    paid_at: { type: Date, default: Date.now, index: true },

    received_by: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    receipt_no: { type: String, index: true, sparse: true },
    meta: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    collection: "loan_payments",
  }
);

/* -------------------- Indexes -------------------- */
PaymentSchema.index({ loan: 1, paid_at: -1 });
PaymentSchema.index({ loan: 1, payment_status: 1 });
PaymentSchema.index({ provider: 1, payment_status: 1 });

module.exports = mongoose.model("Payment", PaymentSchema);
