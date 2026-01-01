const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema(
  {
    owner_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    // Link to any entity
    entity_type: { type: String, index: true }, // "LoanApplication","Loan","Asset","User","Ticket"
    entity_id: { type: mongoose.Schema.Types.ObjectId, index: true },

    category: {
      type: String,
      enum: [
        "national_id",
        "loan_request_form",
        "pawn_ticket",
        "contract",
        "proof_of_residence",
        "asset_photos",
        "other",
      ],
      default: "other",
      index: true,
    },

    filename: { type: String, required: true },
    mime_type: { type: String, required: true },

    // Choose one storage strategy:
    storage: {
      type: String,
      enum: ["gridfs", "s3", "local", "url"],
      default: "url",
    },
    url: { type: String }, // if storage = url/s3/local
    gridfs_id: { type: mongoose.Schema.Types.ObjectId }, // if storage = gridfs

    signed: { type: Boolean, default: false },
    signed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signed_at: { type: Date },

    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

AttachmentSchema.index({ entity_type: 1, entity_id: 1 });
AttachmentSchema.index({ category: 1, created_at: -1 });

module.exports = mongoose.model("Attachment", AttachmentSchema);
