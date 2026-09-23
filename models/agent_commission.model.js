"use strict";

const mongoose = require("mongoose");
const { XERO_BANK_ACCOUNT_KEYS } = require("../configs/xero_bank_accounts");

// One row per commission ACCRUAL EVENT — never a running total. admin_fee commission
// accrues once per fee-collection event (loan creation, or one per top-up); interest
// commission accrues once per repayment (see services/agent_commission_service.js).
// Both partial-unique indexes below exist purely for idempotency: the accrual sites are
// called from fire-and-forget/retry-safe paths, so a duplicate call must be a safe no-op,
// never a duplicate row.
const AgentCommissionSchema = new mongoose.Schema(
  {
    agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    loan_id: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, index: true },
    loan_no: { type: String, trim: true },
    customer_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    commission_type: { type: String, enum: ["admin_fee", "interest"], required: true, index: true },
    source_event: { type: String, enum: ["loan_creation", "top_up", "payment"], required: true },
    top_up_index: { type: Number, default: null }, // set when source_event === "top_up"
    payment_id: { type: mongoose.Schema.Types.ObjectId, default: null }, // Loan.payments[]._id or Payment._id, when source_event === "payment"

    // The RTC revenue this commission is a cut of, and the rate actually applied — both
    // snapshotted at accrual time so a later rate change on the loan never rewrites history.
    basis_amount: { type: Number, required: true, min: 0 },
    commission_pct: { type: Number, required: true, min: 0 },
    commission_amount: { type: Number, required: true, min: 0 },
    rtc_kept_amount: { type: Number, required: true, min: 0 }, // basis_amount - commission_amount

    currency: { type: String, default: "USD" },
    status: { type: String, enum: ["pending", "paid", "cancelled"], default: "pending", index: true },
    accrued_at: { type: Date, default: Date.now },

    // Payout / settlement (set when an RTC admin pays the agent out)
    paid_at: { type: Date, default: null },
    paid_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    payout_batch_id: { type: String, default: null, index: true },
    payout_method: { type: String, enum: ["cash", "bank_transfer", "mobile_money", "cheque", null], default: null },
    payout_bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },
    payout_notes: { type: String, trim: true },
    cancelled_reason: { type: String, default: null },

    // Set once the payout batch this row belongs to has been posted to Xero.
    xero_bank_transaction_id: { type: String, default: null },

    notes: { type: String, trim: true },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

AgentCommissionSchema.index({ agent_id: 1, status: 1 });

// Idempotency: one interest-commission row per (loan, payment).
AgentCommissionSchema.index(
  { loan_id: 1, commission_type: 1, payment_id: 1 },
  { unique: true, partialFilterExpression: { commission_type: "interest", payment_id: { $type: "objectId" } } }
);

// Idempotency: one admin-fee-commission row per (loan, source event / top-up index).
// loan_creation rows have top_up_index: null, so this also guards against a duplicate
// loan-creation accrual (e.g. assignLoan retried).
AgentCommissionSchema.index(
  { loan_id: 1, commission_type: 1, source_event: 1, top_up_index: 1 },
  { unique: true, partialFilterExpression: { commission_type: "admin_fee" } }
);

module.exports = mongoose.model("AgentCommission", AgentCommissionSchema);
