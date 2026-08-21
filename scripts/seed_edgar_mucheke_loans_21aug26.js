"use strict";

/**
 * Fix script – 21 Aug 2026
 *
 * Seeds Edgar Mucheke's two loans with the correct 60/40 split:
 *   Edgar (Mucheke) = 60%, RTC = 40%
 *
 * Loans:
 *   TD1/300726/T — Jemuce             — $12,500 principal, title deed
 *   MV1/070826/T — Nyasha Mandeya     — $2,200 principal, Toyota RAV4
 *
 * Edgar's investor account is identified by email emucheke@gmail.com.
 * Falls back to name-based lookup (case-insensitive "Mucheke" or "Edgar")
 * if the email lookup fails.
 *
 * Safe to re-run: each loan is deduplicated against the compound unique
 * index { investor_id, loan_no, loan_date } — existing records are skipped
 * (not overwritten) so the script is idempotent.
 *
 * Run from the backend root:
 *   node scripts/seed_edgar_mucheke_loans_21aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

const EDGAR_EMAIL = "emucheke@gmail.com";

const EDGAR_LOANS = [
  {
    loan_no: "TD1/300726/T",
    borrower_name: "Jemuce",
    collateral_description: "Southerton Property (title deed)",
    collateral_category: "motor_vehicle",
    loan_date: new Date("2026-07-30"),
    maturity_date: new Date("2026-08-30"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 12500,
    total_interest_receivable: 3125,
    total_loan_profit: 3125,
    investor_share_pct: 60,
    investor_profit: 1875,
    rtc_revenue: 1250,
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Edgar Mucheke direct loan (60%) — title deed Southerton. Seeded 21 Aug 2026.",
  },
  {
    loan_no: "MV1/070826/T",
    borrower_name: "Nyasha Patience Mandeya",
    collateral_description: "Toyota RAV 4 - ADA 7482",
    collateral_category: "motor_vehicle",
    loan_date: new Date("2026-08-07"),
    maturity_date: new Date("2026-09-07"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2200,
    total_interest_receivable: 550,
    total_loan_profit: 550,
    investor_share_pct: 60,
    investor_profit: 330,
    rtc_revenue: 220,
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Edgar Mucheke direct loan (60%) — Toyota RAV4. Seeded 21 Aug 2026.",
  },
];

async function resolveEdgar() {
  // Primary: look up by email
  let edgar = await Investor.findOne({ email: EDGAR_EMAIL });
  if (edgar) {
    console.log(`  Found by email: ${edgar.name} (${edgar._id})`);
    return edgar;
  }

  // Fallback: name-based lookup
  edgar = await Investor.findOne({ name: { $regex: /mucheke|edgar/i } });
  if (edgar) {
    console.log(`  Found by name: ${edgar.name} (${edgar._id})`);
    return edgar;
  }

  throw new Error(
    `Edgar Mucheke investor not found. Expected email ${EDGAR_EMAIL}. ` +
    "Please ensure the investor account exists before running this script."
  );
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // ── Resolve Edgar Mucheke ─────────────────────────────────────────────────────
  console.log("Looking up Edgar Mucheke investor…");
  const edgar = await resolveEdgar();
  console.log(`  Committed capital: $${edgar.committed_capital}\n`);

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const loan of EDGAR_LOANS) {
    const tag = `${loan.loan_no} / ${loan.loan_date.toISOString().slice(0, 10)} — ${loan.borrower_name}`;

    const existing = await InvestorLoanAllocation.findOne({
      investor_id: edgar._id,
      loan_no: loan.loan_no,
      loan_date: loan.loan_date,
    });

    if (existing) {
      const wrongPct = existing.investor_share_pct !== loan.investor_share_pct;
      if (wrongPct) {
        // Update the percentages if they're wrong
        await InvestorLoanAllocation.findByIdAndUpdate(existing._id, {
          investor_share_pct: loan.investor_share_pct,
          investor_profit: loan.investor_profit,
          rtc_revenue: loan.rtc_revenue,
          total_loan_profit: loan.total_loan_profit,
          total_interest_receivable: loan.total_interest_receivable,
        });
        console.log(`  FIXED split: ${tag}`);
        console.log(`    investor_share_pct: ${existing.investor_share_pct}% → ${loan.investor_share_pct}% (Edgar 60% / RTC 40%)`);
        created++;
      } else {
        console.log(`  SKIP (already exists, split correct): ${tag}`);
        skipped++;
      }
      continue;
    }

    try {
      const alloc = await InvestorLoanAllocation.create({
        investor_id: edgar._id,
        loan_id: null,
        loan_no: loan.loan_no,
        collateral_category: loan.collateral_category,
        loan_period_key: loan.loan_period_key,
        principal_amount: loan.principal_amount,
        total_loan_profit: loan.total_loan_profit,
        investor_share_pct: loan.investor_share_pct,
        investor_profit: loan.investor_profit,
        rtc_revenue: loan.rtc_revenue,
        status: "active",
        is_co_investor: false,
        borrower_name: loan.borrower_name,
        collateral_description: loan.collateral_description,
        loan_date: loan.loan_date,
        maturity_date: loan.maturity_date,
        loan_term_months: loan.loan_term_months,
        monthly_interest_rate: loan.monthly_interest_rate,
        total_interest_receivable: loan.total_interest_receivable,
        loan_status_override: loan.loan_status_override,
        notes: loan.notes,
      });

      console.log(
        `  CREATED: ${tag}\n` +
        `           principal=$${loan.principal_amount.toLocaleString()}` +
        `  interest=$${loan.total_interest_receivable.toLocaleString()}` +
        `  Edgar=${loan.investor_share_pct}% ($${loan.investor_profit})` +
        `  RTC=${100 - loan.investor_share_pct}% ($${loan.rtc_revenue})` +
        `  id=${alloc._id}`
      );
      created++;
    } catch (err) {
      console.error(`  ERROR: ${tag} — ${err.message}`);
      errors.push({ tag, error: err.message });
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`  Created/fixed : ${created}`);
  console.log(`  Skipped       : ${skipped} (already correct)`);
  console.log(`  Errors        : ${errors.length}`);
  if (errors.length) {
    console.log("\nFailed rows:");
    errors.forEach((e) => console.log(`  ${e.tag} — ${e.error}`));
  }

  const totals = EDGAR_LOANS;
  console.log("\n─── Expected totals ────────────────────");
  console.log(`  Principal  : $${totals.reduce((s, l) => s + l.principal_amount, 0).toLocaleString()}`);
  console.log(`  Interest   : $${totals.reduce((s, l) => s + l.total_interest_receivable, 0).toFixed(2)}`);
  console.log(`  Edgar 60%  : $${totals.reduce((s, l) => s + l.investor_profit, 0).toFixed(2)}`);
  console.log(`  RTC 40%    : $${totals.reduce((s, l) => s + l.rtc_revenue, 0).toFixed(2)}`);

  console.log("\n=== Done ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
