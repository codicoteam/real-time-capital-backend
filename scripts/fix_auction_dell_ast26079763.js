/**
 * Fix: Dell laptop AST26079763 is still showing as "auction" after its loan
 * was rolled over. This script cancels any live/draft auction record and
 * sets the asset status back to "pawned", pointing active_loan at the
 * most recent active loan for this asset.
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Asset   = require("../models/asset.model");
const Loan    = require("../models/loan.model");
const Auction = require("../models/auction.model");

const ASSET_NO = "AST26079763";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  // 1. Find the asset
  const asset = await Asset.findOne({ asset_no: ASSET_NO });
  if (!asset) throw new Error(`Asset not found: ${ASSET_NO}`);
  console.log(`✔ Asset   : ${asset.asset_no} – ${asset.title}`);
  console.log(`  current status     : ${asset.status}`);
  console.log(`  current active_loan: ${asset.active_loan}\n`);

  // 2. Find the most recent active loan for this asset (the rollover result)
  const activeLoan = await Loan.findOne({
    asset:  asset._id,
    status: "active",
  }).sort({ created_at: -1 });

  if (!activeLoan) {
    console.log("⚠ No active loan found. Listing all loans for this asset:");
    const all = await Loan.find({ asset: asset._id }).sort({ created_at: -1 }).lean();
    for (const l of all) {
      console.log(`  ${l.loan_no}  status=${l.status}  balance=$${l.current_balance}`);
    }
    throw new Error("Cannot fix asset without a valid active loan — check loan list above.");
  }

  console.log(`✔ Active loan: ${activeLoan.loan_no}  balance=$${activeLoan.current_balance}  due=${activeLoan.due_date?.toDateString()}`);

  // 3. Find any live/draft auctions for this asset
  const auctions = await Auction.find({
    asset:  asset._id,
    status: { $in: ["draft", "live"] },
  });

  if (auctions.length === 0) {
    console.log("\nℹ No live/draft auction records found (may already be cancelled).");
  } else {
    console.log(`\n✔ Found ${auctions.length} auction(s) to cancel:`);
    for (const a of auctions) {
      console.log(`  ${a.auction_no}  status=${a.status}`);
    }
  }

  // 4. Run fix inside a transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 4a. Cancel all live/draft auctions
    if (auctions.length > 0) {
      await Auction.updateMany(
        { asset: asset._id, status: { $in: ["draft", "live"] } },
        { $set: { status: "cancelled" } },
        { session },
      );
      console.log(`✔ Auction(s) cancelled.`);
    }

    // 4b. Fix asset status and active_loan pointer
    await Asset.findByIdAndUpdate(
      asset._id,
      {
        status:      "pawned",
        active_loan: activeLoan._id,
      },
      { session },
    );
    console.log(`✔ Asset status → pawned  |  active_loan → ${activeLoan.loan_no}`);

    await session.commitTransaction();
    console.log(`\n✅ Fix applied successfully.`);
    console.log(`   Asset ${ASSET_NO} is now pawned against loan ${activeLoan.loan_no}.`);

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
