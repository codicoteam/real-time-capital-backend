const mongoose = require("mongoose");

const AssetValuationSchema = new mongoose.Schema(
  {
    // 🔗 Asset being evaluated
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true,
    },

    // 🔄 Two-stage evaluation (BRS requirement)
    stage: {
      type: String,
      enum: ["market", "final"],
      required: true,
      index: true,
    },

    // 📌 Lifecycle
    status: {
      type: String,
      enum: ["requested", "in_progress", "completed", "rejected"],
      default: "requested",
      index: true,
    },

    // 👤 Who requested the evaluation
    requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    requested_at: {
      type: Date,
      default: Date.now,
    },

    // 👤 Evaluator / officer
    valued_by_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // 📅 Date of assessment (explicitly required by BRS)
    assessment_date: {
      type: Date,
    },

    // 🧮 Valuation method
    method: {
      type: String,
      enum: ["manual", "market_trend", "hybrid"],
      default: "manual",
    },

    // 💰 Market evaluation result
    estimated_market_value: {
      type: Number,
      min: 0,
    },

    // 💵 System-derived loan estimate (30% / 50% rule)
    estimated_loan_value: {
      type: Number,
      min: 0,
    },

    // 🔐 Final evaluation result (required for FINAL stage)
    final_value: {
      type: Number,
      min: 0,
    },

    // 📝 Required comments for final evaluation
    comments: {
      type: String,
      trim: true,
    },

    // 📄 Required in FINAL request (BRS)
    desired_loan_amount: {
      type: Number,
      min: 0,
    },

    // 💱 Currency
    currency: {
      type: String,
      enum: ["USD", "ZWG"],
      default: "USD",
    },

    // 🧠 Credit bureau reference (BRS mentions FCB)
    credit_check: {
      provider: { type: String, trim: true }, // e.g. "FCB"
      reference: { type: String, trim: true },
      score: { type: Number },
      checked_at: { type: Date },
    },

    // 🧾 Attachments (valuation reports, photos, PDFs)
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],

    // 🧩 Meta / audit support
    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  }
);

// 🔍 Indexes for fast access
AssetValuationSchema.index({ asset: 1, stage: 1, status: 1 });
AssetValuationSchema.index({ created_at: -1 });

module.exports = mongoose.model("AssetValuation", AssetValuationSchema);
