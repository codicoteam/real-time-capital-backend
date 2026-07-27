/**
 * One-off script: rollover Samantha Chimuchere's loan.
 *
 * Target new loan values (exactly as specified):
 *   Principal : $440
 *   Total due : $528  (20% of $440 = $88 — matches two_weeks: 2% interest + 18% storage)
 *   Due date  : 16 July 2026
 *   Start date: 02 July 2026  (14-day two_weeks period → 02 Jul + 14 = 16 Jul ✓)
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Loan           = require("../models/loan.model");
const Asset          = require("../models/asset.model");
const Auction        = require("../models/auction.model");
const LoanApplication = require("../models/loanApplication.model");
const User           = require("../models/user.model");
const { LOAN_PERIODS } = require("../configs/loan_periods");

// ── Target ──────────────────────────────────────────────────────────────────
const FIRST_NAME     = "Samantha";
const LAST_NAME      = "Chimuchere";

const ROLLOVER_START = new Date("2026-07-02T00:00:00.000Z");
const DUE_DATE       = new Date("2026-07-16T00:00:00.000Z");

// Exact values the user specified — verified against two_weeks rates below
const NEW_PRINCIPAL  = 440;
const INTEREST       = parseFloat((NEW_PRINCIPAL * 0.02).toFixed(2));   // $8.80
const STORAGE        = parseFloat((NEW_PRINCIPAL * 0.18).toFixed(2));   // $79.20
const NEW_TOTAL      = 528;  // $440 + $88 = $528 ✓

const PAYMENT_METHOD = "cash";
const SCRIPT_NOTE    = "Rollover processed retroactively — principal $440, total $528, due 16 Jul 2026";

// ── Helper: generate loan number ─────────────────────────────────────────────
function generateLoanNo() {
  const d   = new Date();
  const yy  = d.getFullYear().toString().slice(-2);
  const mm  = (d.getMonth() + 1).toString().padStart(2, "0");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `LON${yy}${mm}${rnd}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  // ── 1. Find Samantha ───────────────────────────────────────────────────────
  const user = await User.findOne({
    first_name: { $regex: new RegExp(`^${FIRST_NAME}$`, "i") },
    last_name:  { $regex: new RegExp(`^${LAST_NAME}$`,  "i") },
  });
  if (!user) throw new Error(`Customer not found: ${FIRST_NAME} ${LAST_NAME}`);
  console.log(`✔ Customer: ${user._id}  (${user.email || user.phone || "no contact"})`);

  // ── 2. Find her eligible open loan ────────────────────────────────────────
  const eligibleStatuses = ["auction", "in_grace", "overdue", "active", "partially_paid"];
  const loans = await Loan.find({
    customer_user: user._id,
    status: { $in: eligibleStatuses },
  }).populate("asset").sort({ created_at: -1 });

  if (loans.length === 0) throw new Error(`No eligible open loan found for ${FIRST_NAME} ${LAST_NAME}`);
  const oldLoan = loans[0];
  const asset   = oldLoan.asset;

  console.log(`✔ Old loan : ${oldLoan.loan_no}  status=${oldLoan.status}`);
  console.log(`  balance=$${oldLoan.current_balance}  principal=$${oldLoan.principal_amount}`);
  if (asset) console.log(`✔ Asset    : ${asset.asset_no} – ${asset.title}  status=${asset.status}`);

  // ── 3. Derive the payment that zeros the old balance ──────────────────────
  //    We record as a payment whatever was owed on the old loan above the new principal.
  //    This clears the old balance; the new loan starts clean at $440/$528.
  const paymentOnOldLoan = parseFloat(
    Math.max(0, oldLoan.current_balance - NEW_PRINCIPAL).toFixed(2)
  );
  console.log(`\n✔ Payment recorded on old loan: $${paymentOnOldLoan}`);
  console.log(`✔ New loan → principal=$${NEW_PRINCIPAL}  interest=$${INTEREST}  storage=$${STORAGE}  total=$${NEW_TOTAL}`);
  console.log(`✔ New loan → start=${ROLLOVER_START.toDateString()}  due=${DUE_DATE.toDateString()}`);

  const loanPeriodType = oldLoan.loan_period_type || "two_weeks";
  const period         = LOAN_PERIODS[loanPeriodType] || LOAN_PERIODS["two_weeks"];

  // ── 4. Sanity-check the two_weeks rate matches our target values ───────────
  const expectedInterest = parseFloat((NEW_PRINCIPAL * (period.interest_rate_percent / 100)).toFixed(2));
  const expectedStorage  = parseFloat((NEW_PRINCIPAL * (period.storage_charge_percent / 100)).toFixed(2));
  const expectedTotal    = parseFloat((NEW_PRINCIPAL + expectedInterest + expectedStorage).toFixed(2));
  if (Math.abs(expectedTotal - NEW_TOTAL) > 0.01) {
    console.warn(`\n⚠ Rate mismatch warning:`);
    console.warn(`  Period '${loanPeriodType}' gives total $${expectedTotal}, not $${NEW_TOTAL}.`);
    console.warn(`  Proceeding with hardcoded $${NEW_TOTAL} as instructed.`);
  } else {
    console.log(`✔ Rate check: ${loanPeriodType} @ ${period.interest_rate_percent}% int + ${period.storage_charge_percent}% storage → $${expectedTotal} ✓`);
  }

  // ── 5. Transaction ────────────────────────────────────────────────────────
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 5a. Cancel any live auction
    if (oldLoan.status === "auction" || (asset && asset.status === "auction")) {
      const cancelled = await Auction.findOneAndUpdate(
        { asset: asset._id || oldLoan.asset, status: { $in: ["draft", "live"] } },
        { $set: { status: "cancelled" } },
        { session, new: true },
      );
      console.log(cancelled
        ? `✔ Auction cancelled: ${cancelled.auction_no}`
        : `⚠ No live auction found for this asset`);
    }

    // 5b. Record payment on old loan and close it
    if (paymentOnOldLoan > 0) {
      oldLoan.payments.push({
        amount:         paymentOnOldLoan,
        payment_date:   ROLLOVER_START,
        payment_method: PAYMENT_METHOD,
        status:         "paid",
        reference_no:   `ROLLOVER-16JUL26-${Date.now()}`,
        notes:          SCRIPT_NOTE,
      });
      oldLoan.total_paid = parseFloat((oldLoan.total_paid + paymentOnOldLoan).toFixed(2));
    }
    oldLoan.current_balance = 0;
    oldLoan.status          = "rolled_over";
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 5c. Create new loan with exact specified values
    const repayment_breakdown = {
      principal_amount:         NEW_PRINCIPAL,
      loan_period_days:         period.days,
      interest_period_days:     period.days,
      number_of_periods:        1,
      interest_rate_percent:    period.interest_rate_percent,
      interest_amount:          INTEREST,
      storage_charge_percent:   period.storage_charge_percent,
      storage_charge_amount:    STORAGE,
      expected_total_repayable: NEW_TOTAL,
      carried_forward_arrears:  0,
      calculation_note:         "Principal $440 + Interest $8.80 + Storage $79.20 = Total $528",
    };

    const [newLoan] = await Loan.create(
      [
        {
          loan_no:                  generateLoanNo(),
          customer_user:            oldLoan.customer_user,
          application:              oldLoan.application,
          asset:                    asset._id || oldLoan.asset,
          collateral_category:      oldLoan.collateral_category,
          principal_amount:         NEW_PRINCIPAL,
          currency:                 oldLoan.currency || "USD",
          loan_period_type:         loanPeriodType,
          interest_rate_percent:    period.interest_rate_percent,
          storage_charge_percent:   period.storage_charge_percent,
          interest_period_days:     period.days,
          penalty_percent:          period.penalty_percent,
          grace_days:               period.grace_days,
          repayment_type:           "once_off",
          start_date:               ROLLOVER_START,
          due_date:                 DUE_DATE,
          interest_amount:          INTEREST,
          storage_charge_amount:    STORAGE,
          expected_total_repayable: NEW_TOTAL,
          current_balance:          NEW_TOTAL,
          repayment_breakdown,
          status:                   "active",
          disbursement_date:        ROLLOVER_START,
          disbursement_notes:       `Rollover — no new funds disbursed; renewed from loan ${oldLoan.loan_no}`,
          approval_status:          "approved",
          requires_super_admin_approval: NEW_PRINCIPAL > 500,
          is_rollover:              true,
          rollover_of:              oldLoan._id,
          root_loan:                oldLoan.root_loan || oldLoan._id,
          rollover_generation:      (oldLoan.rollover_generation || 0) + 1,
          carried_forward_arrears:  0,
          rollover_payment_amount:  paymentOnOldLoan,
          rollover_notes:           SCRIPT_NOTE,
        },
      ],
      { session },
    );

    // 5d. Back-link old loan to new
    oldLoan.rolled_over_to = newLoan._id;
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 5e. Move asset onto new loan
    await Asset.findByIdAndUpdate(
      asset._id || oldLoan.asset,
      { status: "pawned", active_loan: newLoan._id },
      { session },
    );

    // 5f. Update loan application pointer
    if (oldLoan.application) {
      await LoanApplication.findByIdAndUpdate(
        oldLoan.application,
        { $set: { loan_id: newLoan._id, loan_created: true, status: "loan_created" } },
        { session },
      );
    }

    await session.commitTransaction();

    console.log(`\n✅ OLD loan ${oldLoan.loan_no}  →  status: rolled_over`);
    console.log(`✅ NEW loan ${newLoan.loan_no}`);
    console.log(`   principal : $${NEW_PRINCIPAL}`);
    console.log(`   total due : $${NEW_TOTAL}`);
    console.log(`   start     : ${ROLLOVER_START.toDateString()}`);
    console.log(`   due date  : ${DUE_DATE.toDateString()}`);
    console.log(`   balance   : $${newLoan.current_balance}`);

  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
