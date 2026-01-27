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
BidSchema.pre("validate", function(next) {
  const disputeStatus = this.dispute?.status || "none";
  const disputeActive = ["raised", "under_review", "resolved_invalid"].includes(disputeStatus);

  if (disputeActive && ["paid", "refunded"].includes(this.payment_status)) {
    const error = new Error("Cannot set bid as paid/refunded while dispute is active or invalid.");
    return next(error);
  }
  return next();
});

// Add validation for bid amount
BidSchema.pre("save", async function(next) {
  try {
    // Only validate on new bid creation
    if (this.isNew) {
      const Auction = mongoose.model("Auction");
      const auction = await Auction.findById(this.auction);
      
      if (!auction) {
        return next(new Error("Auction not found"));
      }

      // Check if auction is open for bidding
      if (auction.status !== "open") {
        return next(new Error("Auction is not open for bidding"));
      }

      // Check if auction has started
      if (new Date() < auction.starts_at) {
        return next(new Error("Auction has not started yet"));
      }

      // Check if auction has ended
      if (auction.ends_at && new Date() > auction.ends_at) {
        return next(new Error("Auction has ended"));
      }

      // Get current highest bid for this auction
      const Bid = mongoose.model("Bid");
      const highestBid = await Bid.findOne({
        auction: this.auction
      }).sort({ amount: -1 });

      // Validate bid amount
      if (highestBid && this.amount <= highestBid.amount) {
        return next(new Error(`Bid amount must be greater than current highest bid (${highestBid.amount})`));
      }

      // Check if starting bid exists
      if (auction.starting_bid && this.amount < auction.starting_bid) {
        return next(new Error(`Bid amount must be at least ${auction.starting_bid} (starting bid)`));
      }

      // Check if reserve price exists
      if (auction.reserve_price && this.amount < auction.reserve_price) {
        return next(new Error(`Bid amount must be at least ${auction.reserve_price} (reserve price)`));
      }

      // Check minimum increment
      const minIncrement = auction.min_bid_increment || 1;
      if (highestBid && this.amount < highestBid.amount + minIncrement) {
        return next(new Error(`Bid must increase by at least ${minIncrement}`));
      }
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Indexes
BidSchema.index({ auction: 1, amount: -1 });
BidSchema.index({ auction: 1, bidder_user: 1 });
BidSchema.index({ "dispute.status": 1 });
BidSchema.index({ payment_status: 1 });

module.exports = mongoose.model("Bid", BidSchema);