"use strict";

/**
 * Update loan allocation dates for Loveness Jumbe — Honda CRV AEP 3140
 *
 * Current (wrong):  loan_date = 07 Jul 2026  →  maturity_date = 07 Aug 2026
 * Correct:          loan_date = 07 Aug 2026  →  maturity_date = 07 Sep 2026
 *
 * Also ensures:
 *   status               = "active"
 *   loan_status_override = "Outstanding"
 *
 * Run: node scripts/update_loveness_honda_crv_dates_14aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const Investor = require("../models/investor/investor.model");

const BORROWER   = "Loveness Jumbe";
const COLLATERAL = "Honda CRV AEP 3140";

const NEW_LOAN_DATE     = new Date("2026-08-07T00:00:00.000Z");
const NEW_MATURITY_DATE = new Date("2026-09-07T00:00:00.000Z");

async function main() {
  console.log("Update Loveness Jumbe — Honda CRV AEP 3140 loan dates");
  console.log("═".repeat(60));
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  // Find all allocations for this loan (may have co-investors)
  const allocations = await InvestorLoanAllocation.find({
    borrower_name: { $regex: BORROWER, $options: "i" },
    collateral_description: { $regex: "Honda CRV", $options: "i" },
  });

  if (allocations.length === 0) {
    console.error(`✗ No allocations found for borrower "${BORROWER}" with collateral matching "Honda CRV"`);
    console.log("\nSearching by borrower name only...");
    const byBorrower = await InvestorLoanAllocation.find({
      borrower_name: { $regex: BORROWER, $options: "i" },
    });
    if (byBorrower.length === 0) {
      console.error(`✗ No allocations found for borrower "${BORROWER}"`);
    } else {
      console.log(`Found ${byBorrower.length} allocation(s) for this borrower:`);
      for (const a of byBorrower) {
        console.log(`  _id=${a._id}  loan_no=${a.loan_no}  collateral="${a.collateral_description}"  loan_date=${a.loan_date?.toDateString()}  maturity=${a.maturity_date?.toDateString()}`);
      }
    }
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${allocations.length} allocation(s) for "${BORROWER}" / ${COLLATERAL}:\n`);

  for (const alloc of allocations) {
    const investor = await Investor.findById(alloc.investor_id).select("name");
    const investorName = investor?.name || String(alloc.investor_id);

    console.log(`── ${investorName}  (${alloc.investor_share_pct}% share)`);
    console.log(`   _id             : ${alloc._id}`);
    console.log(`   loan_no         : ${alloc.loan_no}`);
    console.log(`   collateral      : ${alloc.collateral_description}`);
    console.log(`   BEFORE loan_date: ${alloc.loan_date?.toDateString() ?? "—"}`);
    console.log(`   BEFORE maturity : ${alloc.maturity_date?.toDateString() ?? "—"}`);
    console.log(`   BEFORE status   : ${alloc.status}  override=${alloc.loan_status_override}`);

    await InvestorLoanAllocation.updateOne(
      { _id: alloc._id },
      {
        $set: {
          loan_date:           NEW_LOAN_DATE,
          maturity_date:       NEW_MATURITY_DATE,
          status:              "active",
          loan_status_override: "Outstanding",
        },
      },
    );

    // Re-fetch to confirm
    const updated = await InvestorLoanAllocation.findById(alloc._id);
    console.log(`   AFTER  loan_date: ${updated.loan_date?.toDateString()}`);
    console.log(`   AFTER  maturity : ${updated.maturity_date?.toDateString()}`);
    console.log(`   AFTER  status   : ${updated.status}  override=${updated.loan_status_override}`);
    console.log(`   ✅ Updated successfully\n`);
  }

  await mongoose.disconnect();
  console.log("═".repeat(60));
  console.log("Done.");
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  console.error(err.stack);
  process.exit(1);
});
