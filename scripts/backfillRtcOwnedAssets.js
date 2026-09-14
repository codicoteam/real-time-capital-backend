"use strict";

// One-time backfill: corrects assets left stranded at status "auction" by the old
// auction-expiry bug (the scheduler never determined a winner, so an expired-unsold
// auction just flipped to "closed" without ever updating its Asset). Finds every
// closed, winner-less auction whose asset is still sitting at "auction" and marks it
// "rtc_owned", exactly as the fixed live code now does going forward.
//
// Usage:
//   node scripts/backfillRtcOwnedAssets.js --dry-run   # preview only, changes nothing
//   node scripts/backfillRtcOwnedAssets.js              # apply

require("dotenv").config();
const connectDB = require("../configs/db_config");
const mongoose = require("mongoose");
const Auction = require("../models/auction.model");
const Asset = require("../models/asset.model");

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  await connectDB();

  const closedNoWinner = await Auction.find({ status: "closed", winner_user: null }).lean();
  let fixed = 0;
  let skipped = 0;

  for (const auction of closedNoWinner) {
    const asset = await Asset.findById(auction.asset);
    if (!asset) {
      console.log(`  skip ${auction.auction_no}: asset ${auction.asset} not found`);
      skipped += 1;
      continue;
    }
    if (asset.status !== "auction") {
      skipped += 1; // already resolved some other way (sold/retained/redeemed/etc) — leave it alone
      continue;
    }

    console.log(`${isDryRun ? "[dry-run] would fix" : "  fixing"} ${asset.asset_no} (${asset.title}) — was stuck at "auction" since ${auction.auction_no} closed unsold`);

    if (!isDryRun) {
      asset.status = "rtc_owned";
      asset.rtc_owned_at = auction.ends_at || auction.updated_at || new Date();
      asset.rtc_owned_from_auction = auction._id;
      await asset.save();
    }
    fixed += 1;
  }

  console.log(`\n${isDryRun ? "Would fix" : "Fixed"}: ${fixed}, skipped (already resolved / asset missing): ${skipped}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill crashed:", err);
  process.exit(1);
});
