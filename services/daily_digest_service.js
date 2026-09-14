"use strict";

// Builds the data behind the daily 6pm CAT admin activity digest — everything
// that happened "today" (CAT calendar day) across loan processing, customers,
// investors, auctions, and logins. Pure data assembly; utils/emails_util.js
// turns this into the actual email.

const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");
const Auction = require("../models/auction.model");
const dataSources = require("./reports/reportDataSources");
const loginActivityService = require("./login_activity_service");

const CAT_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Harare is UTC+2 year-round, no DST

/**
 * Returns the UTC instants that bound the CAT calendar day containing
 * `referenceDate` (defaults to now), plus a human label for that day.
 */
function catDayBounds(referenceDate = new Date()) {
  const catNow = new Date(referenceDate.getTime() + CAT_OFFSET_MS);
  const y = catNow.getUTCFullYear();
  const m = catNow.getUTCMonth();
  const d = catNow.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - CAT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - CAT_OFFSET_MS);
  const dateLabel = new Date(Date.UTC(y, m, d)).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return { start, end, dateLabel };
}

async function getDigestData(referenceDate = new Date()) {
  const { start, end, dateLabel } = catDayBounds(referenceDate);

  const [
    disbursedLoans,
    reconciledPayments,
    newApplications,
    newCustomers,
    penaltyWaivedAgg,
    investorTx,
    auctionCash,
    auctionsClosedCount,
    loginStats,
  ] = await Promise.all([
    Loan.find({ disbursement_date: { $gte: start, $lte: end } })
      .select("loan_no principal_amount disbursed_by customer_user")
      .populate("disbursed_by", "first_name last_name")
      .populate("customer_user", "first_name last_name")
      .lean(),
    dataSources.getReconciledPayments(start, end),
    LoanApplication.find({ created_at: { $gte: start, $lte: end } })
      .select("application_no requested_loan_amount status")
      .lean(),
    User.countDocuments({ roles: "customer", created_at: { $gte: start, $lte: end } }),
    Loan.aggregate([
      { $match: { penalty_waived: true, penalty_waived_at: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: "$penalty_waived_amount" }, count: { $sum: 1 } } },
    ]),
    dataSources.getInvestorTransactions(start, end),
    dataSources.getAuctionCashReceived(start, end),
    Auction.countDocuments({ status: "closed", ends_at: { $gte: start, $lte: end } }),
    loginActivityService.getLoginStats({ start, end }),
  ]);

  // Loans disbursed — grouped by the processor who disbursed them
  const byProcessor = new Map();
  let disbursedTotal = 0;
  for (const loan of disbursedLoans) {
    disbursedTotal += loan.principal_amount || 0;
    const key = loan.disbursed_by
      ? `${loan.disbursed_by.first_name || ""} ${loan.disbursed_by.last_name || ""}`.trim() || "Unknown staff"
      : "Unknown staff";
    if (!byProcessor.has(key)) byProcessor.set(key, { name: key, count: 0, total: 0 });
    const bucket = byProcessor.get(key);
    bucket.count += 1;
    bucket.total += loan.principal_amount || 0;
  }

  // Repayments collected today (dedup-safe — see reportDataSources.getReconciledPayments)
  const repaymentsTotal = reconciledPayments.reduce((s, p) => s + p.amount, 0);

  const applicationsTotal = newApplications.reduce((s, a) => s + (a.requested_loan_amount || 0), 0);

  const penaltyWaived = {
    total: penaltyWaivedAgg[0]?.total || 0,
    count: penaltyWaivedAgg[0]?.count || 0,
  };

  return {
    dateLabel,
    period: { start, end },
    loanProcessing: {
      disbursed: {
        count: disbursedLoans.length,
        total: disbursedTotal,
        byProcessor: Array.from(byProcessor.values()).sort((a, b) => b.total - a.total),
      },
      repayments: {
        count: reconciledPayments.length,
        total: repaymentsTotal,
      },
      penaltyWaived,
    },
    customers: {
      newApplications: {
        count: newApplications.length,
        total: applicationsTotal,
      },
      newRegistrations: newCustomers,
    },
    investors: investorTx,
    auctions: {
      closedCount: auctionsClosedCount,
      cashReceived: auctionCash.total,
      paymentsCount: auctionCash.count,
    },
    logins: loginStats.data,
  };
}

module.exports = { getDigestData, catDayBounds };
