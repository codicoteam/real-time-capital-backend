"use strict";

/**
 * Seed script: creates Oren Rukwava's active loan (no application required).
 *
 * Run from the backend root:
 *   node scripts/seed_oren_rukwava_loan.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const Investor = require("../models/investor/investor.model");
const InvestorProfitSplit = require("../models/investor/investor_profit_split.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

// ── Loan details ────────────────────────────────────────────────────────────
const LOAN_DATA = {
  borrower: {
    first_name: "Oren",
    last_name: "Rukwava",
    phone: "0772759945",
    location: "HARARE",
    // Placeholder email — adjust if you have the real one
    email: "oren.rukwava@customer.rtcapital.co.zw",
  },
  asset: {
    category: "motor_vehicle",
    title: "Komatsu Front Loader",
    make: "Komatsu",
    model: "Front Loader",
    registration_no: "MV1/310726/T",
    declared_value: 10000,
    evaluated_value: 10000,
    status: "pawned",
    storage_location: "HARARE",
    description: "Komatsu Front Loader – insurance: N/A",
    condition: "good",
  },
  loan: {
    collateral_category: "motor_vehicle",
    principal_amount: 10000,
    interest_amount: 1200,
    storage_charge_amount: 0,
    expected_total_repayable: 11200,
    current_balance: 11200,
    total_paid: 0,
    currency: "USD",
    loan_period_type: "one_month",
    interest_rate_percent: 12,
    interest_period_days: 30,
    storage_charge_percent: 0,
    penalty_percent: 10,
    grace_days: 7,
    repayment_type: "once_off",
    start_date: new Date("2026-07-31"),
    due_date: new Date("2026-08-31"),
    disbursement_date: new Date("2026-07-31"),
    payment_method: "cash",
    status: "active",
    approval_status: "approved",
  },
  investor_name: "Roi Kanner",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateLoanNo() {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `LON${yy}${mm}${rand}`;
}

function generateAssetNo() {
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `AST${yy}${mm}${rand}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB");

  // 1. Find or create customer user
  let customerUser = await User.findOne({
    $or: [
      { email: LOAN_DATA.borrower.email },
      { phone: LOAN_DATA.borrower.phone },
    ],
  });

  if (customerUser) {
    console.log(`Found existing user: ${customerUser.first_name} ${customerUser.last_name} (${customerUser._id})`);
  } else {
    customerUser = await User.create({
      email: LOAN_DATA.borrower.email,
      phone: LOAN_DATA.borrower.phone,
      first_name: LOAN_DATA.borrower.first_name,
      last_name: LOAN_DATA.borrower.last_name,
      full_name: `${LOAN_DATA.borrower.first_name} ${LOAN_DATA.borrower.last_name}`,
      location: LOAN_DATA.borrower.location,
      roles: ["customer"],
      status: "active",
      kyc_verification_status: "verified",
    });
    console.log(`Created customer user: ${customerUser.first_name} ${customerUser.last_name} (${customerUser._id})`);
  }

  // 2. Find Roi Kanner investor
  const investor = await Investor.findOne({
    name: { $regex: /roi\s*kanner/i },
  });

  if (!investor) {
    throw new Error('Investor "Roi Kanner" not found in the database. Please ensure they have been onboarded first.');
  }
  console.log(`Found investor: ${investor.name} (${investor._id})`);

  // 3. Resolve investor profit share for one_month
  let investorSharePct;

  if (investor.profit_share_override && investor.profit_share_override.one_month != null) {
    investorSharePct = investor.profit_share_override.one_month;
    console.log(`Using investor override profit share: ${investorSharePct}% (one_month)`);
  } else {
    const globalSplit = await InvestorProfitSplit.findOne({});
    if (!globalSplit) {
      throw new Error("No global InvestorProfitSplit config found. Please configure it first.");
    }
    investorSharePct = globalSplit.one_month.investor_share;
    console.log(`Using global profit share: ${investorSharePct}% (one_month)`);
  }

  const totalLoanProfit = LOAN_DATA.loan.expected_total_repayable - LOAN_DATA.loan.principal_amount;
  const investorProfit = parseFloat(((totalLoanProfit * investorSharePct) / 100).toFixed(2));
  const rtcRevenue = parseFloat((totalLoanProfit - investorProfit).toFixed(2));

  console.log(`Profit split — total: $${totalLoanProfit}, investor (${investorSharePct}%): $${investorProfit}, RTC: $${rtcRevenue}`);

  // 4. Create asset
  const assetNo = generateAssetNo();
  const asset = await Asset.create({
    asset_type: "motor_vehicle",
    asset_no: assetNo,
    owner_user: customerUser._id,
    submitted_by: customerUser._id,
    category: LOAN_DATA.asset.category,
    title: LOAN_DATA.asset.title,
    description: LOAN_DATA.asset.description,
    condition: LOAN_DATA.asset.condition,
    declared_value: LOAN_DATA.asset.declared_value,
    evaluated_value: LOAN_DATA.asset.evaluated_value,
    status: LOAN_DATA.asset.status,
    storage_location: LOAN_DATA.asset.storage_location,
    make: LOAN_DATA.asset.make,
    model: LOAN_DATA.asset.model,
    registration_no: LOAN_DATA.asset.registration_no,
    asset_images: [],
  });
  console.log(`Created asset: ${asset.title} — ${asset.registration_no} (${asset._id})`);

  // 5. Create loan
  const loanNo = generateLoanNo();
  const loan = await Loan.create({
    loan_no: loanNo,
    customer_user: customerUser._id,
    asset: asset._id,
    collateral_category: LOAN_DATA.loan.collateral_category,
    principal_amount: LOAN_DATA.loan.principal_amount,
    current_balance: LOAN_DATA.loan.current_balance,
    currency: LOAN_DATA.loan.currency,
    loan_period_type: LOAN_DATA.loan.loan_period_type,
    interest_rate_percent: LOAN_DATA.loan.interest_rate_percent,
    interest_period_days: LOAN_DATA.loan.interest_period_days,
    storage_charge_percent: LOAN_DATA.loan.storage_charge_percent,
    penalty_percent: LOAN_DATA.loan.penalty_percent,
    grace_days: LOAN_DATA.loan.grace_days,
    interest_amount: LOAN_DATA.loan.interest_amount,
    storage_charge_amount: LOAN_DATA.loan.storage_charge_amount,
    expected_total_repayable: LOAN_DATA.loan.expected_total_repayable,
    repayment_type: LOAN_DATA.loan.repayment_type,
    disbursement_date: LOAN_DATA.loan.disbursement_date,
    payment_method: LOAN_DATA.loan.payment_method,
    start_date: LOAN_DATA.loan.start_date,
    due_date: LOAN_DATA.loan.due_date,
    payments: [],
    total_paid: LOAN_DATA.loan.total_paid,
    status: LOAN_DATA.loan.status,
    approval_status: LOAN_DATA.loan.approval_status,
    // No application field — intentionally omitted
  });
  console.log(`Created loan: ${loan.loan_no} (${loan._id}) — status: ${loan.status}`);

  // 6. Link asset back to loan
  await Asset.findByIdAndUpdate(asset._id, { active_loan: loan._id });

  // 7. Create investor loan allocation
  const allocation = await InvestorLoanAllocation.create({
    investor_id: investor._id,
    loan_id: loan._id,
    loan_no: loanNo,
    collateral_category: LOAN_DATA.loan.collateral_category,
    loan_period_key: "one_month",
    principal_amount: LOAN_DATA.loan.principal_amount,
    total_loan_profit: totalLoanProfit,
    investor_share_pct: investorSharePct,
    investor_profit: investorProfit,
    rtc_revenue: rtcRevenue,
    status: "active",
    notes: `Manually seeded loan for Oren Rukwava. Registration: ${LOAN_DATA.asset.registration_no}`,
  });
  console.log(`Created investor allocation (${allocation._id}) — investor: $${investorProfit}, RTC: $${rtcRevenue}`);

  console.log("\n=== Done ===");
  console.log(`Borrower  : ${customerUser.first_name} ${customerUser.last_name}`);
  console.log(`Asset     : ${asset.title} — ${asset.registration_no}`);
  console.log(`Loan No   : ${loan.loan_no}`);
  console.log(`Investor  : ${investor.name}`);
  console.log(`Start     : ${loan.start_date.toISOString().split("T")[0]}`);
  console.log(`Due       : ${loan.due_date.toISOString().split("T")[0]}`);
  console.log(`Balance   : $${loan.current_balance}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
