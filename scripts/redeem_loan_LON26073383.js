"use strict";

/**
 * One-off: Mark LON26073383 (Lenovo laptop AST26069189) as redeemed.
 * Customer: Tatenda Edson Junior Tembo
 * Payment  : $105 (after grace penalty)
 */

require("dotenv").config();
const mongoose = require("mongoose");

require("../models/user.model");
const Loan    = require("../models/loan.model");
const Asset   = require("../models/asset.model");
const Auction = require("../models/auction.model");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.");

  const LOAN_ID  = "6a555b381ae028c7c96a9e1b";
  const ASSET_ID = "6a353f82e3cec2b0d590045c";
  const PAYMENT  = 105;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const loan = await Loan.findById(LOAN_ID).session(session);
    if (!loan) throw new Error("Loan not found");

    // 1. Cancel any active auction for this asset
    const cancelResult = await Auction.updateMany(
      { asset: ASSET_ID, status: { $in: ["draft", "live"] } },
      { $set: { status: "cancelled" } },
      { session },
    );
    console.log(`Auctions cancelled: ${cancelResult.modifiedCount}`);

    // 2. Record the payment and mark loan as redeemed
    const paymentRecord = {
      amount        : PAYMENT,
      payment_date  : new Date(),
      payment_method: "cash",
      status        : "paid",
      reference_no  : `MANUAL-REDEEM-${Date.now()}`,
      notes         : "Paid after grace period penalty — manual correction",
    };

    await Loan.findByIdAndUpdate(
      LOAN_ID,
      {
        $set: {
          status         : "redeemed",
          current_balance: 0,
          total_paid     : PAYMENT,
          updated_at     : new Date(),
        },
        $push: {
          payments: paymentRecord,
          status_history: {
            from      : loan.status,
            to        : "redeemed",
            changed_at: new Date(),
            notes     : `Manual correction: paid $${PAYMENT} after penalty`,
          },
        },
      },
      { session },
    );

    // 3. Free the asset
    await Asset.findByIdAndUpdate(
      ASSET_ID,
      {
        $set  : { status: "redeemed" },
        $unset: { active_loan: "" },
      },
      { session },
    );

    await session.commitTransaction();

    console.log("\n✅ Done!");
    console.log(`  Loan     : LON26073383`);
    console.log(`  Customer : Tatenda Edson Junior Tembo`);
    console.log(`  Asset    : AST26069189 (Lenovo laptop)`);
    console.log(`  Payment  : $${PAYMENT}`);
    console.log(`  Status   : redeemed`);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
    process.exit(0);
  }
}

run().catch(err => { console.error("❌", err.message); process.exit(1); });
