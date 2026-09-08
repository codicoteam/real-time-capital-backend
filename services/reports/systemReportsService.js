"use strict";

const Loan = require("../../models/loan.model");
const { excelKit, pdfKit } = require("./reportStyleKit");
const dataSources = require("./reportDataSources");
const PDFDocument = require("pdfkit");

const { ExcelJS, COLORS, fmtDate: xlFmtDate, applyHdrStyle, applyAltRow, statusFill, addTitleBanner, NUMFMT } = excelKit;

function parseRange(options = {}) {
  const { startDate, endDate } = options;
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setDate(now.getDate() - 30);

  const start = startDate ? new Date(startDate) : defaultStart;
  const end = endDate ? new Date(endDate) : now;
  // Treat endDate as end-of-day so a same-day range isn't empty.
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("Invalid dates.");
  if (start > end) throw new Error("startDate must be before endDate.");
  return { start, end, now };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

class SystemReportsService {
  // ══════════════════════════════════════════════════════════════════════
  // Shared builders — a KPI list + a single detail table, the shape every
  // report below (other than Disbursement, which predates this and works fine
  // as-is) uses. Keeping this in one place means brand/layout consistency
  // across all 7 reports comes for free.
  // ══════════════════════════════════════════════════════════════════════
  _buildSummaryExcel({ title, start, end, now, kpis, tableTitle, columns, rows, footnote }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "RealTimeCapital System";
    wb.created = new Date();

    const s1 = wb.addWorksheet("Summary", { properties: { tabColor: { argb: `FF${COLORS.BRAND}` } } });
    s1.views = [{ showGridLines: false }];
    addTitleBanner(s1, { title, start, end, generatedAt: now, cols: 3 });

    const kpiHdr = s1.addRow(["KPI", "Value", ""]);
    applyHdrStyle(kpiHdr);
    kpis.forEach((kpi, i) => {
      const r = s1.addRow([kpi.label, kpi.value, ""]);
      applyAltRow(r, i);
      r.getCell(2).numFmt = kpi.numFmt || NUMFMT.USD;
      r.getCell(2).font = { bold: true, size: 10, name: "Calibri", color: { argb: `FF${COLORS.HEADER}` } };
      r.getCell(2).alignment = excelKit.rightAlign;
    });
    [40, 20, 4].forEach((w, i) => (s1.getColumn(i + 1).width = w));

    if (footnote) {
      s1.addRow([]);
      const fnRow = s1.addRow([footnote]);
      fnRow.getCell(1).font = { italic: true, size: 9, name: "Calibri", color: { argb: "FF64748B" } };
    }

    const s2 = wb.addWorksheet(tableTitle, { properties: { tabColor: { argb: "FF3B82F6" } } });
    s2.views = [{ showGridLines: false, state: "frozen", ySplit: 2 }];
    s2.mergeCells(`A1:${String.fromCharCode(64 + columns.length)}1`);
    const s2Title = s2.getCell("A1");
    s2Title.value = `${tableTitle} — ${xlFmtDate(start)} to ${xlFmtDate(end)} (${rows.length} records)`;
    s2Title.font = { bold: true, size: 13, color: { argb: `FF${COLORS.WHITE}` }, name: "Calibri" };
    s2Title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.DARK}` } };
    s2.getRow(1).height = 28;

    const hdrRow = s2.addRow(columns.map((c) => c.header));
    applyHdrStyle(hdrRow);
    columns.forEach((c, i) => (s2.getColumn(i + 1).width = c.width));

    rows.forEach((r, i) => {
      const rowValues = columns.map((c) => {
        const v = r[c.key];
        if (c.numFmt === NUMFMT.DT && v) return new Date(v);
        return v;
      });
      const excelRow = s2.addRow(rowValues);
      applyAltRow(excelRow, i);
      columns.forEach((c, ci) => {
        if (c.numFmt) {
          excelRow.getCell(ci + 1).numFmt = c.numFmt;
          excelRow.getCell(ci + 1).alignment = excelKit.rightAlign;
        }
      });
      if (r.__statusKey) {
        const statusCol = columns.findIndex((c) => c.key === r.__statusKey.key);
        if (statusCol !== -1) {
          excelRow.getCell(statusCol + 1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: statusFill(r.__statusKey.value) },
          };
        }
      }
    });

    return wb;
  }

  _buildSummaryPdf({ title, start, end, now, kpis, columns, rows }) {
    const doc = pdfKit.newPdfDoc(PDFDocument);
    let y = pdfKit.drawTitleBanner(doc, { title, start, end, generatedAt: now });
    y = pdfKit.drawKpiGrid(
      doc,
      kpis.map((k) => ({ label: k.label, value: k.numFmt === NUMFMT.NUM ? String(k.value) : pdfKit.fmtCurrency(k.value) })),
      y,
    );

    const redrawHeader = (d, startY) => pdfKit.drawTableHeader(d, columns, startY);
    y = redrawHeader(doc, y + 10);

    rows.forEach((r, i) => {
      y = pdfKit.checkPageBreak(doc, y, 16, redrawHeader);
      y = pdfKit.drawTableRow(doc, columns, r, y, i);
    });

    pdfKit.finalizeWithFooters(doc);
    return doc;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Loan Disbursement Report
  // ══════════════════════════════════════════════════════════════════════
  async _getDisbursementData(options) {
    const { start, end, now } = parseRange(options);

    const loans = await Loan.find({ disbursement_date: { $gte: start, $lte: end } })
      .sort({ disbursement_date: -1 })
      .populate("customer_user", "first_name last_name email phone")
      .populate("disbursed_by", "first_name last_name")
      .lean();

    const rows = loans.map((l) => ({
      loan_no: l.loan_no,
      customer_name: `${l.customer_user?.first_name || ""} ${l.customer_user?.last_name || ""}`.trim() || "—",
      customer_email: l.customer_user?.email || "",
      customer_phone: l.customer_user?.phone || "",
      collateral_category: l.collateral_category,
      loan_period_type: l.loan_period_type,
      principal_amount: round2(l.principal_amount),
      expected_total_repayable: round2(l.expected_total_repayable),
      interest_amount: round2(l.interest_amount),
      storage_charge_amount: round2(l.storage_charge_amount),
      payment_method: l.payment_method || "",
      disbursement_date: l.disbursement_date,
      due_date: l.due_date,
      disbursed_by: l.disbursed_by ? `${l.disbursed_by.first_name || ""} ${l.disbursed_by.last_name || ""}`.trim() : "",
      status: l.status,
    }));

    const totals = rows.reduce(
      (acc, r) => {
        acc.count += 1;
        acc.principal += r.principal_amount;
        acc.expected_repayable += r.expected_total_repayable;
        acc.interest += r.interest_amount;
        acc.storage += r.storage_charge_amount;
        return acc;
      },
      { count: 0, principal: 0, expected_repayable: 0, interest: 0, storage: 0 },
    );
    totals.avg_principal = totals.count ? round2(totals.principal / totals.count) : 0;

    const byCategory = rows.reduce((acc, r) => {
      const key = r.collateral_category || "unknown";
      acc[key] = acc[key] || { count: 0, principal: 0 };
      acc[key].count += 1;
      acc[key].principal += r.principal_amount;
      return acc;
    }, {});

    return { start, end, now, rows, totals, byCategory };
  }

  async getDisbursementReportData(options) {
    const { rows, totals, byCategory, start, end } = await this._getDisbursementData(options);
    return { data: { rows, totals, byCategory, period: { start, end } } };
  }

  async exportDisbursementExcel(options) {
    const { rows, totals, byCategory, start, end, now } = await this._getDisbursementData(options);

    const wb = new ExcelJS.Workbook();
    wb.creator = "RealTimeCapital System";
    wb.created = new Date();

    // ── Sheet 1: Summary ──
    const s1 = wb.addWorksheet("Summary", { properties: { tabColor: { argb: `FF${COLORS.BRAND}` } } });
    s1.views = [{ showGridLines: false }];
    addTitleBanner(s1, { title: "REAL TIME CAPITAL — Loan Disbursement Report", start, end, generatedAt: now, cols: 4 });

    const kpiHdr = s1.addRow(["KPI", "Value", "", ""]);
    applyHdrStyle(kpiHdr);
    const kpis = [
      ["Loans Disbursed", totals.count],
      ["Total Principal Disbursed", totals.principal],
      ["Expected Total Repayable", totals.expected_repayable],
      ["Total Interest On Books", totals.interest],
      ["Total Storage Charges", totals.storage],
      ["Average Loan Size", totals.avg_principal],
    ];
    kpis.forEach((row, i) => {
      const r = s1.addRow([row[0], row[1], "", ""]);
      applyAltRow(r, i);
      if (i > 0) r.getCell(2).numFmt = NUMFMT.USD;
      r.getCell(2).font = { bold: true, size: 10, name: "Calibri", color: { argb: `FF${COLORS.HEADER}` } };
      r.getCell(2).alignment = excelKit.rightAlign;
    });
    s1.addRow([]);

    const catHdr = s1.addRow(["Collateral Category", "Loans", "Principal", ""]);
    applyHdrStyle(catHdr, `FF${COLORS.SUB_HDR}`);
    catHdr.eachCell((c) => (c.font = { bold: true, size: 10, name: "Calibri", color: { argb: `FF${COLORS.DARK}` } }));
    Object.entries(byCategory).forEach(([cat, v], i) => {
      const r = s1.addRow([cat, v.count, round2(v.principal), ""]);
      applyAltRow(r, i);
      r.getCell(3).numFmt = NUMFMT.USD;
      r.getCell(3).alignment = excelKit.rightAlign;
    });
    [40, 20, 20, 4].forEach((w, i) => (s1.getColumn(i + 1).width = w));

    // ── Sheet 2: Loans ──
    const s2 = wb.addWorksheet("Disbursements", { properties: { tabColor: { argb: "FF3B82F6" } } });
    s2.views = [{ showGridLines: false, state: "frozen", ySplit: 3 }];
    s2.mergeCells("A1:K1");
    const s2Title = s2.getCell("A1");
    s2Title.value = `Disbursements — ${xlFmtDate(start)} to ${xlFmtDate(end)} (${rows.length} records)`;
    s2Title.font = { bold: true, size: 13, color: { argb: `FF${COLORS.WHITE}` }, name: "Calibri" };
    s2Title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COLORS.DARK}` } };
    s2.getRow(1).height = 28;
    s2.addRow([]);

    const cols = [
      { header: "Loan #", key: "loan_no", width: 16 },
      { header: "Customer", key: "customer_name", width: 24 },
      { header: "Email", key: "customer_email", width: 26 },
      { header: "Phone", key: "customer_phone", width: 16 },
      { header: "Collateral", key: "collateral_category", width: 16 },
      { header: "Term", key: "loan_period_type", width: 12 },
      { header: "Principal", key: "principal_amount", width: 16, numFmt: NUMFMT.USD },
      { header: "Expected Repayable", key: "expected_total_repayable", width: 18, numFmt: NUMFMT.USD },
      { header: "Method", key: "payment_method", width: 14 },
      { header: "Disbursed", key: "disbursement_date", width: 14, numFmt: NUMFMT.DT },
      { header: "Due", key: "due_date", width: 14, numFmt: NUMFMT.DT },
    ];
    const hdrRow = s2.addRow(cols.map((c) => c.header));
    applyHdrStyle(hdrRow);
    cols.forEach((c, i) => (s2.getColumn(i + 1).width = c.width));

    rows.forEach((r, i) => {
      const rowValues = cols.map((c) => {
        if (c.key === "disbursement_date" || c.key === "due_date") return r[c.key] ? new Date(r[c.key]) : null;
        return r[c.key];
      });
      const excelRow = s2.addRow(rowValues);
      applyAltRow(excelRow, i);
      cols.forEach((c, ci) => {
        if (c.numFmt) {
          excelRow.getCell(ci + 1).numFmt = c.numFmt;
          excelRow.getCell(ci + 1).alignment = excelKit.rightAlign;
        }
      });
    });

    return wb;
  }

  async exportDisbursementPdf(options) {
    const { rows, totals, start, end, now } = await this._getDisbursementData(options);
    const doc = pdfKit.newPdfDoc(PDFDocument);

    let y = pdfKit.drawTitleBanner(doc, { title: "Real Time Capital — Loan Disbursement Report", start, end, generatedAt: now });
    y = pdfKit.drawKpiGrid(
      doc,
      [
        { label: "Loans Disbursed", value: String(totals.count) },
        { label: "Total Principal", value: pdfKit.fmtCurrency(totals.principal) },
        { label: "Expected Repayable", value: pdfKit.fmtCurrency(totals.expected_repayable) },
        { label: "Interest On Books", value: pdfKit.fmtCurrency(totals.interest) },
        { label: "Storage Charges", value: pdfKit.fmtCurrency(totals.storage) },
        { label: "Average Loan Size", value: pdfKit.fmtCurrency(totals.avg_principal) },
      ],
      y,
    );

    const columns = [
      { header: "Loan #", key: "loan_no", width: 65 },
      { header: "Customer", key: "customer_name", width: 95 },
      { header: "Category", key: "collateral_category", width: 70 },
      { header: "Principal", key: "principal_amount_fmt", width: 65, align: "right" },
      { header: "Repayable", key: "expected_total_repayable_fmt", width: 65, align: "right" },
      { header: "Disbursed", key: "disbursement_date_fmt", width: 70 },
      { header: "Due", key: "due_date_fmt", width: 70 },
    ];

    const redrawHeader = (d, startY) => pdfKit.drawTableHeader(d, columns, startY);
    y = redrawHeader(doc, y + 10);

    rows.forEach((r, i) => {
      y = pdfKit.checkPageBreak(doc, y, 16, redrawHeader);
      y = pdfKit.drawTableRow(
        doc,
        columns,
        {
          loan_no: r.loan_no,
          customer_name: r.customer_name,
          collateral_category: r.collateral_category,
          principal_amount_fmt: pdfKit.fmtCurrency(r.principal_amount),
          expected_total_repayable_fmt: pdfKit.fmtCurrency(r.expected_total_repayable),
          disbursement_date_fmt: pdfKit.fmtDate(r.disbursement_date),
          due_date_fmt: pdfKit.fmtDate(r.due_date),
        },
        y,
        i,
      );
    });

    pdfKit.finalizeWithFooters(doc);
    return doc;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Daily / Monthly Collections Reports — share the reconciled-payments
  // source (services/reports/reportDataSources.js getReconciledPayments,
  // which dedupes the Payment-model vs. legacy-embedded double-count trap);
  // only the grouping granularity differs.
  // ══════════════════════════════════════════════════════════════════════
  async _getCollectionsData(options, granularity) {
    const { start, end, now } = parseRange(options);
    const payments = await dataSources.getReconciledPayments(start, end);

    const keyFn = (d) =>
      granularity === "month" ? new Date(d).toISOString().slice(0, 7) : new Date(d).toISOString().slice(0, 10);

    const groups = {};
    let legacyCount = 0;
    payments.forEach((p) => {
      const key = keyFn(p.date);
      groups[key] = groups[key] || { period: key, count: 0, amount: 0, principal: 0, interest: 0, storage: 0, penalty: 0 };
      groups[key].count += 1;
      groups[key].amount += p.amount;
      groups[key].principal += p.principal_component;
      groups[key].interest += p.interest_component;
      groups[key].storage += p.storage_component;
      groups[key].penalty += p.penalty_component;
      if (!p.has_component_split) legacyCount += 1;
    });

    const rows = Object.values(groups)
      .map((g) => ({
        period: g.period,
        count: g.count,
        amount: round2(g.amount),
        principal: round2(g.principal),
        interest: round2(g.interest),
        storage: round2(g.storage),
        penalty: round2(g.penalty),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const totals = rows.reduce(
      (acc, r) => {
        acc.count += r.count;
        acc.amount += r.amount;
        acc.principal += r.principal;
        acc.interest += r.interest;
        acc.storage += r.storage;
        acc.penalty += r.penalty;
        return acc;
      },
      { count: 0, amount: 0, principal: 0, interest: 0, storage: 0, penalty: 0 },
    );

    return { start, end, now, rows, totals, legacyCount };
  }

  _collectionsKpis(totals) {
    return [
      { label: "Total Collected", value: totals.amount },
      { label: "Number of Payments", value: totals.count, numFmt: NUMFMT.NUM },
      { label: "Principal Collected", value: totals.principal },
      { label: "Interest Collected", value: totals.interest },
      { label: "Storage Collected", value: totals.storage },
      { label: "Penalty Collected", value: totals.penalty },
    ];
  }

  async getDailyCollectionsData(options) {
    const { rows, totals, legacyCount, start, end } = await this._getCollectionsData(options, "day");
    return { data: { rows, totals, legacyCount, period: { start, end } } };
  }

  async getMonthlyCollectionsData(options) {
    const { rows, totals, legacyCount, start, end } = await this._getCollectionsData(options, "month");
    return { data: { rows, totals, legacyCount, period: { start, end } } };
  }

  async _exportCollectionsExcel(options, granularity, title, tableTitle) {
    const { rows, totals, legacyCount, start, end, now } = await this._getCollectionsData(options, granularity);
    const cols = [
      { header: "Period", key: "period", width: 20 },
      { header: "Payments", key: "count", width: 12, numFmt: NUMFMT.NUM },
      { header: "Total Collected", key: "amount", width: 18, numFmt: NUMFMT.USD },
      { header: "Principal", key: "principal", width: 16, numFmt: NUMFMT.USD },
      { header: "Interest", key: "interest", width: 16, numFmt: NUMFMT.USD },
      { header: "Storage", key: "storage", width: 16, numFmt: NUMFMT.USD },
      { header: "Penalty", key: "penalty", width: 16, numFmt: NUMFMT.USD },
    ];
    const footnote =
      legacyCount > 0
        ? `Note: ${legacyCount} repayment(s) recorded via the in-person/legacy flow are included as principal-only — a component (interest/storage/penalty) breakdown is not available for that recording path.`
        : null;
    return this._buildSummaryExcel({
      title: `REAL TIME CAPITAL — ${title}`,
      start,
      end,
      now,
      kpis: this._collectionsKpis(totals),
      tableTitle,
      columns: cols,
      rows,
      footnote,
    });
  }

  async _exportCollectionsPdf(options, granularity, title) {
    const { rows, totals, start, end, now } = await this._getCollectionsData(options, granularity);
    const cols = [
      { header: "Period", key: "period", width: 90 },
      { header: "Payments", key: "count_fmt", width: 60, align: "right" },
      { header: "Total", key: "amount_fmt", width: 75, align: "right" },
      { header: "Principal", key: "principal_fmt", width: 75, align: "right" },
      { header: "Interest", key: "interest_fmt", width: 65, align: "right" },
      { header: "Storage", key: "storage_fmt", width: 65, align: "right" },
      { header: "Penalty", key: "penalty_fmt", width: 65, align: "right" },
    ];
    const pdfRows = rows.map((r) => ({
      period: r.period,
      count_fmt: String(r.count),
      amount_fmt: pdfKit.fmtCurrency(r.amount),
      principal_fmt: pdfKit.fmtCurrency(r.principal),
      interest_fmt: pdfKit.fmtCurrency(r.interest),
      storage_fmt: pdfKit.fmtCurrency(r.storage),
      penalty_fmt: pdfKit.fmtCurrency(r.penalty),
    }));
    return this._buildSummaryPdf({
      title: `Real Time Capital — ${title}`,
      start,
      end,
      now,
      kpis: this._collectionsKpis(totals),
      columns: cols,
      rows: pdfRows,
    });
  }

  exportDailyCollectionsExcel(options) {
    return this._exportCollectionsExcel(options, "day", "Daily Collections Report", "Daily Collections");
  }
  exportMonthlyCollectionsExcel(options) {
    return this._exportCollectionsExcel(options, "month", "Monthly Collections Report", "Monthly Collections");
  }
  exportDailyCollectionsPdf(options) {
    return this._exportCollectionsPdf(options, "day", "Daily Collections Report");
  }
  exportMonthlyCollectionsPdf(options) {
    return this._exportCollectionsPdf(options, "month", "Monthly Collections Report");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Defaulters Report — dynamic lateness (no cron exists; see
  // reportDataSources.getLoanAgingBuckets for why status can't be trusted).
  // ══════════════════════════════════════════════════════════════════════
  async _getDefaultersData(options) {
    const { end: asOf, now } = parseRange(options);
    const { defaulters } = await dataSources.getDefaulters(asOf);
    const rows = defaulters
      .sort((a, b) => b.days_late - a.days_late)
      .map((d) => ({
        loan_no: d.loan_no,
        customer_name: `${d.customer?.first_name || ""} ${d.customer?.last_name || ""}`.trim() || "—",
        customer_phone: d.customer?.phone || "",
        collateral_category: d.collateral_category,
        asset_title: d.asset?.title || "",
        principal_amount: round2(d.principal_amount),
        current_balance: round2(d.current_balance),
        due_date: d.due_date,
        days_late: d.days_late,
        bucket: d.bucket,
      }));
    const totals = {
      count: rows.length,
      outstanding: round2(rows.reduce((s, r) => s + r.current_balance, 0)),
      avgDaysLate: rows.length ? Math.round(rows.reduce((s, r) => s + r.days_late, 0) / rows.length) : 0,
    };
    return { asOf, now, rows, totals };
  }

  async getDefaultersReportData(options) {
    const { rows, totals, asOf } = await this._getDefaultersData(options);
    return { data: { rows, totals, asOf } };
  }

  async exportDefaultersExcel(options) {
    const { rows, totals, asOf, now } = await this._getDefaultersData(options);
    const cols = [
      { header: "Loan #", key: "loan_no", width: 16 },
      { header: "Customer", key: "customer_name", width: 24 },
      { header: "Phone", key: "customer_phone", width: 16 },
      { header: "Collateral", key: "collateral_category", width: 16 },
      { header: "Asset", key: "asset_title", width: 20 },
      { header: "Principal", key: "principal_amount", width: 14, numFmt: NUMFMT.USD },
      { header: "Balance", key: "current_balance", width: 14, numFmt: NUMFMT.USD },
      { header: "Due Date", key: "due_date", width: 14, numFmt: NUMFMT.DT },
      { header: "Days Overdue", key: "days_late", width: 14, numFmt: NUMFMT.NUM },
      { header: "Bucket", key: "bucket", width: 12 },
    ];
    return this._buildSummaryExcel({
      title: "REAL TIME CAPITAL — Defaulters Report",
      start: asOf,
      end: asOf,
      now,
      kpis: [
        { label: "Total Defaulters", value: totals.count, numFmt: NUMFMT.NUM },
        { label: "Total Outstanding Balance", value: totals.outstanding },
        { label: "Average Days Overdue", value: totals.avgDaysLate, numFmt: NUMFMT.NUM },
      ],
      tableTitle: "Defaulters",
      columns: cols,
      rows: rows.map((r) => ({ ...r, __statusKey: { key: "bucket", value: r.bucket } })),
    });
  }

  async exportDefaultersPdf(options) {
    const { rows, totals, asOf, now } = await this._getDefaultersData(options);
    const cols = [
      { header: "Loan #", key: "loan_no", width: 80 },
      { header: "Customer", key: "customer_name", width: 85 },
      { header: "Collateral", key: "collateral_category", width: 60 },
      { header: "Balance", key: "current_balance_fmt", width: 60, align: "right" },
      { header: "Due", key: "due_date_fmt", width: 65 },
      { header: "Days Overdue", key: "days_late_fmt", width: 60, align: "right" },
      { header: "Bucket", key: "bucket", width: 65 },
    ];
    const pdfRows = rows.map((r) => ({
      ...r,
      current_balance_fmt: pdfKit.fmtCurrency(r.current_balance),
      due_date_fmt: pdfKit.fmtDate(r.due_date),
      days_late_fmt: String(r.days_late),
    }));
    return this._buildSummaryPdf({
      title: "Real Time Capital — Defaulters Report",
      start: asOf,
      end: asOf,
      now,
      kpis: [
        { label: "Total Defaulters", value: totals.count, numFmt: NUMFMT.NUM },
        { label: "Outstanding Balance", value: totals.outstanding },
        { label: "Avg Days Overdue", value: totals.avgDaysLate, numFmt: NUMFMT.NUM },
      ],
      columns: cols,
      rows: pdfRows,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Loan Aging Report
  // ══════════════════════════════════════════════════════════════════════
  async _getAgingData(options) {
    const { end: asOf, now } = parseRange(options);
    const { buckets, loans } = await dataSources.getLoanAgingBuckets(asOf);
    const rows = loans
      .filter((l) => l.bucket !== "current")
      .sort((a, b) => b.days_late - a.days_late)
      .map((l) => ({
        loan_no: l.loan_no,
        customer_name: `${l.customer?.first_name || ""} ${l.customer?.last_name || ""}`.trim() || "—",
        collateral_category: l.collateral_category,
        current_balance: round2(l.current_balance),
        due_date: l.due_date,
        days_late: l.days_late,
        bucket: l.bucket,
      }));
    return { asOf, now, buckets, rows };
  }

  async getAgingReportData(options) {
    const { buckets, rows, asOf } = await this._getAgingData(options);
    return { data: { buckets, rows, asOf } };
  }

  async exportAgingExcel(options) {
    const { buckets, rows, asOf, now } = await this._getAgingData(options);
    const cols = [
      { header: "Loan #", key: "loan_no", width: 16 },
      { header: "Customer", key: "customer_name", width: 24 },
      { header: "Collateral", key: "collateral_category", width: 16 },
      { header: "Balance", key: "current_balance", width: 14, numFmt: NUMFMT.USD },
      { header: "Due Date", key: "due_date", width: 14, numFmt: NUMFMT.DT },
      { header: "Days Overdue", key: "days_late", width: 14, numFmt: NUMFMT.NUM },
      { header: "Bucket", key: "bucket", width: 12 },
    ];
    const kpis = dataSources.AGING_BUCKETS.map((b) => ({
      label: `${b}`,
      value: buckets[b]?.outstanding_balance || 0,
    }));
    return this._buildSummaryExcel({
      title: "REAL TIME CAPITAL — Loan Aging Report",
      start: asOf,
      end: asOf,
      now,
      kpis,
      tableTitle: "Aging Detail",
      columns: cols,
      rows: rows.map((r) => ({ ...r, __statusKey: { key: "bucket", value: r.bucket } })),
    });
  }

  async exportAgingPdf(options) {
    const { buckets, rows, asOf, now } = await this._getAgingData(options);
    const cols = [
      { header: "Loan #", key: "loan_no", width: 80 },
      { header: "Customer", key: "customer_name", width: 95 },
      { header: "Collateral", key: "collateral_category", width: 65 },
      { header: "Balance", key: "current_balance_fmt", width: 65, align: "right" },
      { header: "Due", key: "due_date_fmt", width: 65 },
      { header: "Bucket", key: "bucket", width: 60 },
    ];
    const pdfRows = rows.map((r) => ({
      ...r,
      current_balance_fmt: pdfKit.fmtCurrency(r.current_balance),
      due_date_fmt: pdfKit.fmtDate(r.due_date),
    }));
    const kpis = dataSources.AGING_BUCKETS.filter((b) => b !== "current").map((b) => ({
      label: `${b} days`,
      value: buckets[b]?.outstanding_balance || 0,
    }));
    return this._buildSummaryPdf({
      title: "Real Time Capital — Loan Aging Report",
      start: asOf,
      end: asOf,
      now,
      kpis,
      columns: cols,
      rows: pdfRows,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Revenue Report — cash-basis (matches the Xero integration's own
  // philosophy: count auction cash actually received, not just a winning
  // bid that may not be paid yet).
  // ══════════════════════════════════════════════════════════════════════
  async _getRevenueData(options) {
    const { start, end, now } = parseRange(options);
    const payments = await dataSources.getReconciledPayments(start, end);
    const interestIncome = round2(payments.reduce((s, p) => s + p.interest_component, 0));
    const storageIncome = round2(payments.reduce((s, p) => s + p.storage_component, 0));
    const penaltyIncome = round2(payments.reduce((s, p) => s + p.penalty_component, 0));
    const auction = await dataSources.getAuctionCashReceived(start, end);
    const titleDeed = await dataSources.getTitleDeedIncome(start, end);

    const totalRevenue = round2(interestIncome + storageIncome + penaltyIncome + auction.total + titleDeed.rtc_share);

    const rows = [
      { source: "Interest Income (Pawn Loans)", amount: interestIncome },
      { source: "Storage Charge Income", amount: storageIncome },
      { source: "Penalty Income", amount: penaltyIncome },
      { source: "Auction Sale Revenue", amount: round2(auction.total) },
      { source: "Title Deed Interest Income (RTC Share)", amount: round2(titleDeed.rtc_share) },
    ];

    return {
      start,
      end,
      now,
      rows,
      totals: {
        interestIncome,
        storageIncome,
        penaltyIncome,
        auctionRevenue: round2(auction.total),
        titleDeedRtcShare: round2(titleDeed.rtc_share),
        totalRevenue,
      },
    };
  }

  _revenueKpis(totals) {
    return [
      { label: "Total Revenue", value: totals.totalRevenue },
      { label: "Interest Income", value: totals.interestIncome },
      { label: "Storage Income", value: totals.storageIncome },
      { label: "Penalty Income", value: totals.penaltyIncome },
      { label: "Auction Revenue", value: totals.auctionRevenue },
      { label: "Title Deed Interest (RTC Share)", value: totals.titleDeedRtcShare },
    ];
  }

  async getRevenueReportData(options) {
    const { rows, totals, start, end } = await this._getRevenueData(options);
    return { data: { rows, totals, period: { start, end } } };
  }

  async exportRevenueExcel(options) {
    const { rows, totals, start, end, now } = await this._getRevenueData(options);
    const cols = [
      { header: "Revenue Source", key: "source", width: 40 },
      { header: "Amount", key: "amount", width: 18, numFmt: NUMFMT.USD },
    ];
    return this._buildSummaryExcel({
      title: "REAL TIME CAPITAL — Revenue Report",
      start,
      end,
      now,
      kpis: this._revenueKpis(totals),
      tableTitle: "Revenue Breakdown",
      columns: cols,
      rows,
      footnote:
        "Title Deed Interest is shown at RTC's share only — the investor's share is a pass-through, not RTC revenue. Deeds already linked to an InvestorLoanAllocation are excluded to avoid double-counting.",
    });
  }

  async exportRevenuePdf(options) {
    const { rows, totals, start, end, now } = await this._getRevenueData(options);
    const cols = [
      { header: "Revenue Source", key: "source", width: 300 },
      { header: "Amount", key: "amount_fmt", width: 145, align: "right" },
    ];
    const pdfRows = rows.map((r) => ({ source: r.source, amount_fmt: pdfKit.fmtCurrency(r.amount) }));
    return this._buildSummaryPdf({
      title: "Real Time Capital — Revenue Report",
      start,
      end,
      now,
      kpis: this._revenueKpis(totals),
      columns: cols,
      rows: pdfRows,
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cashflow Statement Report
  // ══════════════════════════════════════════════════════════════════════
  async _getCashflowData(options) {
    const { start, end, now } = parseRange(options);
    const payments = await dataSources.getReconciledPayments(start, end);
    const repaymentsIn = round2(payments.reduce((s, p) => s + p.amount, 0));

    const [investorTx, expenses, disbursements, auction, titleDeed] = await Promise.all([
      dataSources.getInvestorTransactions(start, end),
      dataSources.getExpensesByCategory(start, end),
      dataSources.getDisbursementTotal(start, end),
      dataSources.getAuctionCashReceived(start, end),
      dataSources.getTitleDeedIncome(start, end),
    ]);

    const inflows = [
      { line: "Loan Repayments Collected", amount: repaymentsIn },
      { line: "Investor Capital Deposits", amount: round2(investorTx.deposit.total) },
      { line: "Auction Sale Proceeds", amount: round2(auction.total) },
      { line: "Title Deed Interest (RTC Share)", amount: round2(titleDeed.rtc_share) },
    ];
    const outflows = [
      { line: "Loan Disbursements", amount: round2(disbursements.total) },
      { line: "Operating Expenses", amount: round2(expenses.total) },
      { line: "Investor Capital Withdrawals", amount: round2(investorTx.capital_withdrawal.total) },
      { line: "Investor Profit Withdrawals", amount: round2(investorTx.profit_withdrawal.total) },
      { line: "Investor Drawings", amount: round2(investorTx.drawing.total) },
    ];

    const totalIn = round2(inflows.reduce((s, r) => s + r.amount, 0));
    const totalOut = round2(outflows.reduce((s, r) => s + r.amount, 0));
    const net = round2(totalIn - totalOut);

    const rows = [
      { line: "CASH INFLOWS", amount: null },
      ...inflows,
      { line: "Total Inflows", amount: totalIn },
      { line: "CASH OUTFLOWS", amount: null },
      ...outflows.map((r) => ({ line: r.line, amount: -r.amount })),
      { line: "Total Outflows", amount: -totalOut },
      { line: "NET CASHFLOW", amount: net },
    ];

    return { start, end, now, rows, totals: { totalIn, totalOut, net } };
  }

  async getCashflowReportData(options) {
    const { rows, totals, start, end } = await this._getCashflowData(options);
    return { data: { rows, totals, period: { start, end } } };
  }

  _cashflowKpis(totals) {
    return [
      { label: "Total Cash In", value: totals.totalIn },
      { label: "Total Cash Out", value: totals.totalOut },
      { label: "Net Cashflow", value: totals.net },
    ];
  }

  async exportCashflowExcel(options) {
    const { rows, totals, start, end, now } = await this._getCashflowData(options);
    const cols = [
      { header: "Line Item", key: "line", width: 40 },
      { header: "Amount", key: "amount", width: 18, numFmt: NUMFMT.USD },
    ];
    return this._buildSummaryExcel({
      title: "REAL TIME CAPITAL — Cashflow Statement",
      start,
      end,
      now,
      kpis: this._cashflowKpis(totals),
      tableTitle: "Cashflow Detail",
      columns: cols,
      rows: rows.map((r) => (r.amount == null ? { line: r.line, amount: "" } : r)),
    });
  }

  async exportCashflowPdf(options) {
    const { rows, totals, start, end, now } = await this._getCashflowData(options);
    const cols = [
      { header: "Line Item", key: "line", width: 300 },
      { header: "Amount", key: "amount_fmt", width: 145, align: "right" },
    ];
    const pdfRows = rows.map((r) => ({ line: r.line, amount_fmt: r.amount == null ? "" : pdfKit.fmtCurrency(r.amount) }));
    return this._buildSummaryPdf({
      title: "Real Time Capital — Cashflow Statement",
      start,
      end,
      now,
      kpis: this._cashflowKpis(totals),
      columns: cols,
      rows: pdfRows,
    });
  }
}

module.exports = new SystemReportsService();
