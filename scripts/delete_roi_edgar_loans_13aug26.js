"use strict";

/**
 * Cleanup script – 13 Aug 2026
 *
 * For investors ROI (roikanner.rk@gmail.com) and Edgar (emucheke@gmail.com):
 *   1. Deletes all InvestorLoanAllocation records.
 *   2. Resets committed_capital to 0 on the Investor document.
 *   3. Zeroes their current_weight in the InvestorRRState singleton.
 *
 * Run from backend root:
 *   node scripts/delete_roi_edgar_loans_13aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const InvestorRRState = require("../models/investor/investor_rr_state.model");

const TARGET_EMAILS = ["roikanner.rk@gmail.com", "emucheke@gmail.com"];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  for (const email of TARGET_EMAILS) {
    console.log(`═══════════════════════════════════════`);
    console.log(`Processing: ${email}`);

    const investor = await Investor.findOne({ email });
    if (!investor) {
      console.log(`  WARNING: No investor found with email ${email} — skipping.\n`);
      continue;
    }
    console.log(`  Found   : ${investor.name} (${investor._id})`);
    console.log(`  Capital : $${investor.committed_capital} (before)`);

    // 1. Delete all loan allocations for this investor
    const allocResult = await InvestorLoanAllocation.deleteMany({ investor_id: investor._id });
    console.log(`  Deleted : ${allocResult.deletedCount} loan allocation(s)`);

    // 2. Reset committed_capital to 0
    await Investor.findByIdAndUpdate(investor._id, { committed_capital: 0 });
    console.log(`  Capital : $0 (after reset)`);

    // 3. Zero their weight in the round-robin state singleton
    const rrState = await InvestorRRState.findOne({});
    if (rrState) {
      const entry = rrState.weights.find(
        (w) => w.investor_id.toString() === investor._id.toString()
      );
      if (entry) {
        entry.current_weight = 0;
        await rrState.save();
        console.log(`  RR weight zeroed for ${investor.name}`);
      } else {
        console.log(`  RR weight: no entry found for this investor (nothing to zero)`);
      }
    } else {
      console.log(`  RR state: no singleton document found (nothing to zero)`);
    }

    console.log();
  }

  console.log("═══════════════════════════════════════");
  console.log("Cleanup complete.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
