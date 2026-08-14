"use strict";

/**
 * Backfill monthly interest payments for standalone investor allocations where
 * the borrower pays interest monthly while the principal stays outstanding.
 *
 * Loans (all standalone — no pawn system loan_id):
 *
 *   TD1/230326/T   Takudzwa Mashumba — Howo Tipper
 *                  Start: 30 Mar 2026  Principal: $17,000  Rate: 25%/month
 *                  Monthly interest: $4,250  →  Roi Kanner 48% = $2,040 | Cranbrook 12% = $510
 *                  Months to record: Apr May Jun Jul 2026 (4 months)
 *
 *   MV1/120326/T   Tinashe Chingweya — Toyota RACTI AHI 1137
 *                  Start: 18 Mar 2026  Principal: $3,500  Rate: 25%/month
 *                  Monthly interest: $875  →  Roi Kanner 48% = $420 | Cranbrook 12% = $105
 *                  Months to record: Apr May Jun Jul 2026 (4 months)
 *
 *   MV1/240626/T   Anold Chaeruka — Isuzu FVR900 ABP 7051
 *                  Start: 24 Jun 2026  Principal: $4,500  Rate: 25%/month
 *                  Monthly interest: $1,125  →  Roi Kanner 48% = $540 | Cranbrook 12% = $135
 *                  Months to record: Jul 2026 (1 month — Aug 24 not due yet)
 *
 *   MV1/180326/T-cb  Tinashe Chingweya — Toyota Racti rollover (Cranbrook only 60%)
 *                  Start: 18 Jul 2026  Principal: $3,024  Rate: 25%/month
 *                  Months to record: NONE — Aug 18 2026 not yet past (today = Aug 14)
 *
 * Run: node scripts/record_monthly_interest_backfill_14aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const InvestorMonthlyInterest = require("../models/investor/investor_monthly_interest.model");
const Investor = require("../models/investor/investor.model");

// Loans to process — use the allocation's own loan_date and monthly_interest_rate
const LOAN_NOS = [
  "TD1/230326/T",    // Takudzwa Mashumba — Howo Tipper
  "MV1/120326/T",    // Tinashe Chingweya — Toyota RACTI AHI 1137
  "MV1/240626/T",    // Anold Chaeruka   — Isuzu FVR900 ABP 7051
  "MV1/180326/T-cb", // Tinashe Chingweya — Toyota rollover (Cranbrook, likely 0 months yet)
];

/**
 * Returns completed monthly periods from startDate up to (but not including)
 * any period whose end date is still in the future.
 *
 * Period labels use the month the interest was DUE (the period end month).
 *
 * Examples (today = 14 Aug 2026):
 *   start=30 Mar 2026 → ["2026-04","2026-05","2026-06","2026-07"]  (Aug 30 > today)
 *   start=18 Mar 2026 → ["2026-04","2026-05","2026-06","2026-07"]  (Aug 18 > today)
 *   start=24 Jun 2026 → ["2026-07"]                                (Aug 24 > today)
 *   start=18 Jul 2026 → []                                          (Aug 18 > today)
 */
function completedMonths(startDate, today) {
  const results = [];
  let periodStart = new Date(startDate);

  while (true) {
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    if (periodEnd > today) break; // period not yet due

    const yr = periodEnd.getFullYear();
    const mo = String(periodEnd.getMonth() + 1).padStart(2, "0");
    results.push({ period_month: `${yr}-${mo}`, period_end: new Date(periodEnd) });

    periodStart = periodEnd;
  }
  return results;
}

async function processLoan(loanNo, today) {
  console.log(`\n${"━".repeat(65)}`);
  console.log(`Loan: ${loanNo}`);

  const allocations = await InvestorLoanAllocation.find({ loan_no: loanNo });
  if (allocations.length === 0) {
    console.error(`  ✗ No allocations found for loan_no "${loanNo}" — skipping`);
    return;
  }

  // Use first allocation for the loan meta (all allocations share the same loan details)
  const ref = allocations[0];
  const monthlyBorrowerInterest = ref.total_interest_receivable ||
    parseFloat((ref.principal_amount * ((ref.monthly_interest_rate || 0) / 100)).toFixed(2));

  console.log(`  Borrower   : ${ref.borrower_name}`);
  console.log(`  Collateral : ${ref.collateral_description}`);
  console.log(`  Loan date  : ${ref.loan_date?.toDateString()}  →  ${ref.maturity_date?.toDateString()}`);
  console.log(`  Principal  : $${ref.principal_amount}  @  ${ref.monthly_interest_rate}%/month`);
  console.log(`  Monthly interest (borrower pays): $${monthlyBorrowerInterest}`);
  console.log(`  Allocations: ${allocations.length}`);

  if (!monthlyBorrowerInterest || monthlyBorrowerInterest <= 0) {
    console.error(`  ✗ Cannot compute monthly interest — check monthly_interest_rate or total_interest_receivable`);
    return;
  }

  if (!ref.loan_date) {
    console.error(`  ✗ loan_date is missing on allocation — skipping`);
    return;
  }

  const months = completedMonths(ref.loan_date, today);
  console.log(`  Periods to record: ${months.length}`);
  if (months.length === 0) {
    console.log("  → No completed periods yet (first month not yet due)");
    return;
  }

  for (const alloc of allocations) {
    const investor = await Investor.findById(alloc.investor_id).select("name");
    const investorName = investor?.name || String(alloc.investor_id);

    console.log(`\n  ── ${investorName}  (${alloc.investor_share_pct}% share)  alloc=${alloc._id}`);

    let recorded = 0;
    let skipped = 0;

    for (const { period_month, period_end } of months) {
      const existing = await InvestorMonthlyInterest.findOne({
        allocation_id: alloc._id,
        period_month,
      });

      if (existing) {
        console.log(`    ⊘ ${period_month}  already recorded (investor $${existing.investor_amount}) — skip`);
        skipped++;
        continue;
      }

      const investor_amount = parseFloat((monthlyBorrowerInterest * (alloc.investor_share_pct / 100)).toFixed(2));
      const rtc_amount = parseFloat((monthlyBorrowerInterest - investor_amount).toFixed(2));

      await InvestorMonthlyInterest.create({
        investor_id: alloc.investor_id,
        allocation_id: alloc._id,
        loan_id: alloc.loan_id || null,
        loan_no: loanNo,
        period_month,
        borrower_interest_paid: monthlyBorrowerInterest,
        investor_share_pct: alloc.investor_share_pct,
        investor_amount,
        rtc_amount,
        payment_date: period_end,
        payment_method: "cash",
        notes: `Backfill 14-Aug-2026: borrower paid monthly interest for ${period_month}. ` +
               `Principal $${alloc.principal_amount} outstanding.`,
      });

      console.log(`    ✅ ${period_month}  (due ${period_end.toDateString()})` +
                  `  →  investor +$${investor_amount}  |  RTC $${rtc_amount}`);
      recorded++;
    }

    console.log(`     recorded=${recorded}  skipped=${skipped}`);
  }
}

async function main() {
  console.log("Monthly Interest Backfill — 14 Aug 2026");
  console.log("═".repeat(65));
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.");

  const today = new Date();
  console.log(`Run date: ${today.toDateString()}  (${today.toISOString()})`);

  for (const loanNo of LOAN_NOS) {
    await processLoan(loanNo, today);
  }

  // ── Final verification ──────────────────────────────────────────────────────
  console.log(`\n\n${"═".repeat(65)}`);
  console.log("VERIFICATION — all monthly interest records now in DB:\n");
  for (const loanNo of LOAN_NOS) {
    const records = await InvestorMonthlyInterest.find({ loan_no: loanNo })
      .populate("investor_id", "name")
      .sort({ period_month: 1 });
    if (records.length === 0) {
      console.log(`  ${loanNo}: (none)`);
      continue;
    }
    console.log(`  ${loanNo} — ${records[0].loan_no} (${records.length} record${records.length !== 1 ? "s" : ""})`);
    for (const r of records) {
      const invName = r.investor_id?.name || String(r.investor_id);
      console.log(`    ${r.period_month}  ${invName.padEnd(20)} share=${r.investor_share_pct}%  investor=$${r.investor_amount}  rtc=$${r.rtc_amount}`);
    }
  }

  await mongoose.disconnect();
  console.log("\n" + "═".repeat(65));
  console.log("Done.");
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  console.error(err.stack);
  process.exit(1);
});
