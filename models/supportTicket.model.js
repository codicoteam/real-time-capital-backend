const mongoose = require("mongoose");

const SupportTicketSchema = new mongoose.Schema(
  {
    ticket_no: { type: String, unique: true, index: true },

    created_by_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    customer_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    category: { type: String, trim: true }, // "loan", "payment", "auction", etc
    subject: { type: String, required: true, trim: true },
    description: { type: String },

    status: { type: String, enum: ["open", "in_progress", "resolved", "closed"], default: "open", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },

    assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

SupportTicketSchema.index({ status: 1, created_at: -1 });

module.exports = mongoose.model("SupportTicket", SupportTicketSchema);
