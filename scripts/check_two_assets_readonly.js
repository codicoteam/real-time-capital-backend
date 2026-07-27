"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Asset = require("../models/asset.model");
const Loan = require("../models/loan.model");
const Auction = require("../models/auction.model");

async function inspect(assetNo) {
  console.log(`\n===== ${assetNo} =====`);
  const asset = await Asset.findOne({ asset_no: assetNo }).lean();
  if (!asset) { console.log("  Asset not found"); return; }
  console.log(`  asset._id    : ${asset._id}`);
  console.log(`  asset.title  : ${asset.title}`);
  console.log(`  asset.status : ${asset.status}`);
  console.log(`  active_loan  : ${asset.active_loan}`);

  const loans = await Loan.find({ asset: asset._id }).sort({ created_at: -1 }).lean();
  for (const l of loans) {
    console.log(`\n  LOAN ${l.loan_no}`);
    console.log(`    status           : ${l.status}`);
    console.log(`    principal        : $${l.principal_amount}`);
    console.log(`    current_balance  : $${l.current_balance}`);
    console.log(`    total_paid       : $${l.total_paid}`);
    console.log(`    expected_total   : $${l.expected_total_repayable}`);
    console.log(`    due_date         : ${l.due_date}`);
    console.log(`    is_rollover      : ${l.is_rollover}  rollover_of=${l.rollover_of} rolled_over_to=${l.rolled_over_to}`);
    console.log(`    payments (${(l.payments||[]).length}):`);
    for (const p of (l.payments || [])) {
      console.log(`      - $${p.amount}  ${p.status}  ${p.payment_method}  ${p.payment_date}  ref=${p.reference_no}  notes=${p.notes}`);
    }
    console.log(`    status_history:`);
    for (const s of (l.status_history || [])) {
      console.log(`      - ${s.from} -> ${s.to}  @${s.changed_at}  notes=${s.notes}`);
    }
  }

  const auctions = await Auction.find({ asset: asset._id }).lean();
  for (const a of auctions) {
    console.log(`\n  AUCTION ${a.auction_no}  status=${a.status}  id=${a._id}  starting=${a.starting_price} reserve=${a.reserve_price}`);
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  await inspect("AST26069870");
  await inspect("AST26079763");
  await mongoose.disconnect();
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
