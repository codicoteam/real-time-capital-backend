"use strict";

/**
 * Marks Oren Rukwava's Komatsu Front Loader loan (MV1/310726/T) as PAID.
 * Updates Roi Kanner's committed_capital so the dashboard shows the correct
 * liquid cash Roi holds after the borrower repaid $11,200.
 *
 * Calculation:
 *   Borrower paid        : $11,200  ($10,000 principal + $1,200 interest @ 12%)
 *   RTC revenue (52%)    : $624
 *   Roi Kanner (48%)     : $576     (investor profit)
 *   Roi liquid cash      : $10,000 + $576 = $10,576
 *
 *   Dashboard formula    : liquid_cash = committed_capital − active_principal
 *   Other active loans   : $59,850
 *   New committed_capital: $59,850 + $10,576 = $70,426
 *   → Liquid cash shown  : $70,426 − $59,850 = $10,576 ✓
 *
 * Run from backend root:
 *   node scripts/complete_oren_loan_show_liquid_14aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const Investor = require("../models/investor/investor.model");

const LOAN_REF             = "MV1/310726/T";
const PRINCIPAL            = 10_000;
const INVESTOR_PROFIT      = 576;          // 48% of $1,200 interest
const RTC_REVENUE          = 624;          // 52% of $1,200 interest
const LIQUID_CASH_FOR_ROI  = PRINCIPAL + INVESTOR_PROFIT;  // 10,576
const OTHER_ACTIVE         = 59_850;
const NEW_COMMITTED_CAPITAL = OTHER_ACTIVE + LIQUID_CASH_FOR_ROI; // 70,426

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  const investor = await Investor.findOne({ name: /roi kanner/i });
  if (!investor) throw new Error("Investor 'Roi Kanner' not found");
  console.log(`Investor : ${investor.name}`);
  console.log(`Current committed_capital: $${investor.committed_capital.toLocaleString()}`);

  // 1. Mark the allocation as completed/Paid
  const alloc = await InvestorLoanAllocation.findOneAndUpdate(
    { investor_id: investor._id, loan_no: LOAN_REF },
    {
      $set: {
        status:               "completed",
        loan_status_override: "Paid",
        completed_at:         new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!alloc) throw new Error(`Allocation ${LOAN_REF} not found`);
  console.log(`\n✓ Allocation ${LOAN_REF} → status: ${alloc.status} / ${alloc.loan_status_override}`);

  // 2. Update committed_capital so liquid cash = $10,576
  await investor.updateOne({ $set: { committed_capital: NEW_COMMITTED_CAPITAL } });
  console.log(`✓ committed_capital: $${investor.committed_capital.toLocaleString()} → $${NEW_COMMITTED_CAPITAL.toLocaleString()}`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n═══ CALCULATION BREAKDOWN ══════════════════════════════════════════");
  console.log("  Oren Rukwava loan (MV1/310726/T — Komatsu Front Loader)");
  console.log("  ─────────────────────────────────────────────────────────");
  console.log(`  Borrower paid back     : $${(PRINCIPAL + 1200).toLocaleString()} ($${PRINCIPAL.toLocaleString()} principal + $1,200 interest @ 12%)`);
  console.log(`  RTC revenue (52%)      : $${RTC_REVENUE}`);
  console.log(`  Roi Kanner profit (48%): $${INVESTOR_PROFIT}`);
  console.log(`  Roi liquid cash        : $${PRINCIPAL.toLocaleString()} principal + $${INVESTOR_PROFIT} profit = $${LIQUID_CASH_FOR_ROI.toLocaleString()}`);

  console.log("\n  Dashboard figures after this fix:");
  console.log(`  committed_capital      : $${NEW_COMMITTED_CAPITAL.toLocaleString()}`);
  console.log(`  active loans principal : $${OTHER_ACTIVE.toLocaleString()} (other 10 active loans)`);
  console.log(`  LIQUID CASH            : $${NEW_COMMITTED_CAPITAL.toLocaleString()} − $${OTHER_ACTIVE.toLocaleString()} = $${LIQUID_CASH_FOR_ROI.toLocaleString()}`);

  console.log("\n  Lifetime + Projected Return breakdown:");
  console.log("  ─────────────────────────────────────────────────────────");
  console.log("  Formula: totalReturns = actualReturns (completed) + pendingEarnings (active)");
  console.log();
  console.log("  Completed loans (realized — investor_profit summed):");
  console.log(`    Sasha Chaparadza   MV1/210426/T  → $300.00   (Auctioned)`);
  console.log(`    Clodius Mudzudza   MV1/240326/T  → $105.60   (Paid)`);
  console.log(`    Ivy Chiwanza       MV1/180326/T  → $300.00   (Paid)`);
  console.log(`    Oren Rukwava       MV1/310726/T  → $576.00   (Paid — just completed)`);
  console.log(`    ─────────────────────────────────────────────────────`);
  console.log(`    Actual / realized               → $1,281.60`);
  console.log();
  console.log("  Active loans (projected — investor_profit summed):");
  console.log(`    Loveness Jumbe     MV1070826/T   → $198.00`);
  console.log(`    Farai Muchenjekwa  MV1/040826/T  → $480.00`);
  console.log(`    Cranbrook balance  MV1/240626/T-cb → $660.00`);
  console.log(`    Anold Chaeruka     MV1/240626/T  → $540.00`);
  console.log(`    Takudzwa Mashumba  TD1/230326/T  → $2,040.00`);
  console.log(`    Reuben Dziya 2nd   MV1/200326/T-b → $1,098.24`);
  console.log(`    Reuben Dziya       MV1/200326/T  → $4,542.72`);
  console.log(`    Tinashe Chingweya  MV1/120326/T  → $420.00`);
  console.log(`    Takunda Togarepi   MV1/110326/T  → $660.00`);
  console.log(`    ─────────────────────────────────────────────────────`);
  console.log(`    Projected / pending             → $10,638.96`);
  console.log();
  console.log(`  LIFETIME + PROJECTED RETURN      → $1,281.60 + $10,638.96 = $11,920.56`);
  console.log("\n  (Monthly interest payments already received ($10,380) are tracked");
  console.log("   separately in the Capital Ledger and add to 'Earned profit'.)");

  console.log("\n=== Done ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Script failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
