"use strict";

// One-time backfill: pushes EXISTING loans, repayments, expenses, investor transactions
// and auction sales already sitting in MongoDB into the connected Xero organisation.
// Reuses the exact same posting functions the live event hooks use (services/xero/xero_sync_service.js)
// — there is only ever one code path that knows how to build a Xero payload.
//
// This writes to your LIVE, connected Xero organisation. There is no separate "demo mode"
// switch here — safety comes from --dry-run (reports counts, posts nothing) and --limit
// (process only the first N records per category), not from a sandbox toggle.
//
// Usage:
//   node scripts/migrateXeroBackfill.js --dry-run                                   # preview only, posts nothing
//   node scripts/migrateXeroBackfill.js --limit=1 --i-understand-this-posts-to-live-xero   # smoke-test one record per category
//   node scripts/migrateXeroBackfill.js --i-understand-this-posts-to-live-xero            # full backfill
//
// Options:
//   --dry-run                                  Report what would be posted, without calling Xero
//   --limit=N                                  Cap each category to the first N unsynced records
//   --only=loans,payments,expenses,investors,auctions   Restrict to specific categories (comma-separated)
//   --i-understand-this-posts-to-live-xero     Required to actually post (ignored with --dry-run)

require("dotenv").config();
const connectDB = require("../configs/db_config");
const mongoose = require("mongoose");

const Loan = require("../models/loan.model");
const Payment = require("../models/payment.model");
const Expense = require("../models/expense.model");
const InvestorTransaction = require("../models/investor/investor_transaction.model");
const BidPayment = require("../models/bidPayment.model");

const xeroSyncService = require("../services/xero/xero_sync_service");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const confirmed = args.includes("--i-understand-this-posts-to-live-xero");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
const mongoLimit = LIMIT === Infinity ? 0 : LIMIT; // Mongoose treats .limit(0) as "no limit"
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = new Set(onlyArg ? onlyArg.split("=")[1].split(",") : ["loans", "payments", "expenses", "investors", "auctions"]);

const CUSTOMER_FIELDS = "first_name last_name email phone";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 1100; // stay safely under Xero's ~60 calls/minute app rate limit

const stats = {};
function bump(category, key) {
  stats[category] = stats[category] || { posted: 0, skipped: 0, failed: 0, dryRun: 0 };
  stats[category][key] += 1;
}

// ── Loans: disbursement, default → auction reclassification, direct write-off ──
async function migrateLoans() {
  console.log("\n=== Loans ===");

  const disbursed = await Loan.find({ disbursement_date: { $ne: null }, xero_disbursement_transaction_id: null })
    .populate("customer_user", CUSTOMER_FIELDS)
    .limit(mongoLimit);
  for (const loan of disbursed) {
    if (isDryRun) {
      console.log(`[dry-run] disbursement: ${loan.loan_no} — $${loan.principal_amount}`);
      bump("loan_disbursed", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncLoanDisbursed(loan);
      console.log(`  posted disbursement: ${loan.loan_no} — $${loan.principal_amount}`);
      bump("loan_disbursed", "posted");
    } catch (err) {
      console.error(`  FAILED disbursement ${loan.loan_no}:`, err.message);
      bump("loan_disbursed", "failed");
    }
    await sleep(DELAY_MS);
  }

  const defaulted = await Loan.find({
    status: { $in: ["auction", "defaulted"] },
    xero_auction_reclass_journal_id: null,
    current_balance: { $gt: 0 },
  }).limit(mongoLimit);
  for (const loan of defaulted) {
    if (isDryRun) {
      console.log(`[dry-run] auction reclass: ${loan.loan_no} — $${loan.current_balance}`);
      bump("loan_moved_to_auction", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncLoanMovedToAuction(loan);
      console.log(`  posted auction reclass: ${loan.loan_no} — $${loan.current_balance}`);
      bump("loan_moved_to_auction", "posted");
    } catch (err) {
      console.error(`  FAILED auction reclass ${loan.loan_no}:`, err.message);
      bump("loan_moved_to_auction", "failed");
    }
    await sleep(DELAY_MS);
  }

  const writtenOff = await Loan.find({ status: "written_off", xero_writeoff_journal_id: null }).limit(mongoLimit);
  for (const loan of writtenOff) {
    if (isDryRun) {
      console.log(`[dry-run] write-off: ${loan.loan_no} — $${loan.current_balance}`);
      bump("loan_written_off", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncLoanWrittenOff(loan);
      console.log(`  posted write-off: ${loan.loan_no} — $${loan.current_balance}`);
      bump("loan_written_off", "posted");
    } catch (err) {
      console.error(`  FAILED write-off ${loan.loan_no}:`, err.message);
      bump("loan_written_off", "failed");
    }
    await sleep(DELAY_MS);
  }
}

// ── Repayments: primary Payment-model path ─────────────────────────────────
async function migratePayments() {
  console.log("\n=== Repayments (Payment model) ===");
  const payments = await Payment.find({ payment_status: "paid", xero_bank_transaction_id: null }).limit(mongoLimit);

  for (const payment of payments) {
    const loan = await Loan.findById(payment.loan).populate("customer_user", CUSTOMER_FIELDS);
    if (!loan) {
      console.warn(`  skip payment ${payment._id}: loan ${payment.loan} not found`);
      bump("loan_repayment", "skipped");
      continue;
    }
    if (isDryRun) {
      console.log(`[dry-run] repayment: ${loan.loan_no} — $${payment.amount}`);
      bump("loan_repayment", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncLoanRepayment(payment, loan);
      console.log(`  posted repayment: ${loan.loan_no} — $${payment.amount}`);
      bump("loan_repayment", "posted");
    } catch (err) {
      console.error(`  FAILED repayment ${payment._id}:`, err.message);
      bump("loan_repayment", "failed");
    }
    await sleep(DELAY_MS);
  }
}

// ── Repayments: legacy embedded loan.payments[] path ───────────────────────
// Every repayment recorded via the primary Payment-model path is ALSO mirrored into
// loan.payments[] (see payment_service.js updateLoanBalance) — so an embedded entry only
// represents a genuinely separate event if no matching top-level Payment document exists
// for it (matched by receipt_no). Otherwise it's just the mirror of a payment already
// migrated above, and posting it too would double-count the repayment in Xero.
async function migrateLegacyEmbeddedPayments() {
  console.log("\n=== Repayments (legacy embedded path) ===");
  const loans = await Loan.find({ "payments.status": "paid", "payments.xero_bank_transaction_id": null }).populate(
    "customer_user",
    CUSTOMER_FIELDS,
  );

  let processed = 0;
  for (const loan of loans) {
    for (const entry of loan.payments) {
      if (entry.status !== "paid" || entry.xero_bank_transaction_id) continue;
      if (processed >= LIMIT) break;

      const mirrorsExistingPayment = entry.reference_no
        ? await Payment.exists({ loan: loan._id, receipt_no: entry.reference_no })
        : false;
      if (mirrorsExistingPayment) {
        bump("loan_repayment_legacy", "skipped");
        continue;
      }

      processed += 1;
      if (isDryRun) {
        console.log(`[dry-run] legacy repayment: ${loan.loan_no} — $${entry.amount}`);
        bump("loan_repayment_legacy", "dryRun");
        continue;
      }
      try {
        await xeroSyncService.syncLoanRepaymentLegacy(loan, entry);
        console.log(`  posted legacy repayment: ${loan.loan_no} — $${entry.amount}`);
        bump("loan_repayment_legacy", "posted");
      } catch (err) {
        console.error(`  FAILED legacy repayment (${loan.loan_no}):`, err.message);
        bump("loan_repayment_legacy", "failed");
      }
      await sleep(DELAY_MS);
    }
  }
}

// ── Expenses ─────────────────────────────────────────────────────────────
async function migrateExpenses() {
  console.log("\n=== Expenses ===");
  const expenses = await Expense.find({ status: "approved", xero_bank_transaction_id: null }).limit(mongoLimit);

  for (const expense of expenses) {
    if (isDryRun) {
      console.log(`[dry-run] expense: ${expense.expense_no} — $${expense.amount} (${expense.category})`);
      bump("expense_approved", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncExpenseApproved(expense);
      console.log(`  posted expense: ${expense.expense_no} — $${expense.amount}`);
      bump("expense_approved", "posted");
    } catch (err) {
      console.error(`  FAILED expense ${expense.expense_no}:`, err.message);
      bump("expense_approved", "failed");
    }
    await sleep(DELAY_MS);
  }
}

// ── Investor transactions ───────────────────────────────────────────────
async function migrateInvestorTransactions() {
  console.log("\n=== Investor transactions ===");
  const txs = await InvestorTransaction.find({ type: { $ne: "expense" }, xero_bank_transaction_id: null }).limit(mongoLimit);

  for (const tx of txs) {
    if (isDryRun) {
      console.log(`[dry-run] investor tx: ${tx.type} — $${tx.amount}`);
      bump(`investor_${tx.type}`, "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncInvestorTransaction(tx);
      console.log(`  posted investor tx: ${tx.type} — $${tx.amount}`);
      bump(`investor_${tx.type}`, "posted");
    } catch (err) {
      console.error(`  FAILED investor tx ${tx._id}:`, err.message);
      bump(`investor_${tx.type}`, "failed");
    }
    await sleep(DELAY_MS);
  }
}

// ── Auction sales — run LAST: relies on loan.xero_auction_reclass_amount having ─
// already been set by migrateLoans()'s reclassification pass, for COGS matching.
async function migrateAuctionSales() {
  console.log("\n=== Auction sales ===");
  const payments = await BidPayment.find({ status: "success", xero_bank_transaction_id: null }).limit(mongoLimit);

  for (const payment of payments) {
    if (isDryRun) {
      console.log(`[dry-run] auction sale: BidPayment ${payment._id} — $${payment.amount}`);
      bump("auction_sale", "dryRun");
      continue;
    }
    try {
      await xeroSyncService.syncAuctionSaleCompleted(payment);
      console.log(`  posted auction sale: $${payment.amount}`);
      bump("auction_sale", "posted");
    } catch (err) {
      console.error(`  FAILED auction sale ${payment._id}:`, err.message);
      bump("auction_sale", "failed");
    }
    await sleep(DELAY_MS);
  }
}

async function main() {
  if (!isDryRun && !confirmed) {
    console.error(
      "Refusing to run — this posts real historical data to your LIVE connected Xero organisation.\n" +
        "Run with --dry-run first to preview, then re-run with --i-understand-this-posts-to-live-xero " +
        "(add --limit=1 for a single-record smoke test before a full backfill).",
    );
    process.exit(1);
  }

  console.log(isDryRun ? "Running in DRY-RUN mode — nothing will be posted to Xero." : "LIVE run — posting to Xero.");
  if (LIMIT !== Infinity) console.log(`Limit: ${LIMIT} record(s) per category.`);

  await connectDB();

  if (ONLY.has("loans")) await migrateLoans();
  if (ONLY.has("payments")) {
    await migratePayments();
    await migrateLegacyEmbeddedPayments();
  }
  if (ONLY.has("expenses")) await migrateExpenses();
  if (ONLY.has("investors")) await migrateInvestorTransactions();
  if (ONLY.has("auctions")) await migrateAuctionSales();

  console.log("\n=== Summary ===");
  for (const [category, counts] of Object.entries(stats)) {
    console.log(
      `${category}: posted=${counts.posted} failed=${counts.failed} skipped=${counts.skipped} dryRun=${counts.dryRun}`,
    );
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration script crashed:", err);
  process.exit(1);
});
