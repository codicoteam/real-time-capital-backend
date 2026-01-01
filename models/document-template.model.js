const mongoose = require("mongoose");

const DocumentTemplateSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      enum: ["LOAN_REQUEST_FORM", "PAWN_CONTRACT_MOTOR_VEHICLE", "PAWN_CONTRACT_OTHER_MOVABLES"],
      required: true,
      unique: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    version: { type: String, default: "v1", trim: true },

    file_url: { type: String, required: true, trim: true }, // docx/pdf stored
    is_active: { type: Boolean, default: true, index: true },

    created_by_user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.model("DocumentTemplate", DocumentTemplateSchema);
