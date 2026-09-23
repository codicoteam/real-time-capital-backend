const mongoose = require("mongoose");
const { LOAN_PERIOD_TYPES } = require("../configs/loan_periods");
const { XERO_BANK_ACCOUNT_KEYS } = require("../configs/xero_bank_accounts");

// Payment subdocument (records each repayment)
const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    payment_date: { type: Date, default: Date.now },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque"],
      required: true,
    },
    status: {
      type: String,
      enum: ["paid", "pending"],
      default: "pending",
    },
    reference_no: { type: String, trim: true },
    received_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },

    // Which real Xero bank account this repayment was recorded against — staff-picked
    // (with a role-based default) for manually-recorded payments; unset for anything
    // not yet passing one through, in which case Xero sync falls back to inferring
    // from payment_method. See configs/xero_bank_accounts.js for the 5 valid keys.
    bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },

    // Xero BankTransaction this embedded (legacy-path) repayment was posted as
    xero_bank_transaction_id: { type: String, default: null },
  },
  { _id: true }
);

const LoanSchema = new mongoose.Schema(
  {
    loan_no: { type: String, unique: true, index: true },

    // References
    customer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LoanApplication",
      index: true,
    },
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset",
      required: true,
      index: true,
    },

    // Collateral category (from application)
    collateral_category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"],
      index: true,
    },

    // Staff-selected investor, set at loan CREATION time — Loan Processor/Super Admin
    // choosing who funds this loan instead of the default automatic round-robin
    // assignment. Only meaningful for motor_vehicle/jewellery (small_loans are always
    // RTC's own book — see investor_allocation_service.assignLoan/getEligibleInvestors).
    // Re-validated for eligibility at disbursement time; falls back to normal
    // auto-assignment if the chosen investor is no longer eligible by then.
    preferred_investor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Investor",
      default: null,
    },

    // Financials
    principal_amount: { type: Number, required: true, min: 0 },
    current_balance: { type: Number, required: true, min: 0 }, // reduces with payments; starts at expected_total_repayable
    currency: { type: String, default: "USD" },

    // Loan period (hardcoded: two_weeks = 2%/18%, one_month = 4%/21%)
    loan_period_type: {
      type: String,
      enum: LOAN_PERIOD_TYPES,
      required: true,
    },

    // Terms snapshot (set at loan creation from loan_period_type)
    interest_rate_percent: { type: Number, required: true },
    interest_period_days: { type: Number, required: true },
    storage_charge_percent: { type: Number, required: true },
    penalty_percent: { type: Number, default: 10 }, // late payment penalty %
    grace_days: { type: Number, default: 7 },

    // Negotiated storage rate — a Loan Processor/Admin can agree a different storage
    // charge than the standard one for this loan_period_type at creation (or correct it
    // later while the loan is still editable). Interest always stays on the standard
    // schedule. Derived, not client-trusted: loan_service sets is_negotiated by comparing
    // storage_charge_percent against LOAN_PERIODS' standard rate at save time, so it can
    // never drift out of sync with the actual rate on record. standard_storage_charge_percent
    // is kept purely for display/audit — "what it would have been" — and never feeds into
    // any calculation itself.
    is_negotiated: { type: Boolean, default: false },
    standard_storage_charge_percent: { type: Number, default: null },
    negotiated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    negotiated_by_role: { type: String, default: null },
    negotiated_at: { type: Date, default: null },
    negotiation_reason: { type: String, trim: true, default: null },

    // Calculated financial breakdown (set at loan creation)
    interest_amount: { type: Number, min: 0, default: 0 },        // interest charged
    storage_charge_amount: { type: Number, min: 0, default: 0 },  // storage fee charged
    expected_total_repayable: { type: Number, min: 0 },           // principal + interest + storage (+ admin fee if deferred)
    repayment_breakdown: { type: mongoose.Schema.Types.Mixed, default: null }, // full calculation detail

    // Penalty waiver — Loan Processor/Admin can forgive the late-payment penalty for a
    // customer (goodwill, dispute, hardship, etc). The waiver reduces current_balance by
    // the unpaid penalty amount so the customer no longer owes it, but the foregone
    // revenue is always tracked here so management can see the real impact.
    penalty_waived: { type: Boolean, default: false },
    penalty_waived_amount: { type: Number, min: 0, default: 0 }, // $ value forgone
    penalty_waived_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    penalty_waived_by_role: { type: String, default: null },
    penalty_waived_at: { type: Date, default: null },
    penalty_waived_reason: { type: String, trim: true, default: null },

    // Admin fee (0-10% of principal_amount) — negotiated by the Loan Processor/Super Admin
    // at loan CREATION time, not at application. This is pure RTC revenue: it never touches
    // an investor's principal_amount or profit split (see investor_allocation_service.assignLoan).
    //   - "upfront":  collected as a separate cash payment at signing. Customer still owes
    //                 back only principal_amount; interest is charged on principal_amount alone.
    //   - "deferred": added on top of what the customer owes. Customer owes back
    //                 principal_amount + admin_fee_amount; interest is charged on that total.
    admin_fee_pct: { type: Number, min: 0, max: 10, default: 0 },
    admin_fee_amount: { type: Number, min: 0, default: 0 },
    admin_fee_type: { type: String, enum: ["upfront", "deferred", null], default: null },
    // Only meaningful when admin_fee_type is "upfront" — has the staff member collecting
    // the loan actually taken the separate cash fee at signing?
    admin_fee_collected: { type: Boolean, default: false },
    admin_fee_collected_at: { type: Date, default: null },
    admin_fee_payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque", null],
      default: null,
    },
    // The fee is a separate GL line from the disbursement itself and can genuinely be
    // collected through a different till/account (e.g. disbursement paid out from the
    // main bank, but the upfront fee collected in cash at the counter) — its own
    // selector, independent of disbursement_bank_account_key.
    admin_fee_bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },
    admin_fee_notes: { type: String, trim: true },

    // Agent referral commission — set by the Loan Processor/Admin at creation when this
    // loan was brought in by a registered agent. admin_fee_commission_pct is on the SAME
    // principal-based scale as admin_fee_pct itself (e.g. admin_fee_pct=10,
    // admin_fee_commission_pct=2.5 → agent gets 2.5 points of principal, RTC keeps the
    // remaining 7.5) and is capped at admin_fee_pct — see agent_commission_service. The
    // optional interest_commission_pct is a cut of RTC's own INTEREST-ONLY revenue share
    // (never storage, never the investor's share) — see getRtcInterestSharePct /
    // accrueInterestCommission. Actual $ accrual only happens against money genuinely
    // collected (fee actually credited to RTC, interest actually paid), never a
    // front-loaded expected total — see models/agent_commission.model.js for the ledger.
    is_referral_loan: { type: Boolean, default: false },
    referral_agent_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    admin_fee_commission_pct: { type: Number, min: 0, default: 0 },
    admin_fee_commission_amount: { type: Number, min: 0, default: 0 }, // audit/preview only
    interest_commission_enabled: { type: Boolean, default: false },
    interest_commission_pct: { type: Number, min: 0, max: 100, default: 0 },
    referral_set_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    referral_set_by_role: { type: String, default: null },
    referral_set_at: { type: Date, default: null },
    referral_notes: { type: String, trim: true, default: null },

    // Additional principal added to an already-active loan (Loan Processor/Admin only).
    // The loan's start_date/due_date never change — a top-up just adds money mid-term, so
    // its own interest/storage are prorated for the days actually remaining until due_date,
    // not the loan's full original period. Admin fee (if any) is charged on the top-up
    // amount only — the original principal's fee was already assessed at creation.
    top_ups: {
      type: [
        {
          amount: { type: Number, required: true, min: 0 },
          interest_amount: { type: Number, required: true, min: 0 },
          storage_charge_amount: { type: Number, required: true, min: 0 },
          admin_fee_pct: { type: Number, min: 0, max: 10, default: 0 },
          admin_fee_amount: { type: Number, min: 0, default: 0 },
          admin_fee_type: { type: String, enum: ["upfront", "deferred", null], default: null },
          // Snapshots the referral rate in effect at the moment of THIS top-up, mirroring
          // how admin_fee_pct/amount are already snapshotted per top-up above.
          admin_fee_commission_pct: { type: Number, min: 0, default: 0 },
          admin_fee_commission_amount: { type: Number, min: 0, default: 0 },
          bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },
          admin_fee_bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },
          added_at: { type: Date, default: Date.now },
          added_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          notes: { type: String, trim: true },
        },
      ],
      default: [],
    },

    // All loans are once-off payments
    repayment_type: {
      type: String,
      enum: ["once_off"],
      default: "once_off",
      required: true,
    },

    // Disbursement details (when money is given to customer)
    disbursement_date: { type: Date },
    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque"],
    },
    // Which real Xero bank account the disbursement paid out from — staff-picked.
    disbursement_bank_account_key: { type: String, enum: [...XERO_BANK_ACCOUNT_KEYS, null], default: null },
    disbursement_reference: { type: String, trim: true },
    disbursed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    disbursement_notes: { type: String, trim: true },

    // Dates
    start_date: { type: Date, required: true },
    due_date: { type: Date, required: true, index: true },

    // Repayment tracking
    payments: { type: [PaymentSchema], default: [] },
    total_paid: { type: Number, default: 0, min: 0 },

    // Loan status (loan lifecycle)
    status: {
      type: String,
      enum: [
        "draft",
        "pending_approval",
        "approved",
        "active",          // disbursed, being repaid
        "overdue",
        "in_grace",
        "partially_paid",
        "auction",         // grace period expired → asset listed for auction
        "redeemed",        // fully paid → asset returned to customer
        "defaulted",       // failed to repay → asset moved to auction
        "written_off",
        "cancelled",
        "rolled_over",     // closed via rollover → balance moved to a new loan on the same asset
      ],
      default: "draft",
      index: true,
    },

    // Rollover chain — set when this loan was closed by rolling it into a new loan,
    // or when this loan itself was created by rolling over a previous one.
    is_rollover: { type: Boolean, default: false },
    rollover_of: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    rolled_over_to: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
    rollover_generation: { type: Number, default: 0 },
    root_loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", index: true },
    carried_forward_arrears: { type: Number, default: 0, min: 0 },
    rollover_payment_amount: { type: Number, min: 0 },
    rollover_notes: { type: String, trim: true },

    // Approval workflow for high‑value loans
    requires_super_admin_approval: { type: Boolean, default: false },
    requested_super_admins: [
      {
        super_admin: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        requested_at: { type: Date, default: Date.now },
      },
    ],
    super_admin_approvals: [
      {
        approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approved_at: { type: Date, default: Date.now },
      },
    ],
    approval_status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // Audit / workflow
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    processed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    meta: { type: mongoose.Schema.Types.Mixed },

    // Xero references — set once the corresponding event has been posted
    xero_disbursement_transaction_id: { type: String, default: null },
    xero_writeoff_journal_id: { type: String, default: null },
    // Set when this loan's balance is reclassified from Loans Receivable into Pawned
    // Assets Inventory (loan → "auction" status). xero_auction_reclass_amount is the
    // COGS basis used later when the auction sale actually posts (see
    // xero_sync_service.syncAuctionSaleCompleted).
    xero_auction_reclass_journal_id: { type: String, default: null },
    xero_auction_reclass_amount: { type: Number, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

// Indexes
LoanSchema.index({ customer_user: 1, status: 1, due_date: 1 });
LoanSchema.index({ asset: 1, status: 1 });

// Virtual: remaining balance after payments (current_balance already reduces with each payment)
LoanSchema.virtual("remaining_balance").get(function () {
  return this.current_balance;
});

LoanSchema.set("toJSON", { virtuals: true });
LoanSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Loan", LoanSchema);