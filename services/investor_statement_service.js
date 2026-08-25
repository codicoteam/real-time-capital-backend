"use strict";

/**
 * Excel statement/report generation for the investor module.
 *
 * Every figure here is read straight from the same aggregates already used (and
 * already fixed for correctness) elsewhere in the app — getTransactionSummary and
 * getInvestorLedger — rather than being recomputed from scratch, so this report can
 * never silently drift from what the dashboard shows. The only new computation is
 * per-loan status/penalty, which mirrors the frontend's getDeploymentStatus /
 * computePenaltyAmount (investorUtils.ts) exactly, since Excel generation happens
 * server-side where that TS logic isn't available.
 */

const ExcelJS = require("exceljs");
const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const TitleDeed = require("../models/investor/title_deed.model");
const Loan = require("../models/loan.model");
const investorAllocationService = require("./investor_allocation_service");

// ─── Shared style palette (matches loan_dashboard_service.js for a consistent house style) ──

const BRAND = "10B981"; // emerald
const DARK = "0F172A";
const HEADER = "064E3B"; // dark emerald
const ALT_ROW = "F0FDF4";
const WHITE = "FFFFFF";
const BORDER_COLOR = "CBD5E1";
const AMBER = "F59E0B";
const ROSE = "FEE2E2";

const thin = { style: "thin", color: { argb: `FF${BORDER_COLOR}` } };
const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
const hdrFont = { bold: true, size: 11, color: { argb: `FF${WHITE}` }, name: "Calibri" };
const bodyFont = { size: 10, name: "Calibri" };
const boldFont = { bold: true, size: 10, name: "Calibri" };
const centerAlign = { horizontal: "center", vertical: "middle" };
const leftAlign = { horizontal: "left", vertical: "middle" };
const rightAlign = { horizontal: "right", vertical: "middle" };

const USD = '"$"#,##0.00';
const PCT = '0.0"%"';
const DT = "yyyy-mm-dd";

const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

function applyHdrStyle(row, bgArgb = `FF${HEADER}`) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = hdrFont;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
    cell.border = cellBorder;
    cell.alignment = centerAlign;
  });
}

function applyAltRow(row, idx, extraFillArgb) {
  const bg = extraFillArgb || (idx % 2 === 0 ? `FF${WHITE}` : `FF${ALT_ROW}`);
  row.height = 18;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = bodyFont;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.border = cellBorder;
    if (cell.alignment?.horizontal !== "right") cell.alignment = leftAlign;
  });
}

function titleBanner(sheet, title, subtitle, span) {
  sheet.mergeCells(`A1:${span}1`);
  const t = sheet.getCell("A1");
  t.value = title;
  t.font = { bold: true, size: 16, color: { argb: `FF${WHITE}` }, name: "Calibri" };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
  t.alignment = centerAlign;
  sheet.getRow(1).height = 36;

  sheet.mergeCells(`A2:${span}2`);
  const s = sheet.getCell("A2");
  s.value = subtitle;
  s.font = { size: 10, color: { argb: `FF${WHITE}` }, name: "Calibri" };
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER}` } };
  s.alignment = centerAlign;
  sheet.getRow(2).height = 20;

  sheet.addRow([]);
}

// ─── Loan status / penalty — server-side mirror of investorUtils.ts ──────────────

/** Mirrors getDeploymentStatus() for a raw InvestorLoanAllocation doc. */
function computeAllocationStatus(alloc, maturityDateOverride) {
  if (alloc.loan_status_override === "Outstanding") return "active";
  if (alloc.status && alloc.status !== "active") return alloc.status;

  const maturityDate = maturityDateOverride !== undefined ? maturityDateOverride : alloc.maturity_date;
  const now = Date.now();
  const start = new Date(alloc.loan_date || alloc.allocated_at).getTime();
  if (now < start) return "expected";
  if (!maturityDate) return "active";

  const end = new Date(maturityDate).getTime();
  if (now <= end) return "active";

  const daysPastDue = (now - end) / (1000 * 60 * 60 * 24);
  return daysPastDue <= 7 ? "grace_period" : "auction";
}

const DEED_STATUS_MAP = { pending: "expected", active: "active", completed: "completed", defaulted: "defaulted" };

/** Mirrors computePenaltyAmount() — 10% of principal+interest, split by investor share. */
function computePenalty(principal, totalInterest, investorSharePct, status) {
  if (status !== "grace_period" && status !== "auction") return { penalty: 0, penaltyInvestorShare: 0 };
  const totalOwed = (principal || 0) + (totalInterest || 0);
  const penalty = totalOwed * 0.1;
  return { penalty, penaltyInvestorShare: penalty * ((investorSharePct ?? 0) / 100) };
}

const STATUS_LABEL = {
  active: "Active",
  completed: "Completed",
  expected: "Upcoming",
  defaulted: "Defaulted",
  grace_period: "Grace Period",
  auction: "To Auction",
  cancelled: "Cancelled",
};

/** Real system-created loans don't carry borrower_name/collateral_description/maturity_date
 *  inline on the allocation the way manually-seeded CSV rows do — those live on the
 *  populated Loan doc instead. Resolve whichever source actually has the data. */
function resolveAllocationDisplay(a) {
  const loan = a.loan_id;
  const borrower = loan?.customer_user;
  return {
    borrowerName: a.borrower_name || (borrower ? `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim() : null) || "Unknown",
    collateral: a.collateral_description || loan?.asset?.title || "—",
    maturityDate: a.maturity_date || loan?.due_date || null,
  };
}

/** One normalized row per loan (allocation or title deed) for the Loans sheet. */
async function buildLoanRows(investorId) {
  const [allocations, deeds] = await Promise.all([
    InvestorLoanAllocation.find({ investor_id: investorId, status: { $ne: "cancelled" } })
      .sort({ loan_date: 1 })
      .populate({
        path: "loan_id",
        select: "due_date",
        populate: [
          { path: "customer_user", select: "first_name last_name" },
          { path: "asset", select: "title" },
        ],
      }),
    TitleDeed.find({ investor_id: investorId, status: { $ne: "cancelled" } }).sort({ start_date: 1 }),
  ]);

  const rows = [];

  for (const a of allocations) {
    const display = resolveAllocationDisplay(a);
    const status = computeAllocationStatus(a, display.maturityDate);
    const totalInterest = a.total_interest_receivable || a.total_loan_profit || 0;
    const { penalty, penaltyInvestorShare } = computePenalty(a.principal_amount, totalInterest, a.investor_share_pct, status);
    rows.push({
      loanRef: a.loan_no || "—",
      borrower: display.borrowerName,
      collateral: display.collateral,
      isCoInvestor: !!a.is_co_investor,
      principal: a.principal_amount || 0,
      sharePct: a.investor_share_pct ?? null,
      start: a.loan_date || a.allocated_at,
      end: display.maturityDate,
      status,
      investorProfit: a.investor_profit || 0,
      penaltyInvestorShare,
      penaltyLabel: penalty > 0 ? `${penaltyInvestorShare.toFixed(2)} (10% overdue penalty)` : "",
    });
  }

  for (const d of deeds) {
    const totalInterest = (d.loan_amount || 0) * ((d.interest_rate || 0) / 100);
    const sharePct = d.investor_share_pct ?? 100;
    rows.push({
      loanRef: d.deed_number,
      borrower: d.borrower_name || "Unknown",
      collateral: `${d.property_name || "Title deed"} (title deed)`,
      isCoInvestor: false,
      principal: d.loan_amount || 0,
      sharePct,
      start: d.start_date,
      end: d.end_date,
      status: DEED_STATUS_MAP[d.status] || "active",
      investorProfit: totalInterest * (sharePct / 100),
      penaltyInvestorShare: 0,
      penaltyLabel: "", // title deeds are never sent to grace/auction
    });
  }

  return rows.sort((x, y) => new Date(x.start || 0) - new Date(y.start || 0));
}

// ─── Per-investor statement ──────────────────────────────────────────────────────

async function buildInvestorStatementWorkbook(investorId) {
  const investor = await Investor.findById(investorId);
  if (!investor) throw new Error("Investor not found.");

  const [summary, ledger, loanRows] = await Promise.all([
    investorAllocationService.getTransactionSummary(investorId),
    investorAllocationService.getInvestorLedger(investorId),
    buildLoanRows(investorId),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "RealTimeCapital System";
  wb.created = new Date();
  const now = new Date();

  // ══════════════ SHEET 1 — Statement Summary ══════════════
  const s1 = wb.addWorksheet("Statement Summary", { properties: { tabColor: { argb: `FF${BRAND}` } } });
  s1.views = [{ showGridLines: false }];
  s1.columns = [{ width: 34 }, { width: 18 }, { width: 4 }, { width: 34 }, { width: 18 }];
  titleBanner(s1, `${investor.name} — Investor Statement`, `${investor.email}  |  Generated: ${fmtDate(now)}`, "E");

  const addSection = (title) => {
    const r = s1.addRow([title]);
    s1.mergeCells(`A${r.number}:E${r.number}`);
    r.getCell(1).font = { bold: true, size: 12, color: { argb: `FF${HEADER}` } };
    r.height = 22;
  };
  const addLine = (label, value, idx, opts = {}) => {
    const r = s1.addRow([label, value]);
    r.getCell(1).font = opts.bold ? boldFont : bodyFont;
    r.getCell(2).font = opts.bold ? boldFont : bodyFont;
    r.getCell(2).numFmt = USD;
    r.getCell(2).alignment = rightAlign;
    r.getCell(1).alignment = leftAlign;
    r.eachCell({ includeEmpty: true }, (c) => { c.border = cellBorder; });
    if (idx % 2 === 1) {
      r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ALT_ROW}` } }; });
    }
    return r;
  };

  let idx = 0;
  addSection("CAPITAL POSITION");
  addLine("Committed Capital", summary.committed_capital, idx++);
  addLine("  — Deployed to Loans (incl. title deeds)", summary.deployed_capital, idx++);
  addLine("  — Idle Capital (uninvested cash)", summary.available_balance, idx++);
  s1.addRow([]);

  addSection("INCOME (INTEREST EARNED)");
  addLine("Total Interest Earned to Date", summary.total_realized_profit + summary.total_monthly_interest_earned, idx++);
  addLine("  — Realized on Completed Loans", summary.total_realized_profit, idx++);
  addLine("  — Received as Monthly Interest", summary.total_monthly_interest_earned, idx++);
  addLine("Pending Profit (on active loans, not yet realized)", summary.pending_profit, idx++, { bold: true });
  s1.addRow([]);

  addSection("CASH MOVEMENTS (ALL-TIME)");
  addLine("Total Deposits (capital in)", summary.total_deposits, idx++);
  addLine("Total Capital Withdrawn (capital out)", -summary.total_capital_withdrawn, idx++);
  addLine("Total Profit Withdrawn (distributions)", -summary.total_profit_withdrawn, idx++);
  addLine("Profit Available (earned, not yet withdrawn)", summary.available_profit_to_withdraw, idx++);
  s1.addRow([]);

  addSection("STATEMENT BALANCE");
  const balRow = addLine("Liquid Cash — withdrawable today", summary.liquid_cash, idx++, { bold: true });
  balRow.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FFD1FAE5` } };
    c.font = { bold: true, size: 11, name: "Calibri" };
  });
  s1.addRow([]);
  const noteRow = s1.addRow(["Note: Liquid Cash = Idle Capital + Profit Available. Pending Profit is accrued but not yet cash."]);
  s1.mergeCells(`A${noteRow.number}:E${noteRow.number}`);
  noteRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };

  // ══════════════ SHEET 2 — Transactions (full ledger) ══════════════
  const s2 = wb.addWorksheet("Transactions", { properties: { tabColor: { argb: "FF3B82F6" } } });
  s2.views = [{ state: "frozen", ySplit: 1 }];
  s2.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Type", key: "type", width: 20 },
    { header: "Description", key: "label", width: 46 },
    { header: "Direction", key: "direction", width: 12 },
    { header: "Amount (USD)", key: "amount", width: 16 },
    { header: "Running Balance", key: "balance", width: 18 },
  ];
  applyHdrStyle(s2.getRow(1));

  // Running balance mirrors LedgerTable.tsx: only real cash movement counts
  // (deposits/withdrawals/profit) — loan_funded/loan_repaid never touch it, since
  // deploying committed capital into a loan doesn't reduce the investor's account value.
  const BALANCE_TYPES = new Set(["deposit", "capital_withdrawal", "profit_withdrawal", "drawing", "expense", "interest_earned", "loan_profit"]);
  let running = 0;
  const chronological = [...ledger].sort((a, b) => new Date(a.date) - new Date(b.date));
  const balanceByEntry = new Map();
  chronological.forEach((e, i) => {
    if (BALANCE_TYPES.has(e.type)) {
      running += e.direction === "in" ? e.amount : -e.amount;
    }
    balanceByEntry.set(i, running);
  });

  chronological.forEach((e, i) => {
    const r = s2.addRow({
      date: fmtDate(e.date),
      type: e.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      label: e.label || "",
      direction: e.direction === "in" ? "In" : "Out",
      amount: e.direction === "in" ? e.amount : -e.amount,
      balance: balanceByEntry.get(i),
    });
    applyAltRow(r, i);
    r.getCell("amount").numFmt = USD;
    r.getCell("amount").alignment = rightAlign;
    r.getCell("amount").font = { ...bodyFont, color: { argb: e.direction === "in" ? "FF059669" : "FFD97706" } };
    r.getCell("balance").numFmt = USD;
    r.getCell("balance").alignment = rightAlign;
  });
  s2.getColumn("date").numFmt = DT;

  // ══════════════ SHEET 3 — Loans ══════════════
  const s3 = wb.addWorksheet("Loans", { properties: { tabColor: { argb: `FF${AMBER}` } } });
  s3.views = [{ state: "frozen", ySplit: 1 }];
  s3.columns = [
    { header: "Loan Ref", key: "loanRef", width: 18 },
    { header: "Borrower", key: "borrower", width: 24 },
    { header: "Collateral", key: "collateral", width: 28 },
    { header: "Principal (USD)", key: "principal", width: 16 },
    { header: "Your Share %", key: "sharePct", width: 12 },
    { header: "Start", key: "start", width: 12 },
    { header: "Maturity", key: "end", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Your Return (USD)", key: "investorProfit", width: 16 },
    { header: "Overdue Penalty (Your Share, USD)", key: "penalty", width: 22 },
  ];
  applyHdrStyle(s3.getRow(1));

  loanRows.forEach((row, i) => {
    const r = s3.addRow({
      loanRef: row.loanRef + (row.isCoInvestor ? " (referral)" : ""),
      borrower: row.borrower,
      collateral: row.collateral,
      principal: row.principal,
      sharePct: row.sharePct,
      start: fmtDate(row.start),
      end: row.end ? fmtDate(row.end) : "—",
      status: STATUS_LABEL[row.status] || row.status,
      investorProfit: row.investorProfit,
      penalty: row.penaltyInvestorShare || 0,
    });
    const flagRow = row.status === "grace_period" || row.status === "auction";
    applyAltRow(r, i, flagRow ? `FF${ROSE}` : undefined);
    r.getCell("principal").numFmt = USD;
    r.getCell("principal").alignment = rightAlign;
    r.getCell("sharePct").numFmt = PCT;
    r.getCell("sharePct").alignment = rightAlign;
    r.getCell("investorProfit").numFmt = USD;
    r.getCell("investorProfit").alignment = rightAlign;
    r.getCell("penalty").numFmt = USD;
    r.getCell("penalty").alignment = rightAlign;
    if (row.penaltyInvestorShare > 0) {
      r.getCell("penalty").font = { ...bodyFont, bold: true, color: { argb: "FFDC2626" } };
    }
  });

  const footNote = s3.addRow(["Rows highlighted red are past their grace period or headed to auction — a 10% penalty (your share shown) applies."]);
  s3.mergeCells(`A${footNote.number}:J${footNote.number}`);
  footNote.getCell(1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };

  return wb;
}

// ─── RTC platform-wide revenue report ────────────────────────────────────────────

async function buildRtcRevenueReportWorkbook() {
  const rtcAccount = await investorAllocationService.getRtcAccount();
  const rtcId = rtcAccount._id.toString();

  const allAllocations = await InvestorLoanAllocation.find({ status: { $ne: "cancelled" } })
    .populate("investor_id", "name email kind")
    .populate({
      path: "loan_id",
      select: "due_date",
      populate: [
        { path: "customer_user", select: "first_name last_name" },
        { path: "asset", select: "title" },
      ],
    });

  const externalAllocs = allAllocations.filter((a) => a.investor_id?._id?.toString() !== rtcId);
  const rtcOwnAllocs = allAllocations.filter((a) => a.investor_id?._id?.toString() === rtcId);

  const totalRtcRevenueFromExternal = externalAllocs.reduce((s, a) => s + (a.rtc_revenue || 0), 0);
  // RTC's own book: it funds these loans itself, so BOTH the "investor" share and the
  // "RTC" share belong to RTC — the split is an artifact of the shared profit-split
  // model, not a real division of ownership. Total profit = 100% RTC's.
  const totalRtcOwnProfit = rtcOwnAllocs.reduce((s, a) => s + (a.investor_profit || 0) + (a.rtc_revenue || 0), 0);

  const byCategory = {};
  for (const a of allAllocations) {
    const cat = a.collateral_category || "other";
    byCategory[cat] = byCategory[cat] || { revenue: 0, principal: 0, count: 0 };
    const isRtcOwn = a.investor_id?._id?.toString() === rtcId;
    byCategory[cat].revenue += isRtcOwn ? (a.investor_profit || 0) + (a.rtc_revenue || 0) : (a.rtc_revenue || 0);
    byCategory[cat].principal += a.is_co_investor ? 0 : (a.principal_amount || 0);
    byCategory[cat].count += 1;
  }

  // Admin fees are a Loan-level concept, independent of which investor (if any) funded the
  // loan — 100% RTC revenue, never split with or shown to an investor. Aggregated straight
  // from Loan, not from InvestorLoanAllocation, since that's the source of truth for it.
  const feeLoans = await Loan.find({ admin_fee_amount: { $gt: 0 } }).select(
    "loan_no admin_fee_amount admin_fee_type admin_fee_pct admin_fee_collected collateral_category",
  );
  const totalAdminFees = feeLoans.reduce((s, l) => s + (l.admin_fee_amount || 0), 0);

  const byInvestor = new Map();
  for (const a of externalAllocs) {
    const inv = a.investor_id;
    if (!inv) continue;
    const key = inv._id.toString();
    if (!byInvestor.has(key)) byInvestor.set(key, { name: inv.name, email: inv.email, kind: inv.kind, principal: 0, rtcRevenue: 0, loanCount: 0 });
    const e = byInvestor.get(key);
    if (!a.is_co_investor) e.principal += a.principal_amount || 0;
    e.rtcRevenue += a.rtc_revenue || 0;
    e.loanCount += 1;
  }
  const investorRows = Array.from(byInvestor.values()).sort((a, b) => b.rtcRevenue - a.rtcRevenue);

  const wb = new ExcelJS.Workbook();
  wb.creator = "RealTimeCapital System";
  wb.created = new Date();
  const now = new Date();

  // ══════════════ SHEET 1 — RTC Revenue Summary ══════════════
  const s1 = wb.addWorksheet("RTC Revenue Summary", { properties: { tabColor: { argb: `FF${BRAND}` } } });
  s1.views = [{ showGridLines: false }];
  s1.columns = [{ width: 40 }, { width: 18 }, { width: 4 }, { width: 30 }, { width: 16 }];
  titleBanner(s1, "Real Time Capital — Platform Revenue Report", `Generated: ${fmtDate(now)}  |  All figures all-time, non-cancelled loans only`, "E");

  const addSection = (title) => {
    const r = s1.addRow([title]);
    s1.mergeCells(`A${r.number}:E${r.number}`);
    r.getCell(1).font = { bold: true, size: 12, color: { argb: `FF${HEADER}` } };
    r.height = 22;
  };
  const addLine = (label, value, i, opts = {}) => {
    const r = s1.addRow([label, value]);
    r.getCell(1).font = opts.bold ? boldFont : bodyFont;
    r.getCell(2).font = opts.bold ? boldFont : bodyFont;
    r.getCell(2).numFmt = USD;
    r.getCell(2).alignment = rightAlign;
    r.eachCell({ includeEmpty: true }, (c) => { c.border = cellBorder; });
    if (i % 2 === 1) r.eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${ALT_ROW}` } }; });
    return r;
  };

  let idx = 0;
  addSection("REVENUE FROM EXTERNAL INVESTORS (RTC's split on their capital)");
  addLine(`Revenue Share (${externalAllocs.length} loan${externalAllocs.length === 1 ? "" : "s"} across ${investorRows.length} investor${investorRows.length === 1 ? "" : "s"})`, totalRtcRevenueFromExternal, idx++, { bold: true });
  s1.addRow([]);

  addSection("RTC's OWN DIRECT LOAN BOOK (e.g. small loans — 100% RTC's own capital & profit)");
  addLine(`Own Loan Profit (${rtcOwnAllocs.length} loan${rtcOwnAllocs.length === 1 ? "" : "s"})`, totalRtcOwnProfit, idx++, { bold: true });
  s1.addRow([]);

  addSection("ADMIN FEES (negotiated at loan creation — 100% RTC revenue, separate from interest)");
  addLine(`Admin Fees Collected (${feeLoans.length} loan${feeLoans.length === 1 ? "" : "s"})`, totalAdminFees, idx++, { bold: true });
  s1.addRow([]);

  addSection("TOTAL RTC INCOME");
  const totalRow = addLine(
    "Total RTC Income (external revenue share + own loan profit + admin fees)",
    totalRtcRevenueFromExternal + totalRtcOwnProfit + totalAdminFees,
    idx++,
    { bold: true },
  );
  totalRow.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
    c.font = { bold: true, size: 11, name: "Calibri" };
  });
  s1.addRow([]);

  addSection("BY COLLATERAL CATEGORY");
  const catHdr = s1.addRow(["Category", "RTC Revenue/Profit", "", "Principal Deployed", "Loan Count"]);
  applyHdrStyle(catHdr, `FF${AMBER}`);
  Object.entries(byCategory).sort((a, b) => b[1].revenue - a[1].revenue).forEach(([cat, v], i) => {
    const r = s1.addRow([cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), v.revenue, "", v.principal, v.count]);
    applyAltRow(r, i);
    r.getCell(2).numFmt = USD; r.getCell(2).alignment = rightAlign;
    r.getCell(4).numFmt = USD; r.getCell(4).alignment = rightAlign;
    r.getCell(5).alignment = rightAlign;
  });

  // ══════════════ SHEET 2 — Revenue by Investor ══════════════
  const s2 = wb.addWorksheet("Revenue by Investor", { properties: { tabColor: { argb: "FF3B82F6" } } });
  s2.views = [{ state: "frozen", ySplit: 1 }];
  s2.columns = [
    { header: "Investor", key: "name", width: 26 },
    { header: "Email", key: "email", width: 28 },
    { header: "Kind", key: "kind", width: 16 },
    { header: "Loans Funded", key: "loanCount", width: 14 },
    { header: "Their Principal (USD)", key: "principal", width: 18 },
    { header: "RTC Revenue From Them (USD)", key: "rtcRevenue", width: 22 },
    { header: "% of Total RTC Revenue", key: "pctOfTotal", width: 18 },
  ];
  applyHdrStyle(s2.getRow(1));
  investorRows.forEach((e, i) => {
    const r = s2.addRow({
      name: e.name,
      email: e.email,
      kind: e.kind,
      loanCount: e.loanCount,
      principal: e.principal,
      rtcRevenue: e.rtcRevenue,
      pctOfTotal: totalRtcRevenueFromExternal > 0 ? (e.rtcRevenue / totalRtcRevenueFromExternal) * 100 : 0,
    });
    applyAltRow(r, i);
    r.getCell("principal").numFmt = USD; r.getCell("principal").alignment = rightAlign;
    r.getCell("rtcRevenue").numFmt = USD; r.getCell("rtcRevenue").alignment = rightAlign;
    r.getCell("pctOfTotal").numFmt = PCT; r.getCell("pctOfTotal").alignment = rightAlign;
    r.getCell("loanCount").alignment = rightAlign;
  });

  // ══════════════ SHEET 3 — RTC's Own Loans ══════════════
  const s3 = wb.addWorksheet("RTC's Own Loans", { properties: { tabColor: { argb: `FF${AMBER}` } } });
  s3.views = [{ state: "frozen", ySplit: 1 }];
  s3.columns = [
    { header: "Loan Ref", key: "loanRef", width: 18 },
    { header: "Borrower", key: "borrower", width: 24 },
    { header: "Collateral", key: "collateral", width: 24 },
    { header: "Category", key: "category", width: 14 },
    { header: "Principal (USD)", key: "principal", width: 16 },
    { header: "Start", key: "start", width: 12 },
    { header: "Maturity", key: "end", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Total Profit (USD)", key: "profit", width: 16 },
  ];
  applyHdrStyle(s3.getRow(1));
  rtcOwnAllocs
    .sort((a, b) => new Date(a.loan_date || a.allocated_at) - new Date(b.loan_date || b.allocated_at))
    .forEach((a, i) => {
      const display = resolveAllocationDisplay(a);
      const status = computeAllocationStatus(a, display.maturityDate);
      const r = s3.addRow({
        loanRef: a.loan_no || "—",
        borrower: display.borrowerName,
        collateral: display.collateral,
        category: (a.collateral_category || "—").replace(/_/g, " "),
        principal: a.principal_amount || 0,
        start: fmtDate(a.loan_date || a.allocated_at),
        end: display.maturityDate ? fmtDate(display.maturityDate) : "—",
        status: STATUS_LABEL[status] || status,
        profit: (a.investor_profit || 0) + (a.rtc_revenue || 0),
      });
      applyAltRow(r, i);
      r.getCell("principal").numFmt = USD; r.getCell("principal").alignment = rightAlign;
      r.getCell("profit").numFmt = USD; r.getCell("profit").alignment = rightAlign;
    });

  // ══════════════ SHEET 4 — Admin Fees ══════════════
  const s4 = wb.addWorksheet("Admin Fees", { properties: { tabColor: { argb: "FFEF4444" } } });
  s4.views = [{ state: "frozen", ySplit: 1 }];
  s4.columns = [
    { header: "Loan Ref", key: "loanRef", width: 18 },
    { header: "Category", key: "category", width: 16 },
    { header: "Fee %", key: "pct", width: 10 },
    { header: "Fee Amount (USD)", key: "amount", width: 16 },
    { header: "Type", key: "type", width: 12 },
    { header: "Collected", key: "collected", width: 12 },
  ];
  applyHdrStyle(s4.getRow(1));
  feeLoans.forEach((l, i) => {
    const r = s4.addRow({
      loanRef: l.loan_no || "—",
      category: (l.collateral_category || "—").replace(/_/g, " "),
      pct: l.admin_fee_pct || 0,
      amount: l.admin_fee_amount || 0,
      type: l.admin_fee_type === "upfront" ? "Upfront" : "Deferred",
      collected: l.admin_fee_type === "upfront" ? (l.admin_fee_collected ? "Yes" : "No") : "N/A (in balance)",
    });
    applyAltRow(r, i);
    r.getCell("pct").numFmt = PCT; r.getCell("pct").alignment = rightAlign;
    r.getCell("amount").numFmt = USD; r.getCell("amount").alignment = rightAlign;
  });
  if (feeLoans.length === 0) {
    const r = s4.addRow(["No admin fees charged on any loan yet."]);
    s4.mergeCells(`A${r.number}:F${r.number}`);
    r.getCell(1).font = { italic: true, size: 10, color: { argb: "FF64748B" } };
  }

  return wb;
}

module.exports = {
  buildInvestorStatementWorkbook,
  buildRtcRevenueReportWorkbook,
};
