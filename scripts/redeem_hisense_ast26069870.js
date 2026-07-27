/**
 * One-off fix: Hisense TV AST26069870 — loan paid after penalty.
 *
 * 1. Cancel any live/draft auction for the asset.
 * 2. Record full payment (current_balance) on the loan.
 * 3. Mark loan → redeemed, asset → redeemed, clear active_loan.
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Asset   = require("../models/asset.model");
const Loan    = require("../models/loan.model");
const Auction = require("../models/auction.model");

const ASSET_NO       = "AST26069870";
const PAYMENT_METHOD = "cash";
const SCRIPT_NOTE    = "Loan paid in full after penalty — manual correction; asset removed from auction";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  // 1. Find the asset
  const asset = await Asset.findOne({ asset_no: ASSET_NO });
  if (!asset) throw new Error(`Asset not found: ${ASSET_NO}`);
  console.log(`✔ Asset   : ${asset.asset_no} – ${asset.title}`);
  console.log(`  status     : ${asset.status}`);
  console.log(`  active_loan: ${asset.active_loan}\n`);

  // 2. Find the loan — accept any non-terminal status
  const openStatuses = ["active", "overdue", "in_grace", "partially_paid", "auction"];
  const loan = await Loan.findOne({
    asset:  asset._id,
    status: { $in: openStatuses },
  }).sort({ created_at: -1 });

  if (!loan) {
    console.log("⚠  No open loan found. All loans for this asset:");
    const all = await Loan.find({ asset: asset._id }).sort({ created_at: -1 }).lean();
    for (const l of all) {
      console.log(`  ${l.loan_no}  status=${l.status}  balance=$${l.current_balance}`);
    }
    throw new Error("No open loan to redeem — check list above.");
  }

  console.log(`✔ Loan    : ${loan.loan_no}`);
  console.log(`  status         : ${loan.status}`);
  console.log(`  principal      : $${loan.principal_amount}`);
  console.log(`  current_balance: $${loan.current_balance}`);
  console.log(`  total_paid so far: $${loan.total_paid}`);
  console.log(`  due_date       : ${loan.due_date?.toDateString()}\n`);

  // 3. Find any live/draft auctions
  const auctions = await Auction.find({
    asset:  asset._id,
    status: { $in: ["draft", "live"] },
  });
  console.log(auctions.length
    ? `✔ Found ${auctions.length} auction(s) to cancel: ${auctions.map(a => a.auction_no).join(", ")}`
    : `ℹ No live/draft auction records found.`);

  // 4. The amount being recorded as paid = whatever the current balance shows
  const paymentAmount = loan.current_balance;

  console.log(`\n── Redemption plan ───────────────────────────────────────────────────`);
  console.log(`  Payment to record : $${paymentAmount}  (clears outstanding balance)`);
  console.log(`  Loan status       : ${loan.status} → redeemed`);
  console.log(`  Asset status      : ${asset.status} → redeemed`);
  console.log(`──────────────────────────────────────────────────────────────────────\n`);

  // 5. Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 5a. Cancel all live/draft auctions
    if (auctions.length > 0) {
      await Auction.updateMany(
        { asset: asset._id, status: { $in: ["draft", "live"] } },
        { $set: { status: "cancelled" } },
        { session },
      );
      console.log(`✔ Auction(s) cancelled.`);
    }

    // 5b. Record payment + mark loan redeemed
    const paymentRecord = {
      amount:         paymentAmount,
      payment_date:   new Date(),
      payment_method: PAYMENT_METHOD,
      status:         "paid",
      reference_no:   `REDEEM-${ASSET_NO}-${Date.now()}`,
      notes:          SCRIPT_NOTE,
    };

    await Loan.findByIdAndUpdate(
      loan._id,
      {
        $set: {
          status:          "redeemed",
          current_balance: 0,
          total_paid:      parseFloat((loan.total_paid + paymentAmount).toFixed(2)),
        },
        $push: {
          payments: paymentRecord,
          status_history: {
            from:       loan.status,
            to:         "redeemed",
            changed_at: new Date(),
            notes:      SCRIPT_NOTE,
          },
        },
      },
      { session },
    );
    console.log(`✔ Loan ${loan.loan_no} → redeemed  (balance cleared)`);

    // 5c. Free the asset — redeemed + remove active_loan
    await Asset.findByIdAndUpdate(
      asset._id,
      {
        $set:   { status: "redeemed" },
        $unset: { active_loan: "" },
      },
      { session },
    );
    console.log(`✔ Asset ${ASSET_NO} → redeemed  (active_loan cleared)`);

    await session.commitTransaction();

    console.log(`\n✅ Done!`);
    console.log(`   Loan  : ${loan.loan_no} → redeemed`);
    console.log(`   Asset : ${ASSET_NO} (${asset.title}) → redeemed`);
    console.log(`   Paid  : $${paymentAmount}`);

  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
