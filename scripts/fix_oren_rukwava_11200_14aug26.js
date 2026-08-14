"use strict";

/**
 * Fix Oren Rukwava's Komatsu Front Loader allocation (MV1/310726/T) for Roi Kanner.
 *
 * The loan total is $11,200 = $10,000 principal + $1,200 interest (12%).
 * The previous seed incorrectly stored 25% interest ($2,500 profit) and
 * marked the loan as "Paid" despite the due date being 2026-08-31.
 *
 * Correct figures (48% investor / 52% RTC split):
 *   Total interest : $1,200
 *   Investor profit: $576   (48% × $1,200)
 *   RTC revenue    : $624   (52% × $1,200)
 *   Status         : active / Outstanding  (loan matures 2026-08-31)
 *
 * Run from backend root:
 *   node scripts/fix_oren_rukwava_11200_14aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const Investor = require("../models/investor/investor.model");

const LOAN_REF         = "MV1/310726/T";
const PRINCIPAL        = 10_000;
const INTEREST_RATE    = 12;                               // 12% of principal
const TOTAL_INTEREST   = (PRINCIPAL * INTEREST_RATE) / 100; // 1200
const INVESTOR_SHARE   = 48;                               // %
const INVESTOR_PROFIT  = parseFloat(((TOTAL_INTEREST * INVESTOR_SHARE) / 100).toFixed(2)); // 576
const RTC_REVENUE      = parseFloat((TOTAL_INTEREST - INVESTOR_PROFIT).toFixed(2));        // 624

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const investor = await Investor.findOne({ name: /roi kanner/i }).lean();
  if (!investor) throw new Error("Investor 'Roi Kanner' not found");
  console.log(`Investor : ${investor.name} (${investor._id})`);

  const before = await InvestorLoanAllocation.findOne({
    investor_id: investor._id,
    loan_no: LOAN_REF,
  }).lean();

  if (!before) throw new Error(`Allocation for ${LOAN_REF} not found`);

  console.log("\n─── BEFORE ─────────────────────────────────────────────────────");
  console.log(`  status                : ${before.status}`);
  console.log(`  loan_status_override  : ${before.loan_status_override}`);
  console.log(`  monthly_interest_rate : ${before.monthly_interest_rate}%`);
  console.log(`  total_loan_profit     : $${before.total_loan_profit}`);
  console.log(`  total_interest_recv.  : $${before.total_interest_receivable}`);
  console.log(`  investor_profit       : $${before.investor_profit}`);
  console.log(`  rtc_revenue           : $${before.rtc_revenue}`);

  const updated = await InvestorLoanAllocation.findByIdAndUpdate(
    before._id,
    {
      $set: {
        monthly_interest_rate:    INTEREST_RATE,
        total_loan_profit:        TOTAL_INTEREST,
        total_interest_receivable: TOTAL_INTEREST,
        investor_profit:          INVESTOR_PROFIT,
        rtc_revenue:              RTC_REVENUE,
        status:                   "active",
        loan_status_override:     "Outstanding",
        completed_at:             null,
      },
    },
    { new: true },
  );

  console.log("\n─── AFTER ──────────────────────────────────────────────────────");
  console.log(`  status                : ${updated.status}`);
  console.log(`  loan_status_override  : ${updated.loan_status_override}`);
  console.log(`  monthly_interest_rate : ${updated.monthly_interest_rate}%`);
  console.log(`  total_loan_profit     : $${updated.total_loan_profit}`);
  console.log(`  total_interest_recv.  : $${updated.total_interest_receivable}`);
  console.log(`  investor_profit       : $${updated.investor_profit}`);
  console.log(`  rtc_revenue           : $${updated.rtc_revenue}`);

  console.log("\n═══ CALCULATION BREAKDOWN ══════════════════════════════════════");
  console.log(`  Borrower repays       : $${PRINCIPAL.toLocaleString()} + $${TOTAL_INTEREST} = $${(PRINCIPAL + TOTAL_INTEREST).toLocaleString()}`);
  console.log(`  Interest rate         : ${INTEREST_RATE}% of $${PRINCIPAL.toLocaleString()} = $${TOTAL_INTEREST}`);
  console.log(`  Profit split          : ${INVESTOR_SHARE}% investor / ${100 - INVESTOR_SHARE}% RTC`);
  console.log(`  Roi Kanner profit     : $${TOTAL_INTEREST} × ${INVESTOR_SHARE}% = $${INVESTOR_PROFIT}`);
  console.log(`  RTC revenue           : $${TOTAL_INTEREST} × ${100 - INVESTOR_SHARE}% = $${RTC_REVENUE}`);
  console.log(`  Loan window           : 2026-07-31 → 2026-08-31 (ACTIVE)`);
  console.log("\n  [On Roi's dashboard]");
  console.log(`  → This loan's $${INVESTOR_PROFIT} is counted in "projected return"`);
  console.log(`    because the loan matures 2026-08-31 (still active today).`);
  console.log(`  → "Lifetime + projected return" = realized profits (completed loans)`);
  console.log(`    + $${INVESTOR_PROFIT} from this loan + profits from all other active loans.`);

  console.log("\n=== Done ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Fix failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
