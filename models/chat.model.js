const mongoose = require("mongoose");

// ── Message schema (embedded in Conversation) ────────────────────────────────
const MessageSchema = new mongoose.Schema(
  {
    sender:      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content:     { type: String, trim: true },          // text body (empty for image-only)
    images_url:  [{ type: String, trim: true }],        // array of image URLs (Cloudinary / Firebase / S3)
    image_names: [{ type: String, trim: true }],        // original filenames, index-matched to images_url
    message_type:{ type: String, enum: ["text", "image", "text_image"], default: "text" },
    read_by:     [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    is_deleted:  { type: Boolean, default: false },
  },
  { timestamps: { createdAt: "sent_at" } },
);

// ── Conversation schema ───────────────────────────────────────────────────────
const ConversationSchema = new mongoose.Schema(
  {
    // Exactly two participants
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],

    // Allowed role pairs (stored for quick validation / display)
    participant_roles: [{ type: String }],

    // Optional link to a loan or application for context
    related_loan:        { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    related_application: { type: mongoose.Schema.Types.ObjectId, ref: "LoanApplication" },

    messages: { type: [MessageSchema], default: [] },

    last_message:   { type: String },
    last_message_at:{ type: Date },
    last_sender:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    is_active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// Unique conversation between two users (order-independent)
ConversationSchema.index({ participants: 1 });
ConversationSchema.index({ last_message_at: -1 });

module.exports = mongoose.model("Conversation", ConversationSchema);
