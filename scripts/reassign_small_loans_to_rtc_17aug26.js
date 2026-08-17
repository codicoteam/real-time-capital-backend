"use strict";

/**
 * Fix: small_loans allocations must always belong to Real Time Capital's own
 * internal investor account — RTC funds every small loan directly and keeps
 * 100% of the resulting profit (whether recorded in the investor_profit or
 * rtc_revenue bucket, both belong to RTC). External investors should never
 * hold a small_loans allocation.
 *
 * Found 4 small_loans allocations incorrectly assigned to external investors:
 *   LON26082351 — Roi Kanner (48% share)
 *   LON26084738 — Edgar Mucheke (60% share)
 *   LON26086070 — Edgar Mucheke (60% share)
 *   LON26089157 — Edgar Mucheke (60% share)
 *
 * This reassigns investor_id on each to RTC's internal account. Loans already
 * at the platform-standard 60% two-week rate (Edgar's three) keep their
 * investor_profit / rtc_revenue split unchanged — only the owner changes.
 * Roi's loan (48%, his negotiated override) is recomputed to the standard
 * 60% two-week rate, since that override no longer applies once RTC is the
 * funder of record.
 *
 * Run from the backend root:
 *   node scripts/reassign_small_loans_to_rtc_17aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

const STANDARD_TWO_WEEK_SHARE_PCT = 60;

const LOAN_NOS = ["LON26082351", "LON26084738", "LON26086070", "LON26089157"];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const rtc = await Investor.findOne({ kind: "rtc" });
  if (!rtc) throw new Error("RTC internal investor account not found.");
  console.log(`RTC account: ${rtc.name} (${rtc._id})\n`);

  for (const loanNo of LOAN_NOS) {
    const alloc = await InvestorLoanAllocation.findOne({ loan_no: loanNo }).populate("investor_id", "name");
    if (!alloc) {
      console.log(`[SKIP] ${loanNo} — allocation not found.`);
      continue;
    }
    if (alloc.collateral_category !== "small_loans") {
      console.log(`[SKIP] ${loanNo} — collateral_category is "${alloc.collateral_category}", not small_loans.`);
      continue;
    }
    if (alloc.investor_id.kind === "rtc") {
      console.log(`[SKIP] ${loanNo} — already assigned to RTC.`);
      continue;
    }

    const fromName = alloc.investor_id.name;
    const fromSharePct = alloc.investor_share_pct;

    if (fromSharePct !== STANDARD_TWO_WEEK_SHARE_PCT) {
      const newInvestorProfit = parseFloat((alloc.total_loan_profit * (STANDARD_TWO_WEEK_SHARE_PCT / 100)).toFixed(2));
      const newRtcRevenue = parseFloat((alloc.total_loan_profit - newInvestorProfit).toFixed(2));
      console.log(
        `[FIX]  ${loanNo}: ${fromName} (${fromSharePct}%) → RTC (${STANDARD_TWO_WEEK_SHARE_PCT}%) — ` +
          `investor_profit $${alloc.investor_profit} → $${newInvestorProfit}, rtc_revenue $${alloc.rtc_revenue} → $${newRtcRevenue}`,
      );
      alloc.investor_share_pct = STANDARD_TWO_WEEK_SHARE_PCT;
      alloc.investor_profit = newInvestorProfit;
      alloc.rtc_revenue = newRtcRevenue;
    } else {
      console.log(`[FIX]  ${loanNo}: ${fromName} → RTC (share % unchanged at ${fromSharePct}%)`);
    }

    alloc.investor_id = rtc._id;
    alloc.notes = [
      alloc.notes,
      `Reassigned from ${fromName} to Real Time Capital on ${new Date().toISOString().slice(0, 10)} — ` +
        "small_loans allocations belong to RTC's own book, not external investors.",
    ].filter(Boolean).join(" | ");

    await alloc.save();
  }

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
