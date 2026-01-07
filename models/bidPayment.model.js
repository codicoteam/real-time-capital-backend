const mongoose = require("mongoose");

const BidPaymentSchema = new mongoose.Schema(
  {
    bid: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bid",
      required: true,
      index: true,
    },
    auction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Auction",
      index: true,
    },
    payer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },

    status: {
      type: String,
      enum: [
        "initiated",
        "pending",
        "success",
        "failed",
        "refunded",
        "cancelled",
      ],
      default: "initiated",
      index: true,
    },

    method: {
      type: String,
      enum: [
        "cash",
        "bank",
        "ecocash",
        "onemoney",
        "telecash",
        "card",
        "paynow",
      ],
      trim: true,
    },
    provider: { type: String, trim: true }, // e.g. paynow, ecocash, etc (optional)
    provider_txn_id: { type: String, trim: true, index: true, sparse: true },
    poll_url: { type: String, trim: true, default: null },

    // Mobile payment specific fields
    payer_phone: { type: String, trim: true }, // For mobile payments
    redirect_url: { type: String, trim: true }, // For PayNow redirects

    receipt_no: { type: String, trim: true, index: true, sparse: true },
    notes: { type: String, trim: true },

    paid_at: { type: Date },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// ✅ If bid is disputed (active/invalid), block payment "success"
BidPaymentSchema.pre("validate", async function (next) {
  try {
    if (this.status !== "success") return next();

    const Bid = mongoose.model("Bid");
    const bid = await Bid.findById(this.bid).select("dispute.status").lean();

    if (!bid) return next(new Error("Bid not found for payment."));

    const ds = bid?.dispute?.status || "none";
    const disputeActive = [
      "raised",
      "under_review",
      "resolved_invalid",
    ].includes(ds);

    if (disputeActive) {
      return next(
        new Error(
          "Cannot mark payment success while bid dispute is active/invalid."
        )
      );
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

// Index for mobile payments
BidPaymentSchema.index({ method: 1, payer_phone: 1 });
BidPaymentSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model("BidPayment", BidPaymentSchema);
