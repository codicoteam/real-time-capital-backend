const mongoose = require("mongoose");

const SignedDocumentSchema = new mongoose.Schema(
  {
    template_id: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate", index: true },
    template_code_snapshot: { type: String, trim: true }, // optional snapshot

    applicant_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    loan_application_id: { type: mongoose.Schema.Types.ObjectId, ref: "LoanApplication", index: true },
    loan_id: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    asset_id: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", index: true },

    file_url: { type: String, required: true, trim: true },
    mime_type: { type: String, trim: true },

    signed_by_name: { type: String, trim: true },
    signed_by_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signed_at: { type: Date, default: Date.now, index: true },

    witness_name: { type: String, trim: true },
    witness_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    status: { type: String, enum: ["uploaded", "verified", "rejected"], default: "uploaded", index: true },

    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

SignedDocumentSchema.index({ loan_application_id: 1, signed_at: -1 });
SignedDocumentSchema.index({ loan_id: 1, signed_at: -1 });

module.exports = mongoose.model("SignedDocument", SignedDocumentSchema);
