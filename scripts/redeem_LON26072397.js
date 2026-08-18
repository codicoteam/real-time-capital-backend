/**
 * One-off script: Redeem loan LON26072397.
 *
 * Customer paid $205.26 (full balance including grace penalty) on the last
 * day before auction (2026-08-18). The scheduler had already moved the loan
 * to "auction" status before the payment was received.
 *
 * Steps:
 *  1. Find the loan by loan_no
 *  2. Cancel the live/draft auction listing for the asset
 *  3. Record the full payment ($205.26, cash)
 *  4. Set loan status → "redeemed", current_balance → 0
 *  5. Set asset status → "redeemed", clear active_loan
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Loan    = require("../models/loan.model");
const Asset   = require("../models/asset.model");
const Auction = require("../models/auction.model");

const LOAN_NO        = "LON26072397";
const PAYMENT_AMOUNT = 205.26;
const PAYMENT_METHOD = "cash";
const PAYMENT_DATE   = new Date("2026-08-18T00:00:00.000Z");
const NOTES          = "Full redemption payment received 18 Aug 2026 — last day before auction. Admin override via script.";

async function main() {
  console.log("Connecting to MongoDB…");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find the loan
    const loan = await Loan.findOne({ loan_no: LOAN_NO }).session(session);
    if (!loan) throw new Error(`Loan ${LOAN_NO} not found`);

    console.log(`Found loan: ${loan.loan_no}`);
    console.log(`  status         : ${loan.status}`);
    console.log(`  current_balance: $${loan.current_balance}`);
    console.log(`  total_paid     : $${loan.total_paid}`);
    console.log(`  asset          : ${loan.asset}`);

    if (loan.status === "redeemed") {
      throw new Error("Loan is already redeemed — nothing to do.");
    }

    // 2. Cancel any live/draft auction for this asset
    const cancelledAuction = await Auction.findOneAndUpdate(
      { asset: loan.asset, status: { $in: ["draft", "live"] } },
      { $set: { status: "cancelled" } },
      { session, new: true },
    );
    if (cancelledAuction) {
      console.log(`\n  ✔ Auction cancelled: ${cancelledAuction.auction_no}`);
    } else {
      console.log("\n  ⚠ No live/draft auction found for this asset (already closed or none).");
    }

    // 3. Record payment on the loan
    const paymentRecord = {
      amount:         PAYMENT_AMOUNT,
      payment_date:   PAYMENT_DATE,
      payment_method: PAYMENT_METHOD,
      status:         "paid",
      reference_no:   `ADMIN-REDEEM-${Date.now()}`,
      notes:          NOTES,
    };

    const newTotalPaid = parseFloat((loan.total_paid + PAYMENT_AMOUNT).toFixed(2));

    await Loan.findByIdAndUpdate(
      loan._id,
      {
        $push: { payments: paymentRecord },
        status:          "redeemed",
        current_balance: 0,
        total_paid:      newTotalPaid,
        updated_at:      new Date(),
      },
      { session },
    );

    // 4. Update asset to redeemed and clear active_loan
    await Asset.findByIdAndUpdate(
      loan.asset,
      {
        status:             "redeemed",
        $unset: { active_loan: "" },
      },
      { session },
    );

    await session.commitTransaction();

    console.log("\n══════════════════════════════════════════");
    console.log("  ✅ SUCCESS");
    console.log(`  Loan ${LOAN_NO}     → status: redeemed`);
    console.log(`  Payment recorded   : $${PAYMENT_AMOUNT} (${PAYMENT_METHOD})`);
    console.log(`  New total paid     : $${newTotalPaid}`);
    console.log(`  New balance        : $0.00`);
    console.log(`  Asset              : status → redeemed, active_loan cleared`);
    if (cancelledAuction) {
      console.log(`  Auction ${cancelledAuction.auction_no} : status → cancelled`);
    }
    console.log("══════════════════════════════════════════\n");
  } catch (err) {
    await session.abortTransaction();
    console.error("\n  ❌ FAILED:", err.message);
    throw err;
  } finally {
    session.endSession();
    await mongoose.disconnect();
    console.log("Disconnected.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
