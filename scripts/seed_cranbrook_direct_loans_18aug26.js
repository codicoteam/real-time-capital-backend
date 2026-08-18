"use strict";

/**
 * Seed script: Cranbrook's own direct loan portfolio — 18 August 2026.
 *
 * These are loans where Cranbrook is the PRIMARY funder (60% profit share)
 * and RTC earns 40% — the inverse of the ROI partnership loans where
 * Cranbrook is the co-investor at 12%.
 *
 * Safe to re-run: each row is deduplicated against the compound unique index
 * { investor_id, loan_no, loan_date } — existing records are skipped.
 *
 * Run from the backend root:
 *   node scripts/seed_cranbrook_direct_loans_18aug26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

// ─── Cranbrook direct loan data ──────────────────────────────────────────────
// Source: "Investor Loans (2) - Investor_Loan_Allocation (1).csv"
// Rows where Cranbrook is the primary funder (investor_share_pct = 60, is_co_investor = false).
//
// For each loan:
//   total_loan_profit  = total interest the borrower owes
//   investor_profit    = 60% of total_loan_profit  (Cranbrook's entitlement)
//   rtc_revenue        = 40% of total_loan_profit  (RTC's cut)
//
// The Wejeyi Sadza entry is split into two rows because the court order
// creates a separate 5-month repayment tranche.  Both rows share the same
// loan_no but carry different loan_date values so the compound unique index
// allows them to coexist.

const CRANBROOK_LOANS = [
  // ── Wejeyi Sadza — original loan (defaulted, court order issued) ────────────
  {
    loan_no: "TD1/110226/T",
    borrower_name: "Archibald Wejeyi Sadza",
    collateral_description: "Borrowdale Property — Title Deed",
    loan_date: new Date("2026-03-13"),
    maturity_date: new Date("2026-04-13"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 30000,
    total_interest_receivable: 7500,
    total_loan_profit: 7500,
    investor_share_pct: 60,
    investor_profit: 4500,
    rtc_revenue: 3000,
    loan_period_key: "one_month",
    loan_status_override: "Defaulted",
    notes:
      "Title deed — Borrowdale property. Court Order to pay $82,500 total over 5 months; $3,000 lawyer fees deducted. See court-order row (loan_date 2026-04-13) for the additional obligation.",
  },

  // ── Wejeyi Sadza — court-order continuation (5-month repayment plan) ────────
  // Same loan_no, different loan_date — allowed by the compound unique index.
  // The $42,000 figure is the additional court-ordered penalty after netting
  // the $3,000 lawyer fee from the raw $45,000 delta ($82,500 total − $37,500 original).
  {
    loan_no: "TD1/110226/T",
    borrower_name: "Archibald Wejeyi Sadza",
    collateral_description: "Borrowdale Property — Court Order (5-month repayment)",
    loan_date: new Date("2026-04-13"),
    maturity_date: new Date("2026-09-13"),
    loan_term_months: 5,
    monthly_interest_rate: 0,
    principal_amount: 0,
    total_interest_receivable: 42000,
    total_loan_profit: 42000,
    investor_share_pct: 60,
    investor_profit: 25200,
    rtc_revenue: 16800,
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes:
      "Court-order continuation on TD1/110226/T — Wejeyi Sadza to repay over 5 months. $3,000 lawyer fees already netted from $45,000 penalty.",
  },

  // ── Tapera Boulton ───────────────────────────────────────────────────────────
  {
    loan_no: "MV1/030226/T",
    borrower_name: "Tapera Boulton",
    collateral_description: "Mercedes Benz E200 SEDAN",
    loan_date: new Date("2026-08-04"),
    maturity_date: new Date("2026-09-04"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 8500,
    total_interest_receivable: 2125,
    total_loan_profit: 2125,
    investor_share_pct: 60,
    investor_profit: 1275,
    rtc_revenue: 850,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — motor vehicle.",
  },

  // ── Miriam Chimatira ─────────────────────────────────────────────────────────
  {
    loan_no: "MV1/180226/T",
    borrower_name: "Miriam Chimatira",
    collateral_description: "Mitsubishi Pajero AEE 2462",
    loan_date: new Date("2026-07-20"),
    maturity_date: new Date("2026-08-20"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2731,
    total_interest_receivable: 682.75,
    total_loan_profit: 682.75,
    investor_share_pct: 60,
    investor_profit: 409.65,
    rtc_revenue: 273.10,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — motor vehicle.",
  },

  // ── Tinashe Chingweya (Cranbrook's own loan, July 2026) ─────────────────────
  // NB: ROI also has a loan to the same borrower on the same vehicle dated
  // March 2026 (MV1/180326/T, ROI investor_id, loan_date 2026-03-18).
  // This is a separate loan to the same borrower on the same collateral,
  // dated four months later — allowed by the compound index because investor_id
  // and loan_date both differ.
  {
    loan_no: "MV1/180326/T",
    borrower_name: "Tinashe Chingweya",
    collateral_description: "Toyota Racti AHI 1137",
    loan_date: new Date("2026-07-18"),
    maturity_date: new Date("2026-08-18"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 3024,
    total_interest_receivable: 756,
    total_loan_profit: 756,
    investor_share_pct: 60,
    investor_profit: 453.60,
    rtc_revenue: 302.40,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes:
      "Cranbrook direct loan — same vehicle as ROI's March 2026 loan but a fresh loan issued July 2026.",
  },

  // ── Effort Nyakurerwa Murwisi — MAN truck ───────────────────────────────────
  {
    loan_no: "MV2/300326/T",
    borrower_name: "Effort Nyakurerwa Murwisi",
    collateral_description: "Rigid Truck MAN AHF 0112",
    loan_date: new Date("2026-07-30"),
    maturity_date: new Date("2026-08-30"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    total_loan_profit: 1375,
    investor_share_pct: 60,
    investor_profit: 825,
    rtc_revenue: 550,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — MAN rigid truck.",
  },

  // ── Effort Nyakurerwa Murwisi — IVECO truck ──────────────────────────────────
  {
    loan_no: "MV3/300326/T",
    borrower_name: "Effort Nyakurerwa Murwisi",
    collateral_description: "Rigid Truck IVECO AHF 0113",
    loan_date: new Date("2026-07-30"),
    maturity_date: new Date("2026-08-30"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    total_loan_profit: 1375,
    investor_share_pct: 60,
    investor_profit: 825,
    rtc_revenue: 550,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — IVECO rigid truck (second vehicle for same borrower).",
  },

  // ── Chiedza Sinyoro ──────────────────────────────────────────────────────────
  {
    loan_no: "MV1/190126/T",
    borrower_name: "Chiedza Sinyoro",
    collateral_description: "Mazda 8 — 9001 387057",
    loan_date: new Date("2026-03-21"),
    maturity_date: new Date("2026-04-21"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 1375,
    total_interest_receivable: 343.75,
    total_loan_profit: 343.75,
    investor_share_pct: 60,
    investor_profit: 206.25,
    rtc_revenue: 137.50,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — motor vehicle.",
  },

  // ── Abicia Tavengwa Ushewekunze ──────────────────────────────────────────────
  {
    loan_no: "MV1/100426/T",
    borrower_name: "Abicia Tavengwa Ushewekunze",
    collateral_description: "Toyota Mark 11 AGN 5401",
    loan_date: new Date("2026-04-10"),
    maturity_date: new Date("2026-05-10"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 1100,
    total_interest_receivable: 275,
    total_loan_profit: 275,
    investor_share_pct: 60,
    investor_profit: 165,
    rtc_revenue: 110,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — motor vehicle.",
  },

  // ── Tandabantu Godwin Matanga ────────────────────────────────────────────────
  {
    loan_no: "WP/140126/T",
    borrower_name: "Tandabantu Godwin Matanga",
    collateral_description: "Water Pump — Dore and Pitt / 4300 3 057",
    loan_date: new Date("2026-05-16"),
    maturity_date: new Date("2026-06-16"),
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 1500,
    total_interest_receivable: 375,
    total_loan_profit: 375,
    investor_share_pct: 60,
    investor_profit: 225,
    rtc_revenue: 150,
    collateral_category: "motor_vehicle",
    loan_period_key: "one_month",
    loan_status_override: "Outstanding",
    notes: "Cranbrook direct loan — water pump collateral (categorised as motor_vehicle/equipment).",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // Resolve Cranbrook
  const cranbrook = await Investor.findOne({ name: { $regex: /cranbrook/i } });
  if (!cranbrook) {
    throw new Error(
      '"Cranbrook" investor not found. Please onboard them first via the investor portal.',
    );
  }
  console.log(`Investor : ${cranbrook.name} (${cranbrook._id})\n`);

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const loan of CRANBROOK_LOANS) {
    const tag = `${loan.loan_no} / ${loan.loan_date.toISOString().slice(0, 10)} — ${loan.borrower_name}`;

    // Deduplication: check the compound unique key before attempting to insert.
    const existing = await InvestorLoanAllocation.findOne({
      investor_id: cranbrook._id,
      loan_no: loan.loan_no,
      loan_date: loan.loan_date,
    });

    if (existing) {
      console.log(`  SKIP (already exists): ${tag}`);
      skipped++;
      continue;
    }

    try {
      const alloc = await InvestorLoanAllocation.create({
        investor_id: cranbrook._id,
        loan_id: null,
        loan_no: loan.loan_no,
        ...(loan.collateral_category ? { collateral_category: loan.collateral_category } : {}),
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
          `  Cranbrook=${loan.investor_share_pct}% ($${loan.investor_profit.toLocaleString()})` +
          `  RTC=${100 - loan.investor_share_pct}% ($${loan.rtc_revenue.toLocaleString()})` +
          `  status=${loan.loan_status_override}` +
          `  id=${alloc._id}`,
      );
      created++;
    } catch (err) {
      console.error(`  ERROR: ${tag} — ${err.message}`);
      errors.push({ tag, error: err.message });
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log(`  Created : ${created}`);
  console.log(`  Skipped : ${skipped} (already in DB)`);
  console.log(`  Errors  : ${errors.length}`);
  if (errors.length) {
    console.log("\nFailed rows:");
    errors.forEach((e) => console.log(`  ${e.tag} — ${e.error}`));
  }

  // Print totals for verification
  const all = CRANBROOK_LOANS;
  const totalPrincipal = all.reduce((s, l) => s + l.principal_amount, 0);
  const totalInterest = all.reduce((s, l) => s + l.total_interest_receivable, 0);
  const totalCranbrook = all.reduce((s, l) => s + l.investor_profit, 0);
  const totalRtc = all.reduce((s, l) => s + l.rtc_revenue, 0);
  console.log("\n─── Expected totals (all rows incl. court order) ───");
  console.log(`  Principal      : $${totalPrincipal.toLocaleString()}`);
  console.log(`  Total interest : $${totalInterest.toFixed(2)}`);
  console.log(`  Cranbrook 60%  : $${totalCranbrook.toFixed(2)}`);
  console.log(`  RTC 40%        : $${totalRtc.toFixed(2)}`);

  console.log("\n=== Seed complete ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
