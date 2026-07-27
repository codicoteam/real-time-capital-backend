/**
 * One-off script: process 4 loan updates from Sandra's message (10 Jul 2026).
 *
 * CORRECT (fix amounts on existing active loan):
 *   Trevor Khaworera  LON26071341 → principal $200, total $240, due 16 Jul (date already correct)
 *
 * ROLLOVER (close auction loan → new active loan):
 *   Tatenda Edson Junior Tembo  LON26063592 → principal $80, total $96, due 17 Jul 2026
 *
 * FULLY PAID (mark redeemed):
 *   Natasha Roland       LON26068806
 *   Tinotenda Nyamudziya LON26068880
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Loan            = require("../models/loan.model");
const Asset           = require("../models/asset.model");
const Auction         = require("../models/auction.model");
const LoanApplication = require("../models/loanApplication.model");
const { LOAN_PERIODS } = require("../configs/loan_periods");

const PAYMENT_METHOD = "cash";
const SCRIPT_REF     = "SANDRA-10JUL26";

// ── Helper: generate loan number ─────────────────────────────────────────────
function generateLoanNo() {
  const d   = new Date();
  const yy  = d.getFullYear().toString().slice(-2);
  const mm  = (d.getMonth() + 1).toString().padStart(2, "0");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `LON${yy}${mm}${rnd}`;
}

// ── 1. Correct Trevor's existing active loan amounts ─────────────────────────
async function correctTrevorLoan() {
  console.log("\n━━━ CORRECT: Trevor Khaworera (LON26071341) ━━━");

  const loan = await Loan.findOne({ loan_no: "LON26071341" });
  if (!loan) throw new Error("Loan LON26071341 not found");
  console.log(`  Current: principal=$${loan.principal_amount}  balance=$${loan.current_balance}  status=${loan.status}`);

  const NEW_PRINCIPAL = 200;
  const INTEREST      = parseFloat((NEW_PRINCIPAL * 0.02).toFixed(2));  // $4
  const STORAGE       = parseFloat((NEW_PRINCIPAL * 0.18).toFixed(2));  // $36
  const NEW_TOTAL     = 240;

  loan.principal_amount         = NEW_PRINCIPAL;
  loan.interest_amount          = INTEREST;
  loan.storage_charge_amount    = STORAGE;
  loan.expected_total_repayable = NEW_TOTAL;
  loan.current_balance          = NEW_TOTAL;
  if (loan.repayment_breakdown) {
    loan.repayment_breakdown = {
      ...loan.repayment_breakdown,
      principal_amount:         NEW_PRINCIPAL,
      interest_amount:          INTEREST,
      storage_charge_amount:    STORAGE,
      expected_total_repayable: NEW_TOTAL,
      calculation_note:         `Corrected via ${SCRIPT_REF}: $200 + $4 + $36 = $240`,
    };
    loan.markModified("repayment_breakdown");
  }

  await loan.save({ validateModifiedOnly: true });
  console.log(`  ✅ LON26071341 corrected → principal=$${NEW_PRINCIPAL}  total=$${NEW_TOTAL}  due=${loan.due_date.toDateString()}`);
}

// ── 2. Rollover Tatenda's auction loan ──────────────────────────────────────
async function rolloverTatenda() {
  console.log("\n━━━ ROLLOVER: Tatenda Edson Junior Tembo (LON26063592) ━━━");

  const oldLoan = await Loan.findOne({ loan_no: "LON26063592" }).populate("asset");
  if (!oldLoan) throw new Error("Loan LON26063592 not found");
  const asset = oldLoan.asset;
  console.log(`  Old loan: status=${oldLoan.status}  balance=$${oldLoan.current_balance}`);

  const NEW_PRINCIPAL = 80;
  const NEW_TOTAL     = 96;
  const loanPeriodType = oldLoan.loan_period_type || "two_weeks";
  const period         = LOAN_PERIODS[loanPeriodType] || LOAN_PERIODS["two_weeks"];

  const INTEREST = parseFloat((NEW_PRINCIPAL * (period.interest_rate_percent / 100)).toFixed(2));  // $1.60
  const STORAGE  = parseFloat((NEW_PRINCIPAL * (period.storage_charge_percent / 100)).toFixed(2)); // $14.40
  const calcTotal = parseFloat((NEW_PRINCIPAL + INTEREST + STORAGE).toFixed(2));

  if (Math.abs(calcTotal - NEW_TOTAL) > 0.01) {
    console.warn(`  ⚠ Rate check: calculated $${calcTotal} vs specified $${NEW_TOTAL}. Using $${NEW_TOTAL}.`);
  } else {
    console.log(`  ✔ Rate check: $${NEW_PRINCIPAL} × ${period.interest_rate_percent}% + ${period.storage_charge_percent}% = $${calcTotal} ✓`);
  }

  const ROLLOVER_START = new Date("2026-07-03T00:00:00.000Z");
  const DUE_DATE       = new Date("2026-07-17T00:00:00.000Z");

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Cancel any live auction
    const cancelled = await Auction.findOneAndUpdate(
      { asset: asset._id || oldLoan.asset, status: { $in: ["draft", "live"] } },
      { $set: { status: "cancelled" } },
      { session, new: true },
    );
    if (cancelled) console.log(`  ✔ Auction cancelled: ${cancelled.auction_no}`);

    // Close old loan
    oldLoan.current_balance = 0;
    oldLoan.status          = "rolled_over";
    await oldLoan.save({ session, validateModifiedOnly: true });

    // Create new loan
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
      calculation_note:         `Rollover via ${SCRIPT_REF}`,
    };

    const [newLoan] = await Loan.create(
      [{
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
        requires_super_admin_approval: false,
        is_rollover:              true,
        rollover_of:              oldLoan._id,
        root_loan:                oldLoan.root_loan || oldLoan._id,
        rollover_generation:      (oldLoan.rollover_generation || 0) + 1,
        carried_forward_arrears:  0,
        rollover_payment_amount:  0,
        rollover_notes:           `Rollover processed via ${SCRIPT_REF}`,
      }],
      { session },
    );

    // Back-link old loan to new
    oldLoan.rolled_over_to = newLoan._id;
    await oldLoan.save({ session, validateModifiedOnly: true });

    // Move asset to new loan
    await Asset.findByIdAndUpdate(
      asset._id || oldLoan.asset,
      { status: "pawned", active_loan: newLoan._id },
      { session },
    );

    // Update application pointer
    if (oldLoan.application) {
      await LoanApplication.findByIdAndUpdate(
        oldLoan.application,
        { $set: { loan_id: newLoan._id, loan_created: true, status: "loan_created" } },
        { session },
      );
    }

    await session.commitTransaction();
    console.log(`  ✅ LON26063592 → rolled_over`);
    console.log(`  ✅ NEW ${newLoan.loan_no}: principal=$${NEW_PRINCIPAL}  total=$${NEW_TOTAL}  due=${DUE_DATE.toDateString()}`);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ── 3 & 4. Mark auction loans as fully paid / redeemed ───────────────────────
async function markPaid(loanNo, customerName) {
  console.log(`\n━━━ PAID: ${customerName} (${loanNo}) ━━━`);

  const loan = await Loan.findOne({ loan_no: loanNo }).populate("asset");
  if (!loan) throw new Error(`Loan ${loanNo} not found`);
  const asset = loan.asset;
  console.log(`  Current: status=${loan.status}  balance=$${loan.current_balance}`);

  const paymentAmount = loan.current_balance;
  const paymentDate   = new Date("2026-07-10T00:00:00.000Z");

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Cancel any live auction
    const cancelled = await Auction.findOneAndUpdate(
      { asset: asset._id || loan.asset, status: { $in: ["draft", "live"] } },
      { $set: { status: "cancelled" } },
      { session, new: true },
    );
    if (cancelled) console.log(`  ✔ Auction cancelled: ${cancelled.auction_no}`);

    // Record full payment
    loan.payments.push({
      amount:         paymentAmount,
      payment_date:   paymentDate,
      payment_method: PAYMENT_METHOD,
      status:         "paid",
      reference_no:   `${SCRIPT_REF}-PAID-${Date.now()}`,
      notes:          `Full repayment confirmed by Sandra 10 Jul 2026`,
    });
    loan.total_paid      = parseFloat((loan.total_paid + paymentAmount).toFixed(2));
    loan.current_balance = 0;
    loan.status          = "redeemed";
    await loan.save({ session, validateModifiedOnly: true });

    // Free the asset
    await Asset.findByIdAndUpdate(
      asset._id || loan.asset,
      { status: "available", active_loan: null },
      { session },
    );

    await session.commitTransaction();
    console.log(`  ✅ ${loanNo} → redeemed  (payment $${paymentAmount} recorded)`);
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected.");

  await correctTrevorLoan();
  await rolloverTatenda();
  await markPaid("LON26068806", "Natasha Roland");
  await markPaid("LON26068880", "Tinotenda Nyamudziya");

  await mongoose.disconnect();
  console.log("\n\nAll done.");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
