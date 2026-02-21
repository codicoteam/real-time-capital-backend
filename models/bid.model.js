const mongoose = require("mongoose");

const BidDisputeSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "raised", "under_review", "resolved_valid", "resolved_invalid"],
      default: "none",
      index: true,
    },
    reason: { type: String, trim: true },
    raised_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    raised_at: { type: Date },
    resolved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolved_at: { type: Date },
    resolution_notes: { type: String, trim: true },
  },
  { _id: false }
);

const BidSchema = new mongoose.Schema( 
  {
    auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", required: true, index: true },
    bidder_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    placed_at: { type: Date, default: Date.now, index: true },

    // ✅ dispute tracking
    dispute: { type: BidDisputeSchema, default: () => ({ status: "none" }) },

    // ✅ payment summary (actual payment record is in BidPayment model)
    payment_status: {
      type: String,
      enum: ["unpaid", "pending", "paid", "failed", "refunded", "cancelled"],
      default: "unpaid",
      index: true,
    },
    paid_amount: { type: Number, default: 0, min: 0 },
    paid_at: { type: Date },

    // Optional external payment gateway refs
    payment_reference: { type: String, trim: true, index: true, sparse: true },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// Validate payment status against dispute status



// Indexes
BidSchema.index({ auction: 1, amount: -1 });
BidSchema.index({ auction: 1, bidder_user: 1 });

module.exports = mongoose.model("Bid", BidSchema);
