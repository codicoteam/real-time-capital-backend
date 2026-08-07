"use strict";

/**
 * Seed script: Roi Kanner / Cranbrook portfolio – 31 July 2026 debtors list.
 *
 * For each motor-vehicle entry:
 *   - Looks up the asset by registration_no (= asset code from CSV).
 *   - If found → checks for an InvestorLoanAllocation; creates one if missing.
 *   - If not found → creates customer user → asset → loan → allocation.
 *
 * The title-deed entry (Reuben Dziya) is handled via the TitleDeed model only.
 * No images are attached to any record.
 *
 * Run from the backend root:
 *   node scripts/seed_roi_kanner_cranbrook_31jul26.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const Investor = require("../models/investor/investor.model");
const InvestorProfitSplit = require("../models/investor/investor_profit_split.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const TitleDeed = require("../models/investor/title_deed.model");

// ─── CSV data ────────────────────────────────────────────────────────────────
// Dates taken directly from the 31 July 2026 debtors list.
// asset_code = the "ASSET CODE" column → stored as registration_no in the Asset model.

const MOTOR_VEHICLE_LOANS = [
  {
    csv_asset_no: 5,
    borrower: {
      first_name: "Clodius",
      last_name: "Mudzudza",
      phone: "0772471284",
      email: "clodius.mudzudza@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Nissan",
      model: "Extrail",
      asset_code: "MV1/240326/T",  // stored as registration_no
      reg_plate: "AGW 9838",
      declared_value: 880,
    },
    loan: {
      principal_amount: 880,
      interest_amount: 106,
      expected_total_repayable: 986,
      start_date: new Date("2026-03-24"),
      due_date: new Date("2026-04-24"),
      csv_status: "paid_up",
    },
  },
  {
    csv_asset_no: 3,
    borrower: {
      first_name: "Ivy",
      last_name: "Chiwanza",
      phone: "0771183249",
      email: "ivy.chiwanza@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Nissan",
      model: "Note",
      asset_code: "MV1/200326/T",
      reg_plate: "AGY 7185",
      declared_value: 2500,
    },
    loan: {
      principal_amount: 2500,
      interest_amount: 300,
      expected_total_repayable: 2800,
      start_date: new Date("2026-03-20"),
      due_date: new Date("2026-04-20"),
      csv_status: "paid_up",
    },
  },
  {
    csv_asset_no: 1,
    borrower: {
      first_name: "Takunda",
      last_name: "Togarepi",
      phone: "0772977333",
      email: "takunda.togarepi@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Volvo",
      model: "XC60",
      asset_code: "MV1/120326/T",
      reg_plate: "AGX 9697",
      declared_value: 5500,
    },
    loan: {
      principal_amount: 5500,
      interest_amount: 660,
      expected_total_repayable: 6160,
      start_date: new Date("2026-06-12"),
      due_date: new Date("2026-07-12"),
      csv_status: "due",
    },
  },
  {
    csv_asset_no: 2,
    borrower: {
      first_name: "Tinashe",
      last_name: "Chingweya",
      phone: "0771960330",
      email: "tinashe.chingweya@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Toyota",
      model: "Ractis",
      asset_code: "MV1/180326/T",
      reg_plate: "AHI 1137",
      declared_value: 2920,
    },
    loan: {
      principal_amount: 2920,
      interest_amount: 350,
      expected_total_repayable: 3270,
      start_date: new Date("2026-06-18"),
      due_date: new Date("2026-07-18"),
      csv_status: "current",
    },
  },
  {
    csv_asset_no: 6,
    borrower: {
      first_name: "Takudzwa",
      last_name: "Mashumba",
      phone: "0719450331",
      email: "takudzwa.mashumba@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Howo",
      model: "Tipper",
      asset_code: "MV1/300326/T",
      reg_plate: "",
      declared_value: 17000,
    },
    loan: {
      principal_amount: 17000,
      interest_amount: 2040,
      expected_total_repayable: 19040,
      start_date: new Date("2026-06-30"),
      due_date: new Date("2026-07-30"),
      csv_status: "current",
    },
  },
  {
    csv_asset_no: 7,
    borrower: {
      first_name: "Sasha Tatenda Mukumba",
      last_name: "Chaparadza",
      phone: "0773611545",
      email: "sasha.chaparadza@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "BMW",
      model: "320i",
      asset_code: "MV1/210426/T",
      reg_plate: "AEW 7150",
      declared_value: 2500,
    },
    loan: {
      principal_amount: 2500,
      interest_amount: 300,
      expected_total_repayable: 2800,
      start_date: new Date("2026-06-21"),
      due_date: new Date("2026-07-21"),
      csv_status: "due",
    },
  },
  {
    csv_asset_no: 8,
    borrower: {
      first_name: "Anold",
      last_name: "Chaeruka",
      phone: "0772940307",
      email: "anold.chaeruka@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Isuzu",
      model: "FVR900",
      asset_code: "MV1/240626/T",
      reg_plate: "ABP 7051",
      declared_value: 4500,
    },
    loan: {
      principal_amount: 4500,
      interest_amount: 540,
      expected_total_repayable: 5040,
      start_date: new Date("2026-06-24"),
      due_date: new Date("2026-07-24"),
      csv_status: "current",
    },
  },
  {
    csv_asset_no: 9,
    borrower: {
      first_name: "Oren",
      last_name: "Rukwava",
      phone: "0772759945",
      email: "oren.rukwava@customer.rtcapital.co.zw",
      location: "HARARE",
    },
    asset: {
      make: "Komatsu",
      model: "Front Loader",
      asset_code: "MV1/310726/T",
      reg_plate: "N/A",
      declared_value: 10000,
    },
    loan: {
      principal_amount: 10000,
      interest_amount: 1200,
      expected_total_repayable: 11200,
      start_date: new Date("2026-07-31"),
      due_date: new Date("2026-08-31"),
      csv_status: "current",
    },
  },
];

const TITLE_DEED = {
  borrower: {
    first_name: "Reuben",
    last_name: "Dziya",
    phone: "0772403799",
  },
  deed: {
    deed_number: "TD1/230326/T",
    property_name: "Avonlea",
    property_address: "Avonlea, Harare",
    property_description: "Title deed – Avonlea property, Harare",
    loan_amount: 18200,
    interest_rate: 12,
    loan_term_months: 1,
    start_date: new Date("2026-04-23"),
    end_date: new Date("2026-05-23"),
    csv_status: "due",
  },
};

// ─── Status mappers ──────────────────────────────────────────────────────────

function loanStatus(csvStatus) {
  if (csvStatus === "paid_up") return "redeemed";
  if (csvStatus === "due")     return "overdue";
  return "active";
}

function assetStatus(csvStatus) {
  if (csvStatus === "paid_up") return "redeemed";
  if (csvStatus === "due")     return "overdue";
  return "pawned";
}

function allocationStatus(csvStatus) {
  return csvStatus === "paid_up" ? "completed" : "active";
}

// TitleDeed model has no "overdue" — map "due" to "active"
function titleDeedStatus(csvStatus) {
  return csvStatus === "paid_up" ? "completed" : "active";
}

// ─── ID generators ────────────────────────────────────────────────────────────

function genLoanNo() {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  return `LON${yy}${mm}${Math.floor(1000 + Math.random() * 9000)}`;
}

function genAssetNo() {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  return `AST${yy}${mm}${Math.floor(1000 + Math.random() * 9000)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // 1. Resolve Roi Kanner
  const investor = await Investor.findOne({ name: { $regex: /roi\s*kanner/i } });
  if (!investor) throw new Error('"Roi Kanner" not found in investors. Please onboard them first.');
  console.log(`Investor : ${investor.name} (${investor._id})\n`);

  // 2. Global profit split for one_month
  const globalSplit = await InvestorProfitSplit.findOne({});
  if (!globalSplit) throw new Error("No global InvestorProfitSplit config found.");

  const investorSharePct =
    investor.profit_share_override?.one_month != null
      ? investor.profit_share_override.one_month
      : globalSplit.one_month.investor_share;

  console.log(`Profit share (one_month): ${investorSharePct}%\n`);

  // ── Motor-vehicle loans ─────────────────────────────────────────────────────

  for (const entry of MOTOR_VEHICLE_LOANS) {
    const { borrower, asset: ad, loan: ld } = entry;
    console.log(`──── Asset #${entry.csv_asset_no}: ${borrower.first_name} ${borrower.last_name} ────`);

    // Check if asset already exists (asset_code stored as registration_no)
    const existingAsset = await Asset.findOne({ registration_no: ad.asset_code });

    if (existingAsset) {
      console.log(`  Asset exists : ${existingAsset.title || ad.make + " " + ad.model} (${existingAsset._id})`);

      const existingLoan = await Loan.findOne({ asset: existingAsset._id });
      if (!existingLoan) {
        console.log("  WARNING: Asset found but no loan attached — skipping.\n");
        continue;
      }
      console.log(`  Loan exists  : ${existingLoan.loan_no} — status: ${existingLoan.status}`);

      const existingAlloc = await InvestorLoanAllocation.findOne({ loan_id: existingLoan._id });
      if (existingAlloc) {
        const sameInvestor = existingAlloc.investor_id.toString() === investor._id.toString();
        console.log(
          `  Allocation exists (${existingAlloc._id}) — investor match: ${sameInvestor ? "YES ✓" : "NO ✗ (different investor)"}`
        );
        if (!sameInvestor) {
          console.log("  Updating allocation investor_id to Roi Kanner.");
          await InvestorLoanAllocation.findByIdAndUpdate(existingAlloc._id, { investor_id: investor._id });
        }
        console.log();
        continue;
      }

      // No allocation — create one using the loan's actual financials
      const totalProfit = existingLoan.expected_total_repayable - existingLoan.principal_amount;
      const investorProfit = parseFloat(((totalProfit * investorSharePct) / 100).toFixed(2));
      const rtcRevenue = parseFloat((totalProfit - investorProfit).toFixed(2));
      const allocSt = allocationStatus(ld.csv_status);

      const alloc = await InvestorLoanAllocation.create({
        investor_id: investor._id,
        loan_id: existingLoan._id,
        loan_no: existingLoan.loan_no,
        collateral_category: existingLoan.collateral_category,
        loan_period_key: "one_month",
        principal_amount: existingLoan.principal_amount,
        total_loan_profit: totalProfit,
        investor_share_pct: investorSharePct,
        investor_profit: investorProfit,
        rtc_revenue: rtcRevenue,
        status: allocSt,
        completed_at: allocSt === "completed" ? existingLoan.due_date : null,
        notes: "Allocated to Roi Kanner – Cranbrook debtors list 31 Jul 2026.",
      });
      console.log(`  Created allocation (${alloc._id}) — status: ${allocSt}, investor profit: $${investorProfit}\n`);
      continue;
    }

    // ── Asset does not exist — create full chain ────────────────────────────
    console.log("  Not found — creating user → asset → loan → allocation.");

    // Customer user
    let user = await User.findOne({
      $or: [{ phone: borrower.phone }, { email: borrower.email }],
    });
    if (user) {
      console.log(`  User exists  : ${user.first_name} ${user.last_name} (${user._id})`);
    } else {
      user = await User.create({
        email: borrower.email,
        phone: borrower.phone,
        first_name: borrower.first_name,
        last_name: borrower.last_name,
        full_name: `${borrower.first_name} ${borrower.last_name}`,
        location: borrower.location,
        roles: ["customer"],
        status: "active",
        kyc_verification_status: "verified",
      });
      console.log(`  Created user : ${user.first_name} ${user.last_name} (${user._id})`);
    }

    const loanSt  = loanStatus(ld.csv_status);
    const assetSt = assetStatus(ld.csv_status);
    const allocSt = allocationStatus(ld.csv_status);
    const isPaidUp = ld.csv_status === "paid_up";

    // Asset
    const assetDoc = await Asset.create({
      asset_type: "motor_vehicle",
      asset_no: genAssetNo(),
      owner_user: user._id,
      submitted_by: user._id,
      category: "motor_vehicle",
      title: `${ad.make} ${ad.model}`,
      description: `${ad.make} ${ad.model}${ad.reg_plate && ad.reg_plate !== "N/A" && ad.reg_plate !== "" ? " — " + ad.reg_plate : ""}`,
      condition: "good",
      declared_value: ad.declared_value,
      evaluated_value: ad.declared_value,
      status: assetSt,
      storage_location: borrower.location,
      make: ad.make,
      model: ad.model,
      registration_no: ad.asset_code,
      ...(ad.reg_plate && ad.reg_plate !== "N/A" && ad.reg_plate !== ""
        ? { cc_serial_no: ad.reg_plate }
        : {}),
      asset_images: [],
    });
    console.log(`  Created asset: ${assetDoc.title} (${assetDoc._id})`);

    // Loan
    const loanNo = genLoanNo();
    const loan = await Loan.create({
      loan_no: loanNo,
      customer_user: user._id,
      asset: assetDoc._id,
      collateral_category: "motor_vehicle",
      principal_amount: ld.principal_amount,
      current_balance: isPaidUp ? 0 : ld.expected_total_repayable,
      currency: "USD",
      loan_period_type: "one_month",
      interest_rate_percent: 12,
      interest_period_days: 30,
      storage_charge_percent: 0,
      storage_charge_amount: 0,
      penalty_percent: 10,
      grace_days: 7,
      interest_amount: ld.interest_amount,
      expected_total_repayable: ld.expected_total_repayable,
      repayment_type: "once_off",
      disbursement_date: ld.start_date,
      payment_method: "cash",
      start_date: ld.start_date,
      due_date: ld.due_date,
      payments: [],
      total_paid: isPaidUp ? ld.expected_total_repayable : 0,
      status: loanSt,
      approval_status: "approved",
    });
    console.log(`  Created loan : ${loan.loan_no} (${loan._id}) — status: ${loan.status}`);

    // Back-link asset → loan
    await Asset.findByIdAndUpdate(assetDoc._id, { active_loan: loan._id });

    // Investor allocation
    const totalProfit = ld.expected_total_repayable - ld.principal_amount;
    const investorProfit = parseFloat(((totalProfit * investorSharePct) / 100).toFixed(2));
    const rtcRevenue = parseFloat((totalProfit - investorProfit).toFixed(2));

    const alloc = await InvestorLoanAllocation.create({
      investor_id: investor._id,
      loan_id: loan._id,
      loan_no: loanNo,
      collateral_category: "motor_vehicle",
      loan_period_key: "one_month",
      principal_amount: ld.principal_amount,
      total_loan_profit: totalProfit,
      investor_share_pct: investorSharePct,
      investor_profit: investorProfit,
      rtc_revenue: rtcRevenue,
      status: allocSt,
      completed_at: allocSt === "completed" ? ld.due_date : null,
      notes: "Seeded from Cranbrook/Roi Kanner debtors list 31 Jul 2026.",
    });
    console.log(`  Created alloc: (${alloc._id}) — status: ${allocSt}, investor profit: $${investorProfit}\n`);
  }

  // ── Title deed (Reuben Dziya) ───────────────────────────────────────────────

  console.log(`──── Title Deed: ${TITLE_DEED.borrower.first_name} ${TITLE_DEED.borrower.last_name} ────`);
  const { deed, borrower: tdBorrower } = TITLE_DEED;

  const existingDeed = await TitleDeed.findOne({ deed_number: deed.deed_number });

  if (existingDeed) {
    console.log(`  TitleDeed exists: ${existingDeed.deed_number} (${existingDeed._id})`);
    const sameInvestor = existingDeed.investor_id.toString() === investor._id.toString();
    if (!sameInvestor) {
      await TitleDeed.findByIdAndUpdate(existingDeed._id, { investor_id: investor._id });
      console.log("  Updated investor_id to Roi Kanner.");
    } else {
      console.log("  Already assigned to Roi Kanner. Nothing to do.");
    }
  } else {
    const deedDoc = await TitleDeed.create({
      deed_number: deed.deed_number,
      investor_id: investor._id,
      property_name: deed.property_name,
      property_address: deed.property_address,
      property_description: deed.property_description,
      loan_amount: deed.loan_amount,
      interest_rate: deed.interest_rate,
      loan_term_months: deed.loan_term_months,
      start_date: deed.start_date,
      end_date: deed.end_date,
      status: titleDeedStatus(deed.csv_status),
      borrower_name: `${tdBorrower.first_name} ${tdBorrower.last_name}`,
      borrower_phone: tdBorrower.phone,
      documents: [],
      notes: "Seeded from Cranbrook/Roi Kanner debtors list 31 Jul 2026.",
    });
    console.log(`  Created TitleDeed: ${deedDoc.deed_number} (${deedDoc._id}) — status: ${deedDoc.status}`);
  }

  console.log("\n=== Seed complete ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
