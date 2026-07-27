/**
 * One-off script: rollover the Dell laptop loan (asset AST26079763).
 *
 * Client pays INTEREST ONLY — full interest + storage owed above the principal.
 * Principal carries forward unchanged. No arrears.
 *
 * Rollover start : 2026-07-31 (current due date — interest paid on this date)
 * New due date   : 2026-07-31 + loan_period_type days (auto-computed)
 */

"use strict";

require("dotenv").config();
const mongoose        = require("mongoose");
const Loan            = require("../models/loan.model");
const Asset           = require("../models/asset.model");
const Auction         = require("../models/auction.model");
const LoanApplication = require("../models/loanApplication.model");
const { LOAN_PERIODS } = require("../configs/loan_periods");

// ── Config ────────────────────────────────────────────────────────────────────
const ASSET_NO       = "AST26079763";
const ROLLOVER_START = new Date("2026-07-31T00:00:00.000Z");
const PAYMENT_METHOD = "cash";
const SCRIPT_NOTE    = "Rollover processed — client paid interest only; principal carried forward; due date extended";

// ── Helper: generate loan number ──────────────────────────────────────────────
function generateLoanNo() {
  const d   = new Date();
  const yy  = d.getFullYear().toString().slice(-2);
  const mm  = (d.getMonth() + 1).toString().padStart(2, "0");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `LON${yy}${mm}${rnd}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.\n");

  // 1. Find asset by asset_no
  const asset = await Asset.findOne({ asset_no: ASSET_NO });
  if (!asset) throw new Error(`Asset not found: ${ASSET_NO}`);
  console.log(`✔ Asset    : ${asset.asset_no} – ${asset.title}  status=${asset.status}`);

  // 2. Find the active loan for this asset
  const eligibleStatuses = ["active", "overdue", "in_grace", "partially_paid", "auction"];
  const oldLoan = await Loan.findOne({
    asset:  asset._id,
    status: { $in: eligibleStatuses },
  }).sort({ created_at: -1 });

  if (!oldLoan) throw new Error(`No eligible open loan found for asset ${ASSET_NO}`);
  console.log(`✔ Old loan : ${oldLoan.loan_no}  status=${oldLoan.status}`);
  console.log(`  principal=$${oldLoan.principal_amount}  balance=$${oldLoan.current_balance}  period=${oldLoan.loan_period_type}`);

  // 3. Resolve period rates
  const loanPeriodType = oldLoan.loan_period_type || "two_weeks";
  const period         = LOAN_PERIODS[loanPeriodType];
  if (!period) throw new Error(`Unknown loan_period_type: ${loanPeriodType}`);

  // 4. Interest-only: client pays exactly what is owed above the principal
  const owedAbovePrincipal = parseFloat(
    Math.max(0, oldLoan.current_balance - oldLoan.principal_amount).toFixed(2),
  );
  const interestOnlyPayment = owedAbovePrincipal; // the exact interest + storage amount
  const newPrincipal        = oldLoan.principal_amount;

  // 5. New loan dates
  const newDueDate = new Date(ROLLOVER_START);
  newDueDate.setDate(newDueDate.getDate() + period.days);

  // 6. New loan charges
  const newInterest = parseFloat((newPrincipal * (period.interest_rate_percent / 100)).toFixed(2));
  const newStorage  = parseFloat((newPrincipal * (period.storage_charge_percent / 100)).toFixed(2));
  const newTotal    = parseFloat((newPrincipal + newInterest + newStorage).toFixed(2));

  console.log(`\n── Rollover plan ─────────────────────────────────────────────────────`);
  console.log(`  Owed above principal  : $${owedAbovePrincipal}`);
  console.log(`  Interest-only payment : $${interestOnlyPayment}  (pays it off exactly)`);
  console.log(`  New principal         : $${newPrincipal}`);
  console.log(`  New interest          : $${newInterest}  (${period.interest_rate_percent}%)`);
  console.log(`  New storage           : $${newStorage}  (${period.storage_charge_percent}%)`);
  console.log(`  New total due         : $${newTotal}`);
  console.log(`  New start date        : ${ROLLOVER_START.toDateString()}`);
  console.log(`  New due date          : ${newDueDate.toDateString()}`);
  console.log(`──────────────────────────────────────────────────────────────────────\n`);

  // 7. Transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 7a. Cancel any live/draft auction for this asset — always, regardless of loan/asset status
    const cancelled = await Auction.findOneAndUpdate(
      { asset: asset._id, status: { $in: ["draft", "live"] } },
      { $set: { status: "cancelled" } },
      { session, new: true },
    );
    console.log(cancelled
      ? `✔ Auction cancelled: ${cancelled.auction_no}`
      : `ℹ No live auction found for this asset (already closed or never listed)`);

    // 7b. Record interest-only payment on old loan and close it
    if (interestOnlyPayment > 0) {
      oldLoan.payments.push({
        amount:         interestOnlyPayment,
        payment_date:   ROLLOVER_START,
        payment_method: PAYMENT_METHOD,
        status:         "paid",
        reference_no:   `ROLLOVER-31JUL26-${Date.now()}`,
        notes:          SCRIPT_NOTE,
      });
      oldLoan.total_paid = parseFloat((oldLoan.total_paid + interestOnlyPayment).toFixed(2));
    }
    oldLoan.current_balance = 0;
    oldLoan.status          = "rolled_over";
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 7c. Create new loan
    const repayment_breakdown = {
      principal_amount:         newPrincipal,
      loan_period_days:         period.days,
      interest_period_days:     period.days,
      number_of_periods:        1,
      interest_rate_percent:    period.interest_rate_percent,
      interest_amount:          newInterest,
      storage_charge_percent:   period.storage_charge_percent,
      storage_charge_amount:    newStorage,
      expected_total_repayable: newTotal,
      carried_forward_arrears:  0,
      calculation_note:         `Principal $${newPrincipal} + Interest $${newInterest} + Storage $${newStorage} = $${newTotal}`,
    };

    const [newLoan] = await Loan.create(
      [
        {
          loan_no:                  generateLoanNo(),
          customer_user:            oldLoan.customer_user,
          application:              oldLoan.application,
          asset:                    asset._id,
          collateral_category:      oldLoan.collateral_category,
          principal_amount:         newPrincipal,
          currency:                 oldLoan.currency || "USD",
          loan_period_type:         loanPeriodType,
          interest_rate_percent:    period.interest_rate_percent,
          storage_charge_percent:   period.storage_charge_percent,
          interest_period_days:     period.days,
          penalty_percent:          period.penalty_percent,
          grace_days:               period.grace_days,
          repayment_type:           "once_off",
          start_date:               ROLLOVER_START,
          due_date:                 newDueDate,
          interest_amount:          newInterest,
          storage_charge_amount:    newStorage,
          expected_total_repayable: newTotal,
          current_balance:          newTotal,
          repayment_breakdown,
          status:                   "active",
          disbursement_date:        ROLLOVER_START,
          disbursement_notes:       `Rollover — no new funds disbursed; renewed from loan ${oldLoan.loan_no}. Client paid interest only.`,
          approval_status:          "approved",
          requires_super_admin_approval: newPrincipal > 500,
          is_rollover:              true,
          rollover_of:              oldLoan._id,
          root_loan:                oldLoan.root_loan || oldLoan._id,
          rollover_generation:      (oldLoan.rollover_generation || 0) + 1,
          carried_forward_arrears:  0,
          rollover_payment_amount:  interestOnlyPayment,
          rollover_notes:           SCRIPT_NOTE,
        },
      ],
      { session },
    );

    // 7d. Back-link old loan → new
    oldLoan.rolled_over_to = newLoan._id;
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 7e. Move asset to new loan
    await Asset.findByIdAndUpdate(
      asset._id,
      { status: "pawned", active_loan: newLoan._id },
      { session },
    );

    // 7f. Update loan application pointer
    if (oldLoan.application) {
      await LoanApplication.findByIdAndUpdate(
        oldLoan.application,
        { $set: { loan_id: newLoan._id, loan_created: true, status: "loan_created" } },
        { session },
      );
    }

    await session.commitTransaction();

    console.log(`✅ OLD loan ${oldLoan.loan_no}  →  status: rolled_over`);
    console.log(`✅ NEW loan ${newLoan.loan_no}`);
    console.log(`   principal : $${newPrincipal}`);
    console.log(`   total due : $${newTotal}`);
    console.log(`   start     : ${ROLLOVER_START.toDateString()}`);
    console.log(`   due date  : ${newDueDate.toDateString()}`);

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
