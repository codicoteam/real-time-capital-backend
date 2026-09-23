"use strict";

// XeroSyncLog rows fail or get stuck "pending" for all sorts of reasons — the org token
// expired, an account wasn't resolved yet, the process restarted mid-call — and nothing
// in this codebase ever went back and retried them. Every automatic sync call is
// fire-and-forget (see loan_service.js etc.), and the Super Admin > Xero Integration
// "Retry" button (xero_controller.retrySyncLog) only ever flipped a row's status back to
// "pending" — there was no poller consuming that signal, so clicking it did nothing.
// This is that poller. Runs every 5 minutes, same setInterval style as
// services/assets_auction_service.js and services/daily_digest_scheduler.js (no cron
// package in this codebase).
//
// Every sync function this replays (syncLoanDisbursed, syncLoanWrittenOff, etc.) now
// guards itself against double-posting by checking its own xero_*_id field first — see
// xero_sync_service.js — so calling one again for an already-synced record is always
// safe and a no-op. That guard is what makes blind, periodic replay of this list safe.

const XeroSyncLog = require("../../models/xero/xero_sync_log.model");
const Loan = require("../../models/loan.model");
const Payment = require("../../models/payment.model");
const Expense = require("../../models/expense.model");
const Asset = require("../../models/asset.model");
const BidPayment = require("../../models/bidPayment.model");
const InvestorTransaction = require("../../models/investor/investor_transaction.model");
const AgentCommission = require("../../models/agent_commission.model");
const xeroSyncService = require("./xero_sync_service");

const FIVE_MIN_MS = 5 * 60 * 1000;
const MAX_AUTO_ATTEMPTS = 8; // beyond this, leave it failed for a human to look at rather than retrying forever
const STUCK_PENDING_AFTER_MS = 10 * 60 * 1000; // a real Xero call finishes in seconds — a "pending" row older than this was orphaned by a process restart, not still in flight

// One entry per XeroSyncLog.event_type whose source is a single document with its own
// xero_*_id field. loan_repayment is handled separately (see replayLoanRepayment) since
// it can come from either the Payment or the legacy embedded-Loan.payments path.
const REPLAYERS = {
  loan_disbursed: {
    model: Loan,
    idField: "xero_disbursement_transaction_id",
    resync: (loan) => xeroSyncService.syncLoanDisbursed(loan),
  },
  loan_written_off: {
    model: Loan,
    idField: "xero_writeoff_journal_id",
    resync: (loan) => xeroSyncService.syncLoanWrittenOff(loan),
  },
  loan_moved_to_auction: {
    model: Loan,
    idField: "xero_auction_reclass_journal_id",
    resync: (loan) => xeroSyncService.syncLoanMovedToAuction(loan),
  },
  auction_sale: {
    model: BidPayment,
    idField: "xero_bank_transaction_id",
    resync: (bidPayment) => xeroSyncService.syncAuctionSaleCompleted(bidPayment),
  },
  asset_disposal_sale: {
    model: Asset,
    idField: "xero_disposal_transaction_id",
    resync: (asset) =>
      xeroSyncService.syncAssetDisposalSale(asset, {
        costBasis: asset.disposal_cost_basis || 0,
        paymentMethod: asset.disposal_payment_method || "cash",
        bankAccountKey: asset.disposal_bank_account_key || undefined,
      }),
  },
  expense_approved: {
    model: Expense,
    idField: "xero_bank_transaction_id",
    resync: (expense) => xeroSyncService.syncExpenseApproved(expense),
  },
};

// investor_deposit / investor_capital_withdrawal / investor_profit_withdrawal /
// investor_drawing all replay through the same syncInvestorTransaction.
const INVESTOR_TX_EVENT_TYPES = new Set([
  "investor_deposit",
  "investor_capital_withdrawal",
  "investor_profit_withdrawal",
  "investor_drawing",
]);

async function replayLoanRepayment(row) {
  if (row.source_collection === "Payment") {
    const payment = await Payment.findById(row.source_id);
    if (!payment) return { outcome: "orphaned" };
    if (payment.xero_bank_transaction_id) {
      return { outcome: "already_synced", xeroId: payment.xero_bank_transaction_id };
    }
    const loan = await Loan.findById(payment.loan);
    if (!loan) return { outcome: "orphaned" };
    const xeroId = await xeroSyncService.syncLoanRepayment(payment, loan);
    return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
  }

  // Legacy embedded-array path (loan_service.js processPayment). The log row's source_id
  // is the Loan, not a specific payment — sync every embedded payment on that loan still
  // missing an xero_bank_transaction_id, not just the one behind this particular row, since
  // a single failed log entry can be hiding more than one unsynced payment on the same loan.
  const loan = await Loan.findById(row.source_id);
  if (!loan) return { outcome: "orphaned" };
  const unsynced = (loan.payments || []).filter((p) => !p.xero_bank_transaction_id);
  if (unsynced.length === 0) return { outcome: "already_synced" };

  const xeroIds = [];
  let anyFailed = false;
  for (const paymentEntry of unsynced) {
    const xeroId = await xeroSyncService.syncLoanRepaymentLegacy(loan, paymentEntry);
    if (xeroId) xeroIds.push(xeroId);
    else anyFailed = true;
  }
  if (xeroIds.length === 0) return { outcome: "failed" };
  return { outcome: anyFailed ? "partially_synced" : "synced", xeroId: xeroIds.join(",") };
}

// agent_commission_paid's source_id is a payout_batch_id (a string shared by several
// AgentCommission rows), not a single document's ObjectId — doesn't fit the generic
// REPLAYERS map, same reason loan_repayment gets its own function above.
async function replayAgentCommissionPayout(row) {
  const rows = await AgentCommission.find({ payout_batch_id: row.source_id });
  if (rows.length === 0) return { outcome: "orphaned" };
  if (rows[0].xero_bank_transaction_id) {
    return { outcome: "already_synced", xeroId: rows[0].xero_bank_transaction_id };
  }
  const batch = {
    payout_batch_id: row.source_id,
    agent_id: rows[0].agent_id,
    total_amount: rows.reduce((s, r) => s + r.commission_amount, 0),
    commission_ids: rows.map((r) => r._id.toString()),
    payout_method: rows[0].payout_method,
    payout_bank_account_key: rows[0].payout_bank_account_key,
    paid_at: rows[0].paid_at,
  };
  const xeroId = await xeroSyncService.syncAgentCommissionPaid(batch);
  return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
}

// admin_fee_recognized's idempotency field lives on the Loan itself (loan creation) OR
// nested inside loan.top_ups[topUpIndex] (a top-up) — doesn't fit the generic REPLAYERS
// shape, which assumes a single top-level idField.
async function replayAdminFeeRecognized(row) {
  const loan = await Loan.findById(row.source_id);
  if (!loan) return { outcome: "orphaned" };

  const topUpIndex = row.payload?.topUpIndex ?? null;
  const alreadyPosted =
    topUpIndex == null ? loan.xero_admin_fee_transaction_id : loan.top_ups?.[topUpIndex]?.xero_admin_fee_transaction_id;
  if (alreadyPosted) return { outcome: "already_synced", xeroId: alreadyPosted };

  const feeAmount = topUpIndex == null ? loan.admin_fee_amount : loan.top_ups?.[topUpIndex]?.admin_fee_amount;
  if (!feeAmount || feeAmount <= 0) return { outcome: "orphaned" }; // fee was corrected/removed since this log row was created

  const feeType = topUpIndex == null ? loan.admin_fee_type : loan.top_ups?.[topUpIndex]?.admin_fee_type;
  const paymentMethod = topUpIndex == null ? loan.admin_fee_payment_method : null;
  const bankAccountKey =
    topUpIndex == null ? loan.admin_fee_bank_account_key : loan.top_ups?.[topUpIndex]?.admin_fee_bank_account_key;
  const date = topUpIndex == null ? loan.admin_fee_collected_at : loan.top_ups?.[topUpIndex]?.added_at;

  const xeroId = await xeroSyncService.syncAdminFeeRecognized(loan, {
    topUpIndex,
    feeAmount,
    feeType,
    paymentMethod,
    bankAccountKey,
    date,
  });
  return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
}

// investor_profit_share_accrued's source_id is a Payment._id (Payment-model path) or an
// embedded payments[]._id (legacy path, source_collection "Loan") — same split reasoning
// as loan_repayment above, so it gets its own function too.
async function replayInvestorProfitShareAccrual(row) {
  if (row.source_collection === "Payment") {
    const payment = await Payment.findById(row.source_id);
    if (!payment) return { outcome: "orphaned" };
    if (payment.xero_investor_profit_journal_id) {
      return { outcome: "already_synced", xeroId: payment.xero_investor_profit_journal_id };
    }
    const loan = await Loan.findById(payment.loan);
    if (!loan) return { outcome: "orphaned" };
    const xeroId = await xeroSyncService.accrueInvestorProfitShare(loan, {
      interest: payment.interest_component || 0,
      storage: payment.storage_component || 0,
      sourceCollection: "Payment",
      sourceId: payment._id,
      date: payment.paid_at,
    });
    if (xeroId) await Payment.updateOne({ _id: payment._id }, { $set: { xero_investor_profit_journal_id: xeroId } });
    return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
  }

  // Legacy embedded path — source_id is the embedded payment's own _id (see
  // xero_sync_service.syncLoanRepaymentLegacy), so find its parent loan directly.
  const loan = await Loan.findOne({ "payments._id": row.source_id });
  if (!loan) return { outcome: "orphaned" };
  const paymentEntry = loan.payments.id(row.source_id);
  if (!paymentEntry) return { outcome: "orphaned" };
  if (paymentEntry.xero_investor_profit_journal_id) {
    return { outcome: "already_synced", xeroId: paymentEntry.xero_investor_profit_journal_id };
  }

  const total = loan.expected_total_repayable || loan.principal_amount || 1;
  const interestRatio = (loan.interest_amount || 0) / total;
  const storageRatio = (loan.storage_charge_amount || 0) / total;
  const interest = Math.round(paymentEntry.amount * interestRatio * 100) / 100;
  const storage = Math.round(paymentEntry.amount * storageRatio * 100) / 100;

  const xeroId = await xeroSyncService.accrueInvestorProfitShare(loan, {
    interest,
    storage,
    sourceCollection: "Loan",
    sourceId: paymentEntry._id,
    date: paymentEntry.payment_date,
  });
  if (xeroId) {
    await Loan.updateOne(
      { _id: loan._id, "payments._id": paymentEntry._id },
      { $set: { "payments.$.xero_investor_profit_journal_id": xeroId } },
    );
  }
  return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
}

async function replayRow(row) {
  if (row.event_type === "loan_repayment") return replayLoanRepayment(row);
  if (row.event_type === "agent_commission_paid") return replayAgentCommissionPayout(row);
  if (row.event_type === "admin_fee_recognized") return replayAdminFeeRecognized(row);
  if (row.event_type === "investor_profit_share_accrued") return replayInvestorProfitShareAccrual(row);

  let def = REPLAYERS[row.event_type];
  if (!def && INVESTOR_TX_EVENT_TYPES.has(row.event_type)) {
    def = {
      model: InvestorTransaction,
      idField: "xero_bank_transaction_id",
      resync: (tx) => xeroSyncService.syncInvestorTransaction(tx),
    };
  }
  if (!def) return { outcome: "unsupported" };

  const doc = await def.model.findById(row.source_id);
  if (!doc) return { outcome: "orphaned" }; // source record no longer exists (deleted test/corrected data)
  if (doc[def.idField]) return { outcome: "already_synced", xeroId: doc[def.idField] };

  const xeroId = await def.resync(doc);
  return xeroId ? { outcome: "synced", xeroId } : { outcome: "failed" };
}

function nextBackoff(attempts) {
  const minutes = Math.min(60, 5 * Math.pow(2, attempts));
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function retryOutstandingXeroSyncs() {
  const now = new Date();
  const stuckPendingCutoff = new Date(now.getTime() - STUCK_PENDING_AFTER_MS);

  const rows = await XeroSyncLog.find({
    attempts: { $lt: MAX_AUTO_ATTEMPTS },
    $or: [
      { status: "failed", next_retry_at: { $lte: now } },
      // A manual "Retry" click (xero_controller.retrySyncLog) sets status back to
      // "pending" with next_retry_at = now — catch that promptly.
      { status: "pending", next_retry_at: { $ne: null, $lte: now } },
      // A "pending" row with no next_retry_at was never touched after creation — it's
      // either still genuinely in flight (too recent to touch) or was orphaned by a
      // process restart mid-call (old enough that it can't still be running).
      { status: "pending", next_retry_at: null, created_at: { $lte: stuckPendingCutoff } },
    ],
  })
    .sort({ created_at: 1 })
    .limit(50);

  if (rows.length === 0) return { checked: 0 };

  console.log(`[XeroRetry] ${rows.length} outstanding sync log row(s) due for retry.`);
  const tally = { synced: 0, already_synced: 0, orphaned: 0, failed: 0, unsupported: 0, partially_synced: 0 };

  for (const row of rows) {
    try {
      const result = await replayRow(row);
      tally[result.outcome] = (tally[result.outcome] || 0) + 1;

      if (result.outcome === "unsupported") continue; // don't burn an attempt on something we can't replay

      if (result.outcome === "synced" || result.outcome === "partially_synced") {
        row.status = "success";
        row.xero_id = result.xeroId || row.xero_id;
        row.last_error =
          result.outcome === "partially_synced"
            ? "Partially synced — some payments on this loan still failed; check newer log rows for this loan."
            : null;
      } else if (result.outcome === "already_synced") {
        row.status = "success";
        row.xero_id = result.xeroId || row.xero_id;
        row.last_error = "Resolved by a later sync attempt — this row predates it and is kept for the audit trail.";
      } else if (result.outcome === "orphaned") {
        row.status = "success"; // nothing left to sync — the source record is gone
        row.last_error = "Source record no longer exists (deleted test/corrected data) — no longer actionable.";
      } else {
        row.status = "failed";
        row.next_retry_at = nextBackoff(row.attempts + 1);
      }
      row.attempts += 1;
      await row.save();
    } catch (err) {
      tally.failed += 1;
      row.status = "failed";
      row.attempts += 1;
      row.last_error = err.message;
      row.next_retry_at = nextBackoff(row.attempts);
      await row.save().catch(() => {});
      console.error(`[XeroRetry] Row ${row._id} threw during replay:`, err.message);
    }
  }

  console.log(
    `[XeroRetry] Done — synced:${tally.synced} already:${tally.already_synced} ` +
      `orphaned:${tally.orphaned} partial:${tally.partially_synced} failed:${tally.failed} unsupported:${tally.unsupported}`,
  );
  return { checked: rows.length, ...tally };
}

function startXeroRetryScheduler() {
  setTimeout(() => {
    retryOutstandingXeroSyncs().catch((e) => console.error("[XeroRetry] scheduler run failed:", e.message));
    setInterval(
      () => retryOutstandingXeroSyncs().catch((e) => console.error("[XeroRetry] scheduler run failed:", e.message)),
      FIVE_MIN_MS,
    );
  }, 30_000);
  console.log("[XeroRetry] Scheduler started — checking for outstanding syncs every 5 minutes.");
}

module.exports = { retryOutstandingXeroSyncs, startXeroRetryScheduler };
