"use strict";

// Shared, correctness-critical data primitives for the 7 downloadable system reports.
// Getting these right ONCE here (instead of each report re-deriving them) is what avoids
// double-counted totals and stale-status bugs across Collections/Revenue/Cashflow/Aging/Defaulters.

const Loan = require("../../models/loan.model");
const Payment = require("../../models/payment.model");
const Expense = require("../../models/expense.model");
const InvestorTransaction = require("../../models/investor/investor_transaction.model");
const TitleDeed = require("../../models/investor/title_deed.model");
const BidPayment = require("../../models/bidPayment.model");
// Not referenced directly below, but required so Mongoose has these schemas registered
// before the .populate("customer_user"/"asset") calls in getLoanAgingBuckets run — this
// module should be self-contained rather than depending on some other file having
// already required them first.
require("../../models/user.model");
require("../../models/asset.model");

// ── Repayments, deduped ─────────────────────────────────────────────────────
// Every primary-path repayment (services/payment_service.js updateLoanBalance) writes a
// top-level Payment doc AND mirrors it into the loan's embedded payments[] array. A still
// -active legacy path (services/loan_service.js processPayment) writes ONLY to the
// embedded array. Counting both sources naively double-counts every primary-path payment.
// Same dedup approach already proven in scripts/migrateXeroBackfill.js.
//
// Returns a flat array of:
//   { loan_id, loan_no, amount, principal_component, interest_component,
//     storage_component, penalty_component, date, method, source, has_component_split }
async function getReconciledPayments(start, end) {
  const payments = await Payment.find({
    paid_at: { $gte: start, $lte: end },
    payment_status: "paid",
  })
    .populate("loan", "loan_no")
    .lean();

  const primary = payments.map((p) => ({
    loan_id: p.loan?._id || p.loan,
    loan_no: p.loan?.loan_no || null,
    amount: p.amount || 0,
    principal_component: p.principal_component || 0,
    interest_component: p.interest_component || 0,
    storage_component: p.storage_component || 0,
    penalty_component: p.penalty_component || 0,
    date: p.paid_at,
    method: p.method || p.provider || "cash",
    source: "payment_model",
    has_component_split: true,
  }));

  const loansWithEmbedded = await Loan.find({
    "payments.payment_date": { $gte: start, $lte: end },
    "payments.status": "paid",
  })
    .select("loan_no payments")
    .lean();

  const legacyOnly = [];
  for (const loan of loansWithEmbedded) {
    for (const entry of loan.payments || []) {
      if (entry.status !== "paid") continue;
      if (!entry.payment_date || entry.payment_date < start || entry.payment_date > end) continue;

      const mirrorsExisting = entry.reference_no
        ? await Payment.exists({ loan: loan._id, receipt_no: entry.reference_no })
        : false;
      if (mirrorsExisting) continue; // already counted via the primary Payment doc above

      legacyOnly.push({
        loan_id: loan._id,
        loan_no: loan.loan_no,
        amount: entry.amount || 0,
        // No component breakdown recorded on this path — treated entirely as principal
        // for reporting purposes and flagged via has_component_split so callers can
        // footnote it rather than silently presenting a precise-looking split.
        principal_component: entry.amount || 0,
        interest_component: 0,
        storage_component: 0,
        penalty_component: 0,
        date: entry.payment_date,
        method: entry.payment_method || "cash",
        source: "legacy_embedded",
        has_component_split: false,
      });
    }
  }

  return [...primary, ...legacyOnly].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// ── Loan aging, computed dynamically ────────────────────────────────────────
// No cron/scheduler exists in this codebase — loan.status only changes via explicit API
// calls and can be stale. Bucket by actual days-past-due instead of trusting `status`.
//
// Returns { asOf, loans: [{ loan, days_late, bucket, grace_days, penalty_percent }], buckets: {...} }
const AGING_BUCKETS = ["current", "in_grace", "1-30", "31-60", "61-90", "90+"];

async function getLoanAgingBuckets(asOfDate = new Date()) {
  const loans = await Loan.find({
    current_balance: { $gt: 0 },
    status: { $nin: ["draft", "pending_approval", "cancelled", "redeemed", "written_off", "rolled_over"] },
  })
    .populate("customer_user", "first_name last_name email phone")
    .populate("asset", "asset_no title")
    .lean();

  const rows = loans.map((loan) => {
    const dueDate = new Date(loan.due_date);
    const daysLate = Math.floor((asOfDate - dueDate) / 86400000);
    const graceDays = loan.grace_days ?? 7;

    let bucket;
    if (daysLate <= 0) bucket = "current";
    else if (daysLate <= graceDays) bucket = "in_grace";
    else {
      const pastGrace = daysLate - graceDays;
      if (pastGrace <= 30) bucket = "1-30";
      else if (pastGrace <= 60) bucket = "31-60";
      else if (pastGrace <= 90) bucket = "61-90";
      else bucket = "90+";
    }

    return {
      loan_id: loan._id,
      loan_no: loan.loan_no,
      customer: loan.customer_user,
      asset: loan.asset,
      collateral_category: loan.collateral_category,
      principal_amount: loan.principal_amount,
      current_balance: loan.current_balance,
      due_date: loan.due_date,
      days_late: Math.max(0, daysLate),
      bucket,
      grace_days: graceDays,
      penalty_percent: loan.penalty_percent ?? 10,
      status: loan.status,
    };
  });

  const buckets = AGING_BUCKETS.reduce((acc, b) => {
    const inBucket = rows.filter((r) => r.bucket === b);
    acc[b] = {
      count: inBucket.length,
      outstanding_balance: inBucket.reduce((s, r) => s + (r.current_balance || 0), 0),
    };
    return acc;
  }, {});

  return { asOf: asOfDate, loans: rows, buckets };
}

// Defaulters = the subset past grace with a meaningfully overdue balance.
async function getDefaulters(asOfDate = new Date(), minDaysPastGrace = 1) {
  const { asOf, loans } = await getLoanAgingBuckets(asOfDate);
  const defaulters = loans.filter((r) => ["1-30", "31-60", "61-90", "90+"].includes(r.bucket));
  return { asOf, defaulters };
}

// ── Title deed income, excluding double-counted deeds ───────────────────────
// A TitleDeed with linked_allocation_id set duplicates an already-tracked
// InvestorLoanAllocation — including it here would double the investor's numbers.
// Returns { total, rtc_share, investor_share, deeds: [...] } for the overlap of
// [start,end] with each active deed's [start_date, end_date||now].
async function getTitleDeedIncome(start, end) {
  const deeds = await TitleDeed.find({
    linked_allocation_id: null,
    status: { $in: ["active", "completed"] },
    start_date: { $lte: end },
    $or: [{ end_date: { $gte: start } }, { end_date: null }],
  }).lean();

  let total = 0;
  let rtcShare = 0;
  let investorShare = 0;

  const rows = deeds.map((deed) => {
    const deedStart = new Date(deed.start_date);
    const deedEnd = deed.end_date ? new Date(deed.end_date) : new Date();
    const overlapStart = deedStart > start ? deedStart : start;
    const overlapEnd = deedEnd < end ? deedEnd : end;
    const overlapDays = Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86400000));

    const dailyInterest = ((deed.loan_amount || 0) * (deed.interest_rate || 0)) / 100 / 365;
    const periodInterest = dailyInterest * overlapDays;

    const investorPct = deed.investor_share_pct ?? 100;
    const investorPortion = periodInterest * (investorPct / 100);
    const rtcPortion = periodInterest - investorPortion;

    total += periodInterest;
    rtcShare += rtcPortion;
    investorShare += investorPortion;

    return {
      deed_number: deed.deed_number,
      borrower_name: deed.borrower_name,
      loan_amount: deed.loan_amount,
      interest_rate: deed.interest_rate,
      investor_share_pct: investorPct,
      period_interest: periodInterest,
      rtc_share: rtcPortion,
      investor_share: investorPortion,
    };
  });

  return { total, rtc_share: rtcShare, investor_share: investorShare, deeds: rows };
}

// ── Expenses ────────────────────────────────────────────────────────────────
async function getExpensesByCategory(start, end) {
  const rows = await Expense.aggregate([
    { $match: { status: "approved", expense_date: { $gte: start, $lte: end } } },
    { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  return { total, categories: rows.map((r) => ({ category: r._id, total: r.total, count: r.count })) };
}

// ── Investor transactions ───────────────────────────────────────────────────
async function getInvestorTransactions(start, end) {
  const rows = await InvestorTransaction.aggregate([
    { $match: { created_at: { $gte: start, $lte: end } } },
    { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const byType = rows.reduce((acc, r) => {
    acc[r._id] = { total: r.total, count: r.count };
    return acc;
  }, {});
  return {
    deposit: byType.deposit || { total: 0, count: 0 },
    capital_withdrawal: byType.capital_withdrawal || { total: 0, count: 0 },
    profit_withdrawal: byType.profit_withdrawal || { total: 0, count: 0 },
    drawing: byType.drawing || { total: 0, count: 0 },
  };
}

// ── Auction cash actually received (BidPayment, not just the winning bid) ──────
// Mirrors the Xero integration's own philosophy (services/xero/xero_sync_service.js
// syncAuctionSaleCompleted): a Cashflow statement should reflect cash that actually
// moved, not just a winning bid that may not have been paid yet.
async function getAuctionCashReceived(start, end) {
  const rows = await BidPayment.aggregate([
    { $match: { status: "success", paid_at: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return { total: rows[0]?.total || 0, count: rows[0]?.count || 0 };
}

// ── Loan disbursement total (for Cashflow's outflow side) ──────────────────────
async function getDisbursementTotal(start, end) {
  const rows = await Loan.aggregate([
    { $match: { disbursement_date: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: "$principal_amount" }, count: { $sum: 1 } } },
  ]);
  return { total: rows[0]?.total || 0, count: rows[0]?.count || 0 };
}

module.exports = {
  AGING_BUCKETS,
  getReconciledPayments,
  getLoanAgingBuckets,
  getDefaulters,
  getTitleDeedIncome,
  getExpensesByCategory,
  getInvestorTransactions,
  getAuctionCashReceived,
  getDisbursementTotal,
};
