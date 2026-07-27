"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Asset    = require("../models/asset.model");
const Loan     = require("../models/loan.model");
require("../models/user.model");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const asset = await Asset.findOne({ asset_no: "AST26069189" }).lean();
  if (!asset) { console.log("Asset not found"); process.exit(1); }

  console.log("\n── ASSET ──────────────────────────────────");
  console.log(`  asset_no : ${asset.asset_no}`);
  console.log(`  title    : ${asset.title}`);
  console.log(`  status   : ${asset.status}`);
  console.log(`  _id      : ${asset._id}`);

  const loans = await Loan.find({ asset: asset._id })
    .populate("customer_user", "first_name last_name email phone")
    .sort({ created_at: -1 })
    .lean();

  if (!loans.length) { console.log("No loans found for this asset"); process.exit(0); }

  for (const l of loans) {
    const cu = l.customer_user;
    console.log("\n── LOAN ────────────────────────────────────");
    console.log(`  loan_no          : ${l.loan_no}`);
    console.log(`  status           : ${l.status}`);
    console.log(`  principal        : $${l.principal_amount}`);
    console.log(`  current_balance  : $${l.current_balance}`);
    console.log(`  total_paid       : $${l.total_paid}`);
    console.log(`  expected_total   : $${l.expected_total_repayable}`);
    console.log(`  due_date         : ${l.due_date}`);
    console.log(`  penalty_applied  : ${l.repayment_breakdown?.penalty_applied}`);
    console.log(`  penalty_amount   : $${l.repayment_breakdown?.penalty_amount ?? 0}`);
    console.log(`  customer         : ${cu?.first_name} ${cu?.last_name} (${cu?.email})`);
    console.log(`  _id              : ${l._id}`);
  }

  process.exit(0);
}

run().catch(err => { console.error(err.message); process.exit(1); });
