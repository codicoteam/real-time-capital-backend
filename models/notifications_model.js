// models/notification_model.js
const mongoose = require("mongoose");
const { Schema } = mongoose;
const AcknowledgementSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    read_at: { type: Date, default: null },
    acted_at: { type: Date, default: null }, // e.g., clicked CTA
    action: { type: String, trim: true, default: null }, // optional custom action label
  },
  { _id: false }
);
const AudienceSchema = new Schema(
  {
    scope: {
      type: String,
      enum: ["all", "user", "roles"],
      required: true,
      default: "all",
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // required when scope === "user"
      index: true,
    },
    roles: {
      type: [String],
      enum: [
        "call_centre_support",
        "loan_officer_processor",
        "loan_officer_approval",
        "management",
        "customer",
      ],
      default: undefined, // required non-empty when scope === "roles"
    },
  },
  { _id: false }
);

const NotificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },

    type: {
      type: String,
      enum: [
        // ─── Loan lifecycle ─────────────────────────────
        "loan_application", // loan created / submitted
        "loan_approved", // loan approved
        "loan_rejected", // loan rejected
        "loan_disbursed", // funds released
        "repayment_due", // upcoming repayment reminder
        "repayment_overdue", // missed repayment
        "repayment_received", // payment confirmed
        "loan_closed", // loan fully settled
        // ─── Collateral lifecycle ───────────────────────
        "collateral_received", // item received & logged
        "collateral_verified", // item verified / valued
        "collateral_at_risk", // nearing default / auction risk
        "collateral_auctioned", // collateral moved to auction
        "collateral_released", // returned to customer
        // ─── Auctions & bidding ─────────────────────────
        "auction_created", // auction opened
        "auction_started", // auction is live
        "auction_ending_soon", // auction about to close
        "auction_closed", // auction closed
        "auction_won", // user won auction
        "auction_lost", // user lost auction
        "bid_placed", // bid placed successfully
        "bid_outbid", // user has been outbid
        "bid_winning", // currently highest bid
        "bid_won", // bid won (final)
        "bid_payment_due", // winner must pay
        "bid_payment_received", // auction payment confirmed
        // ─── Account / compliance ───────────────────────
        "account_kyc", // KYC required / approved / rejected
        "account_status", // account suspended / activated
        "system_notice", // system-wide notices
        "security_alert", // suspicious activity / OTP
      ],
      default: "system_notice",
      index: true,
    },

    priority: {
      type: String,
      enum: ["low", "normal", "high", "critical"],
      default: "normal",
      index: true,
    },

    audience: {
      type: AudienceSchema,
      required: true,
      default: () => ({ scope: "all" }),
    },

    channels: {
      type: [String],
      enum: ["in_app", "email", "sms", "push"],
      default: ["in_app"],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },

    // Scheduling & lifecycle
    send_at: { type: Date, default: null, index: true }, // when to start dispatch
    sent_at: { type: Date, default: null },
    expires_at: { type: Date, default: null, index: true }, // optional TTL (see index below)
    status: {
      type: String,
      enum: ["draft", "scheduled", "sent", "cancelled"],
      default: "draft",
      index: true,
    },
    is_active: { type: Boolean, default: true, index: true },

    // Optional CTA / link
    action_text: { type: String, trim: true, default: null },
    action_url: { type: String, trim: true, default: null },

    // Arbitrary payload (safe, non-sensitive)
    data: { type: Schema.Types.Mixed, default: {} },

    // Read receipts (only stored for users who have interacted/seen it)
    acknowledgements: { type: [AcknowledgementSchema], default: [] },

    // Audit
    created_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    collection: "notifications",
  }
);

/** Helpful compound indexes */
NotificationSchema.index({ "audience.scope": 1, status: 1, send_at: 1 });
NotificationSchema.index({ type: 1, priority: 1, created_at: -1 });
NotificationSchema.index({ is_active: 1, created_at: -1 });

NotificationSchema.index(
  { expires_at: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { expires_at: { $type: "date" } },
  }
);

module.exports = mongoose.model("Notification", NotificationSchema);
