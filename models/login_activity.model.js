"use strict";

const mongoose = require("mongoose");

// One row per successful login, across every user population in the system:
// staff (admins, loan processors, management, call centre) and customers all
// live in the User collection; investors are a completely separate collection
// with their own auth. user_type tells you which one user_id points at.
const LoginActivitySchema = new mongoose.Schema(
  {
    user_type: {
      type: String,
      enum: ["user", "investor"],
      required: true,
      index: true,
    },
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    // Snapshot at login time — kept even if the account is later renamed/deleted,
    // so history stays readable.
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    // For user_type "user": the real roles array (a staff member may hold several).
    // For user_type "investor": the investor's `kind` (individual/company/etc).
    roles: { type: [String], default: [] },

    ip: { type: String, default: null },
    user_agent: { type: String, default: null },

    logged_in_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

LoginActivitySchema.index({ logged_in_at: -1 });
LoginActivitySchema.index({ user_id: 1, logged_in_at: -1 });
LoginActivitySchema.index({ roles: 1, logged_in_at: -1 });

module.exports = mongoose.model("LoginActivity", LoginActivitySchema);
