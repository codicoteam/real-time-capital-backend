/**
 * One-off script: rollover the 3 loans paid on 02 July 2026.
 *
 * Archford Gutu  – Hisense TV  – paid $50
 * Trevor Khaworera – PlayStation – paid $46
 * Samantha Chimuchere            – paid $40
 *
 * For each loan:
 *   1. Find the customer by name
 *   2. Find their loan in auction / in_grace / overdue status
 *   3. Cancel the live auction listing (if any) in the same transaction
 *   4. Roll the loan over, start_date = 2026-07-02, same loan_period_type
 */

"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const Loan     = require("../models/loan.model");
const Asset    = require("../models/asset.model");
const Auction  = require("../models/auction.model");
const LoanApplication = require("../models/loanApplication.model");
const User     = require("../models/user.model");
const { LOAN_PERIODS } = require("../configs/loan_periods");

// ── Targets ────────────────────────────────────────────────────────────────
const TARGETS = [
  { firstName: "Archford",  lastName: "Gutu",        payment: 50, assetHint: "hisense" },
  { firstName: "Trevor",    lastName: "Khaworera",   payment: 46, assetHint: "play"    },
  { firstName: "Samantha",  lastName: "Chimuchere",  payment: 40, assetHint: null      },
];

const ROLLOVER_START = new Date("2026-07-02T00:00:00.000Z");
const PAYMENT_METHOD = "cash";
const SCRIPT_NOTE   = "Rollover processed retroactively for payment received 02 July 2026";

// ── Helper: generate loan number ────────────────────────────────────────────
function generateLoanNo() {
  const d   = new Date();
  const yy  = d.getFullYear().toString().slice(-2);
  const mm  = (d.getMonth() + 1).toString().padStart(2, "0");
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `LON${yy}${mm}${rnd}`;
}

// ── Helper: repayment breakdown ─────────────────────────────────────────────
function calcBreakdown(principal, period, startDate, dueDate) {
  const periodDays  = Math.ceil((dueDate - startDate) / 86400000);
  const numPeriods  = periodDays / period.days;
  const interest    = parseFloat((principal * (period.interest_rate_percent / 100) * numPeriods).toFixed(2));
  const storage     = parseFloat((principal * (period.storage_charge_percent / 100) * numPeriods).toFixed(2));
  const total       = parseFloat((principal + interest + storage).toFixed(2));
  return { interest, storage, total };
}

// ── Core rollover ────────────────────────────────────────────────────────────
async function rolloverOne(target) {
  const { firstName, lastName, payment, assetHint } = target;
  console.log(`\n──────────────────────────────────────────`);
  console.log(`Processing: ${firstName} ${lastName}  (payment $${payment})`);

  // 1. Find user
  const user = await User.findOne({
    first_name: { $regex: new RegExp(`^${firstName}$`, "i") },
    last_name:  { $regex: new RegExp(`^${lastName}$`,  "i") },
  });
  if (!user) throw new Error(`Customer not found: ${firstName} ${lastName}`);
  console.log(`  ✔ Customer: ${user._id} (${user.email || user.phone || "no contact"})`);

  // 2. Find their open loan (auction / in_grace / overdue / active / partially_paid)
  const eligibleStatuses = ["auction", "in_grace", "overdue", "active", "partially_paid"];
  const loans = await Loan.find({
    customer_user: user._id,
    status: { $in: eligibleStatuses },
  }).populate("asset").sort({ created_at: -1 });

  if (loans.length === 0) throw new Error(`No eligible open loan found for ${firstName} ${lastName}`);

  // If multiple, prefer one whose asset title matches the hint
  let oldLoan = loans[0];
  if (assetHint && loans.length > 1) {
    const hinted = loans.find(
      (l) => l.asset && l.asset.title && l.asset.title.toLowerCase().includes(assetHint.toLowerCase()),
    );
    if (hinted) oldLoan = hinted;
  }

  const asset = oldLoan.asset;
  console.log(`  ✔ Loan: ${oldLoan.loan_no}  status=${oldLoan.status}  balance=$${oldLoan.current_balance}  principal=$${oldLoan.principal_amount}`);
  if (asset) console.log(`  ✔ Asset: ${asset.asset_no} – ${asset.title}  status=${asset.status}`);

  // 3. Determine new loan period
  const loanPeriodType = oldLoan.loan_period_type;
  const period         = LOAN_PERIODS[loanPeriodType];
  if (!period) throw new Error(`Unknown loan_period_type: ${loanPeriodType}`);

  // 4. Compute what's owed above principal and whether there are arrears
  const owedAbovePrincipal = Math.max(0, oldLoan.current_balance - oldLoan.principal_amount);
  let newPrincipal        = oldLoan.principal_amount;
  let carriedForwardArrears = 0;

  if (payment >= owedAbovePrincipal) {
    const excess = payment - owedAbovePrincipal;
    newPrincipal = parseFloat((oldLoan.principal_amount - excess).toFixed(2));
  } else {
    carriedForwardArrears = parseFloat((owedAbovePrincipal - payment).toFixed(2));
  }

  if (newPrincipal <= 0) {
    throw new Error(
      `Payment of $${payment} covers the entire balance – use a normal redemption, not rollover.`,
    );
  }

  console.log(`  ✔ Owed above principal: $${owedAbovePrincipal.toFixed(2)}`);
  console.log(`  ✔ New principal: $${newPrincipal}   Carried arrears: $${carriedForwardArrears}`);

  // 5. Build new loan dates
  const dueDate = new Date(ROLLOVER_START);
  dueDate.setDate(dueDate.getDate() + period.days);

  const { interest, storage, total } = calcBreakdown(newPrincipal, period, ROLLOVER_START, dueDate);
  const expectedTotal = parseFloat((total + carriedForwardArrears).toFixed(2));

  // 6. Run inside a Mongoose transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 6a. Cancel live/draft auction for this asset (if any)
    if (oldLoan.status === "auction" || (asset && asset.status === "auction")) {
      const cancelled = await Auction.findOneAndUpdate(
        { asset: oldLoan.asset._id || oldLoan.asset, status: { $in: ["draft", "live"] } },
        { $set: { status: "cancelled" } },
        { session, new: true },
      );
      if (cancelled) {
        console.log(`  ✔ Auction cancelled: ${cancelled.auction_no}`);
      } else {
        console.log(`  ⚠ No live auction found for this asset (already closed or never created)`);
      }
    }

    // 6b. Record payment on old loan and close it
    const paymentRecord = {
      amount:         payment,
      payment_date:   ROLLOVER_START,
      payment_method: PAYMENT_METHOD,
      status:         "paid",
      reference_no:   `ROLLOVER-02JUL26-${Date.now()}`,
      notes:          SCRIPT_NOTE,
    };

    oldLoan.payments.push(paymentRecord);
    oldLoan.total_paid     = parseFloat((oldLoan.total_paid + payment).toFixed(2));
    oldLoan.current_balance = 0;
    oldLoan.status         = "rolled_over";
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 6c. Create new loan
    const repayment_breakdown = {
      principal_amount:        newPrincipal,
      loan_period_days:        period.days,
      interest_period_days:    period.days,
      number_of_periods:       1,
      interest_rate_percent:   period.interest_rate_percent,
      interest_amount:         interest,
      storage_charge_percent:  period.storage_charge_percent,
      storage_charge_amount:   storage,
      expected_total_repayable: total,
      carried_forward_arrears:  carriedForwardArrears,
      calculation_note:        "Total = Principal + (Principal × Interest%) + (Principal × Storage%)",
    };

    const [newLoan] = await Loan.create(
      [
        {
          loan_no:                  generateLoanNo(),
          customer_user:            oldLoan.customer_user,
          application:              oldLoan.application,
          asset:                    oldLoan.asset._id || oldLoan.asset,
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
          due_date:                 dueDate,
          interest_amount:          interest,
          storage_charge_amount:    storage,
          expected_total_repayable: expectedTotal,
          current_balance:          expectedTotal,
          repayment_breakdown,
          status:                   "active",
          disbursement_date:        ROLLOVER_START,
          disbursement_notes:       `Rollover — no new funds disbursed; renewed from loan ${oldLoan.loan_no}`,
          approval_status:          "approved",
          requires_super_admin_approval: newPrincipal > 500,
          is_rollover:              true,
          rollover_of:              oldLoan._id,
          root_loan:                oldLoan.root_loan || oldLoan._id,
          rollover_generation:      (oldLoan.rollover_generation || 0) + 1,
          carried_forward_arrears:  carriedForwardArrears,
          rollover_payment_amount:  payment,
          rollover_notes:           SCRIPT_NOTE,
        },
      ],
      { session },
    );

    // 6d. Back-link old loan to new
    oldLoan.rolled_over_to = newLoan._id;
    await oldLoan.save({ session, validateModifiedOnly: true });

    // 6e. Move asset onto new loan
    await Asset.findByIdAndUpdate(
      oldLoan.asset._id || oldLoan.asset,
      { status: "pawned", active_loan: newLoan._id },
      { session },
    );

    // 6f. Update loan application pointer
    if (oldLoan.application) {
      await LoanApplication.findByIdAndUpdate(
        oldLoan.application,
        { $set: { loan_id: newLoan._id, loan_created: true, status: "loan_created" } },
        { session },
      );
    }

    await session.commitTransaction();

    console.log(`  ✅ OLD loan ${oldLoan.loan_no} → status: rolled_over`);
    console.log(`  ✅ NEW loan ${newLoan.loan_no} → principal=$${newPrincipal}  balance=$${expectedTotal}  due=${dueDate.toDateString()}`);
    if (carriedForwardArrears > 0) {
      console.log(`  ⚠  Carried forward arrears: $${carriedForwardArrears} (underpaid interest)`);
    }

    return { success: true, oldLoanNo: oldLoan.loan_no, newLoanNo: newLoan.loan_no };
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
  console.log("Connected.\n");

  const results = [];
  for (const target of TARGETS) {
    try {
      const r = await rolloverOne(target);
      results.push({ ...target, ...r });
    } catch (err) {
      console.error(`  ❌ FAILED for ${target.firstName} ${target.lastName}: ${err.message}`);
      results.push({ ...target, success: false, error: err.message });
    }
  }

  console.log("\n══════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("══════════════════════════════════════════");
  for (const r of results) {
    const name = `${r.firstName} ${r.lastName}`;
    if (r.success) {
      console.log(`  ✅ ${name}: ${r.oldLoanNo} → ${r.newLoanNo}`);
    } else {
      console.log(`  ❌ ${name}: ${r.error}`);
    }
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
