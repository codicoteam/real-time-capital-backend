"use strict";

const mongoose = require("mongoose");

// Singleton document — one connected Xero organisation for the whole platform.
const XeroConnectionSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true },
    tenant_name: { type: String, trim: true },

    // Encrypted (see utils/xero_token_crypto.js) — never stored in plaintext.
    access_token_enc: { type: String, required: true },
    refresh_token_enc: { type: String, required: true },
    id_token_enc: { type: String, default: null },

    expires_at: { type: Date, required: true },
    scopes: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["connected", "disconnected", "error"],
      default: "connected",
    },
    last_error: { type: String, default: null },

    connected_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    connected_at: { type: Date, default: Date.now },
    disconnected_at: { type: Date, default: null },

    // Ensures only one connection document exists at a time
    _singleton: { type: Boolean, default: true, unique: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("XeroConnection", XeroConnectionSchema);
