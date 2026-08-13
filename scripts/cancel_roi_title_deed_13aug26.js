"use strict";

/**
 * Cleanup script – 13 Aug 2026
 *
 * Sets all active/pending title deeds for Roi Kanner to "cancelled"
 * so they no longer count toward "Currently deployed" capital.
 *
 * Run from backend root:
 *   node scripts/cancel_roi_title_deed_13aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Investor = require("../models/investor/investor.model");
const TitleDeed = require("../models/investor/title_deed.model");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const investor = await Investor.findOne({ email: "roikanner.rk@gmail.com" });
  if (!investor) throw new Error("Roi Kanner not found.");
  console.log(`Investor : ${investor.name} (${investor._id})`);

  const deeds = await TitleDeed.find({
    investor_id: investor._id,
    status: { $in: ["active", "pending"] },
  });

  if (deeds.length === 0) {
    console.log("No active/pending title deeds found — nothing to do.");
    await mongoose.disconnect();
    return;
  }

  for (const deed of deeds) {
    await TitleDeed.findByIdAndUpdate(deed._id, { status: "cancelled" });
    console.log(`  Cancelled: ${deed.deed_number} — loan_amount: $${deed.loan_amount} (was: ${deed.status})`);
  }

  console.log(`\nDone. ${deeds.length} title deed(s) cancelled.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
