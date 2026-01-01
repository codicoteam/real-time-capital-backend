const mongoose = require("mongoose");

const AuctionSchema = new mongoose.Schema(
  {
    auction_no: { type: String, unique: true, index: true },

    asset: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", required: true, index: true },
    starting_bid_amount: { type: Number, required: true, min: 0 },
    reserve_price: { type: Number, min: 0 },

    auction_type: { type: String, enum: ["online", "in_person"], default: "online" },
    starts_at: { type: Date, required: true },
    ends_at: { type: Date, required: true },

    status: { type: String, enum: ["draft", "live", "closed", "cancelled"], default: "draft", index: true },

    winner_user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    winning_bid_amount: { type: Number, min: 0 },

    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

module.exports = mongoose.model("Auction", AuctionSchema);
