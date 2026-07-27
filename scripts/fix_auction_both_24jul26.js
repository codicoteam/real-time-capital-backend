/**
 * Fix both assets incorrectly sitting in auction — 24 Jul 2026.
 *
 * AST26069870  Hisense TV   → loan was paid in full after penalty → REDEEM
 * AST26079763  Dell Laptop  → loan was rolled over → PAWNED (active loan)
 *
 * Each asset gets its own transaction so one failure does not affect the other.
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Asset   = require("../models/asset.model");
const Loan    = require("../models/loan.model");
const Auction = require("../models/auction.model");

// ─────────────────────────────────────────────────────────────────────────────

async function cancelAuctions(assetId, session) {
  const result = await Auction.updateMany(
    { asset: assetId, status: { $in: ["draft", "live"] } },
    { $set: { status: "cancelled" } },
    { session },
  );
  return result.modifiedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Hisense TV — AST26069870 — REDEEM
// ─────────────────────────────────────────────────────────────────────────────
async function redeemHisense() {
  const ASSET_NO = "AST26069870";
  console.log(`\n${"═".repeat(60)}`);
  console.log(`FIX 1: ${ASSET_NO} — Hisense TV → REDEEM`);
  console.log("═".repeat(60));

  const asset = await Asset.findOne({ asset_no: ASSET_NO });
  if (!asset) throw new Error(`Asset not found: ${ASSET_NO}`);
  console.log(`  asset status : ${asset.status}`);

  const loan = await Loan.findOne({
    asset:  asset._id,
    status: { $in: ["active", "overdue", "in_grace", "partially_paid", "auction"] },
  }).sort({ created_at: -1 });

  if (!loan) throw new Error(`No open loan for ${ASSET_NO}. Check DB manually.`);
  console.log(`  loan         : ${loan.loan_no}  status=${loan.status}  balance=$${loan.current_balance}`);

  const paymentAmount = loan.current_balance;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cancelled = await cancelAuctions(asset._id, session);
    console.log(`  auctions cancelled : ${cancelled}`);

    await Loan.findByIdAndUpdate(loan._id, {
      $set: {
        status:          "redeemed",
        current_balance: 0,
        total_paid:      parseFloat((loan.total_paid + paymentAmount).toFixed(2)),
      },
      $push: {
        payments: {
          amount:         paymentAmount,
          payment_date:   new Date(),
          payment_method: "cash",
          status:         "paid",
          reference_no:   `REDEEM-${ASSET_NO}-${Date.now()}`,
          notes:          "Paid in full after penalty — manual fix 24 Jul 2026",
        },
        status_history: {
          from:       loan.status,
          to:         "redeemed",
          changed_at: new Date(),
          notes:      "Manual correction: loan paid after penalty, asset incorrectly left on auction",
        },
      },
    }, { session });

    await Asset.findByIdAndUpdate(asset._id, {
      $set:   { status: "redeemed" },
      $unset: { active_loan: "" },
    }, { session });

    await session.commitTransaction();
    console.log(`  ✅ Loan ${loan.loan_no} → redeemed | Asset ${ASSET_NO} → redeemed`);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dell Laptop — AST26079763 — PAWNED (rollover active)
// ─────────────────────────────────────────────────────────────────────────────
async function fixDellPawned() {
  const ASSET_NO = "AST26079763";
  console.log(`\n${"═".repeat(60)}`);
  console.log(`FIX 2: ${ASSET_NO} — Dell Laptop → PAWNED`);
  console.log("═".repeat(60));

  const asset = await Asset.findOne({ asset_no: ASSET_NO });
  if (!asset) throw new Error(`Asset not found: ${ASSET_NO}`);
  console.log(`  asset status : ${asset.status}`);

  const activeLoan = await Loan.findOne({
    asset:  asset._id,
    status: "active",
  }).sort({ created_at: -1 });

  if (!activeLoan) throw new Error(`No active loan found for ${ASSET_NO}. Check DB manually.`);
  console.log(`  active loan  : ${activeLoan.loan_no}  balance=$${activeLoan.current_balance}  due=${activeLoan.due_date?.toDateString()}`);

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cancelled = await cancelAuctions(asset._id, session);
    console.log(`  auctions cancelled : ${cancelled}`);

    await Asset.findByIdAndUpdate(asset._id, {
      $set: { status: "pawned", active_loan: activeLoan._id },
    }, { session });

    await session.commitTransaction();
    console.log(`  ✅ Asset ${ASSET_NO} → pawned | active_loan → ${activeLoan.loan_no}`);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.");

  const results = [];

  for (const [label, fn] of [
    ["Hisense TV AST26069870 → redeem", redeemHisense],
    ["Dell Laptop AST26079763 → pawned", fixDellPawned],
  ]) {
    try {
      await fn();
      results.push({ label, ok: true });
    } catch (err) {
      console.error(`\n  ❌ FAILED — ${label}`);
      console.error(`     ${err.message}`);
      results.push({ label, ok: false, error: err.message });
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("SUMMARY");
  console.log("═".repeat(60));
  for (const r of results) {
    console.log(r.ok ? `  ✅ ${r.label}` : `  ❌ ${r.label}: ${r.error}`);
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
