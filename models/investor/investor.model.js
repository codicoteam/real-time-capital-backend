"use strict";

const mongoose = require("mongoose");

const ProfitShareOverrideSchema = new mongoose.Schema(
  {
    two_week: { type: Number, min: 0, max: 100 },
    one_month: { type: Number, min: 0, max: 100 },
  },
  { _id: false },
);

const InvestorSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["admin", "individual", "company", "company_client", "rtc"],
      required: true,
    },

    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password_hash: { type: String, required: true, select: false },

    avatar_color: { type: String, default: "#10b981", trim: true },

    status: {
      type: String,
      enum: ["active", "pending", "suspended", "deleted"],
      default: "active",
    },

    phone: { type: String, trim: true },
    location: { type: String, trim: true },

    // USD — zero for admin accounts
    committed_capital: { type: Number, default: 0, min: 0 },

    // Set when kind === "company_client"
    parent_company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Negotiated profit-share override agreed at onboarding (or later)
    profit_share_override: {
      type: ProfitShareOverrideSchema,
      default: null,
    },

    // Collateral categories this investor's capital may be deployed into.
    loan_type_preferences: {
      type: [{ type: String, enum: ["small_loans", "motor_vehicle", "jewellery"] }],
      default: ["small_loans", "motor_vehicle", "jewellery"],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one loan type preference is required.",
      },
    },

    // Loan term structures this investor participates in (2-week, monthly, or both).
    loan_term_preferences: {
      type: [{ type: String, enum: ["two_week", "one_month"] }],
      default: ["two_week", "one_month"],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "At least one loan term preference is required.",
      },
    },

    // Admin-only meta
    title: { type: String, trim: true }, // e.g. "Investment Manager"

    notes: { type: String, trim: true },

    added_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Full actor audit — captures both investor admins and pawn super admins who onboarded this investor
    onboarded_by_actor: {
      type: new mongoose.Schema(
        {
          id: { type: String },
          name: { type: String },
          email: { type: String },
          actor_type: { type: String, enum: ["investor_admin", "pawn_super_admin"] },
        },
        { _id: false },
      ),
      default: null,
    },

    // Password reset
    reset_password_otp: { type: String, select: false },
    reset_password_expires_at: { type: Date, select: false },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

InvestorSchema.index({ kind: 1 });
InvestorSchema.index({ status: 1 });
InvestorSchema.index({ parent_company_id: 1 });

module.exports = mongoose.model("Investor", InvestorSchema);
