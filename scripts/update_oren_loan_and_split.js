"use strict";

/**
 * Updates LON26081819 (Oren Rukwava) to reflect:
 *   - 25% borrower charge on $10,000 → interest $2,500, total repayable $12,500
 *   - Investor (Roi Kanner) profit split: 48% investor / 52% RTC
 *
 * Run from the backend root:
 *   node scripts/update_oren_loan_and_split.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Loan = require("../models/loan.model");
const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

const LOAN_NO = "LON26081819";
const PRINCIPAL = 10_000;
const BORROWER_RATE_PCT = 25;          // 25% of principal
const INVESTOR_SHARE_PCT = 48;         // investor gets 48%
const RTC_SHARE_PCT = 52;              // RTC keeps 52%

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // ── Derived figures ────────────────────────────────────────────────────────
  const totalProfit     = parseFloat(((PRINCIPAL * BORROWER_RATE_PCT) / 100).toFixed(2)); // 2500
  const totalRepayable  = PRINCIPAL + totalProfit;                                         // 12500
  const investorProfit  = parseFloat(((totalProfit * INVESTOR_SHARE_PCT) / 100).toFixed(2)); // 1200
  const rtcRevenue      = parseFloat((totalProfit - investorProfit).toFixed(2));             // 1300

  console.log("New figures:");
  console.log(`  Interest / profit   : $${totalProfit}`);
  console.log(`  Total repayable     : $${totalRepayable}`);
  console.log(`  Investor share (48%): $${investorProfit}`);
  console.log(`  RTC share (52%)     : $${rtcRevenue}\n`);

  // ── 1. Update the loan ─────────────────────────────────────────────────────
  const loan = await Loan.findOneAndUpdate(
    { loan_no: LOAN_NO },
    {
      $set: {
        interest_rate_percent:    BORROWER_RATE_PCT,
        interest_amount:          totalProfit,
        storage_charge_percent:   0,
        storage_charge_amount:    0,
        expected_total_repayable: totalRepayable,
        // current_balance is already $12,500 — leave it if the loan has no payments
      },
    },
    { new: true },
  );

  if (!loan) throw new Error(`Loan ${LOAN_NO} not found`);
  console.log(`✓ Loan updated: interest_amount=$${loan.interest_amount}, expected_total_repayable=$${loan.expected_total_repayable}`);

  // ── 2. Confirm investor override (already 48%, but set explicitly to be safe) ──
  const investor = await Investor.findOneAndUpdate(
    { name: /roi kanner/i },
    {
      $set: {
        "profit_share_override.one_month": INVESTOR_SHARE_PCT,
        "profit_share_override.two_week":  INVESTOR_SHARE_PCT,
      },
    },
    { new: true },
  );

  if (!investor) throw new Error("Investor Roi Kanner not found");
  console.log(`✓ Investor override confirmed: one_month=${investor.profit_share_override.one_month}%, two_week=${investor.profit_share_override.two_week}%`);

  // ── 3. Update the loan allocation ─────────────────────────────────────────
  const alloc = await InvestorLoanAllocation.findOneAndUpdate(
    { loan_no: LOAN_NO },
    {
      $set: {
        investor_share_pct: INVESTOR_SHARE_PCT,
        total_loan_profit:  totalProfit,
        investor_profit:    investorProfit,
        rtc_revenue:        rtcRevenue,
      },
    },
    { new: true },
  );

  if (!alloc) throw new Error(`Allocation for ${LOAN_NO} not found`);
  console.log(`✓ Allocation updated: investor_profit=$${alloc.investor_profit}, rtc_revenue=$${alloc.rtc_revenue}`);

  console.log("\n=== Done ===");
  console.log(`Loan     : ${LOAN_NO} (Oren Rukwava)`);
  console.log(`Total    : $${totalRepayable} ($${PRINCIPAL} principal + $${totalProfit} interest @ ${BORROWER_RATE_PCT}%)`);
  console.log(`Investor : Roi Kanner — $${investorProfit} (${INVESTOR_SHARE_PCT}%)`);
  console.log(`RTC      : $${rtcRevenue} (${RTC_SHARE_PCT}%)`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Update failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
