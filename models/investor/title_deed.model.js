"use strict";

const mongoose = require("mongoose");

const DocumentSchema = new mongoose.Schema(
  {
    url:       { type: String, required: true },
    filename:  { type: String, required: true },
    mime_type: { type: String, default: "application/octet-stream" },
    label:     { type: String, trim: true },
    uploaded_at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const TitleDeedSchema = new mongoose.Schema(
  {
    deed_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },

    investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      required: true,
      index: true,
    },

    // Property details
    property_name:        { type: String, required: true, trim: true },
    property_address:     { type: String, trim: true },
    property_description: { type: String, trim: true },
    property_lat:         { type: Number, default: null },
    property_lng:         { type: Number, default: null },

    // Loan financial details
    loan_amount:    { type: Number, required: true, min: 0 },
    interest_rate:  { type: Number, default: 0, min: 0 },  // % per annum
    loan_term_months: { type: Number, default: 0, min: 0 },
    // Investor's cut of the deed's interest — defaults to 100% (the standard title-deed
    // arrangement: the investor holds the deed directly and RTC takes no split). Set lower
    // when a specific deed has a negotiated split with RTC, e.g. 60/40.
    investor_share_pct: { type: Number, default: 100, min: 0, max: 100 },

    // Dates
    start_date: { type: Date },
    end_date:   { type: Date },

    // Status
    status: {
      type: String,
      enum: ["pending", "active", "completed", "defaulted", "cancelled"],
      default: "pending",
    },

    // Borrower info
    borrower_name:      { type: String, trim: true },
    borrower_id_number: { type: String, trim: true },
    borrower_phone:     { type: String, trim: true },

    // Documents / images uploaded to Supabase
    documents: { type: [DocumentSchema], default: [] },

    notes: { type: String, trim: true },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Set when this deed exists purely so a loan that's already tracked as an
    // InvestorLoanAllocation (e.g. a complex court-order/installment-plan loan) also shows
    // up in the Bond & Title Deeds registry for visibility. When set, every financial
    // calculation (ledger, deployed capital, expected income, reports) skips this deed
    // entirely — the money is already accounted for via the linked allocation, so counting
    // both would double the investor's numbers. Only the registry list itself includes it.
    linked_allocation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestorLoanAllocation",
      default: null,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    toJSON: { virtuals: true },
  },
);

module.exports = mongoose.model("TitleDeed", TitleDeedSchema);
