const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    actor_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actor_role_snapshot: { type: [String], default: [] },

    action: { type: String, required: true, index: true }, // e.g. "loan.approve", "asset.update"
    entity_type: { type: String, required: true, index: true }, // "Loan", "Asset", "User"
    entity_id: { type: mongoose.Schema.Types.ObjectId, index: true },

    // Store minimal diffs / snapshots
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },

    ip: { type: String },
    user_agent: { type: String },
    channel: { type: String, enum: ["web", "mobile", "api", "admin"], default: "api" },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: false } }
);

AuditLogSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 });

module.exports = mongoose.model("AuditLog", AuditLogSchema);
