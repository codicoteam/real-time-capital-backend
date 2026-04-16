const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Acknowledgement: tracks which users have read/acted on a notification
 */
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
    action: { type: String, trim: true, default: null },
  },
  { _id: false },
);

/**
 * Audience: defines who receives the notification
 */
const AudienceSchema = new Schema(
  {
    scope: {
      type: String,
      enum: ["all", "user", "users", "roles"],
      required: true,
      default: "all",
      index: true,
    },
    // For scope = "user" (single user)
    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // For scope = "users" (multiple specific users)
    user_ids: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: null,
      index: true,
    },
    // For scope = "roles" (all users with any of these roles)
    roles: {
      type: [String],
      enum: [
        "super_admin_vendor",
        "admin_pawn_limited",
        "call_centre_support",
        "loan_officer_processor",
        "loan_officer_approval",
        "management",
        "customer",
        "agent",
      ],
      default: undefined,
    },
  },
  { _id: false },
);

const NotificationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },

    type: {
      type: String,
      enum: [
        // Loan lifecycle
        "loan_application",
        "loan_approved",
        "loan_rejected",
        "loan_disbursed",
        "repayment_due",
        "repayment_overdue",
        "repayment_received",
        "loan_closed",
        // Collateral lifecycle
        "collateral_received",
        "collateral_verified",
        "collateral_at_risk",
        "collateral_auctioned",
        "collateral_released",
        // Auctions & bidding
        "auction_created",
        "auction_started",
        "auction_ending_soon",
        "auction_closed",
        "auction_won",
        "auction_lost",
        "bid_placed",
        "bid_outbid",
        "bid_winning",
        "bid_won",
        "bid_payment_due",
        "bid_payment_received",
        // Account / compliance
        "account_kyc",
        "account_status",
        "system_notice",
        "security_alert",
        "others"
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

    // Link to related entity (loan, loan application, auction)
    entity_type: {
      type: String,
      enum: ["loan", "loan_application", "auction", null],
      default: null,
      index: true,
    },
    entity_id: {
      type: Schema.Types.ObjectId,
      refPath: "entity_type", // dynamic reference
      default: null,
      index: true,
    },

    // Scheduling & lifecycle
    send_at: { type: Date, default: null, index: true },
    sent_at: { type: Date, default: null },
    expires_at: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sent", "cancelled"],
      default: "draft",
      index: true,
    },
    is_active: { type: Boolean, default: true, index: true },

    // Optional CTA
    action_text: { type: String, trim: true, default: null },
    action_url: { type: String, trim: true, default: null },

    // Arbitrary payload (safe, non‑sensitive)
    data: { type: Schema.Types.Mixed, default: {} },

    // Read receipts
    acknowledgements: { type: [AcknowledgementSchema], default: [] },

    // Audit
    created_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    collection: "notifications",
  },
);

module.exports = mongoose.model("Notification", NotificationSchema);
