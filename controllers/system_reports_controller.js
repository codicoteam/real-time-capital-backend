"use strict";

const systemReportsService = require("../services/reports/systemReportsService");

function periodSlug(startDate, endDate) {
  const s = startDate ? String(startDate).slice(0, 10) : "start";
  const e = endDate ? String(endDate).slice(0, 10) : "end";
  return `${s}_to_${e}`;
}

function streamExcel(res, workbook, filenameBase) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  return workbook.xlsx.write(res).then(() => res.end());
}

function streamPdf(res, doc, filenameBase) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.pdf"`);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  doc.pipe(res);
  doc.end();
}

// Generates get/exportExcel/exportPdf handlers for a report given the service's
// method names — every one of the 7 reports follows this identical shape, so this
// avoids 21 near-identical hand-written handler functions.
function makeReportHandlers({ getData, exportExcel, exportPdf, filenameBase }) {
  return {
    async get(req, res) {
      try {
        const { startDate, endDate } = req.query;
        const result = await systemReportsService[getData]({ startDate, endDate });
        res.json({ success: true, ...result });
      } catch (error) {
        console.error(`[SystemReports] ${getData} error:`, error);
        res.status(400).json({ success: false, message: error.message });
      }
    },
    async exportExcelHandler(req, res) {
      try {
        const { startDate, endDate } = req.query;
        const wb = await systemReportsService[exportExcel]({ startDate, endDate });
        await streamExcel(res, wb, `RealTimeCapital_${filenameBase}_${periodSlug(startDate, endDate)}`);
      } catch (error) {
        console.error(`[SystemReports] ${exportExcel} error:`, error);
        res.status(400).json({ success: false, message: error.message });
      }
    },
    async exportPdfHandler(req, res) {
      try {
        const { startDate, endDate } = req.query;
        const doc = await systemReportsService[exportPdf]({ startDate, endDate });
        streamPdf(res, doc, `RealTimeCapital_${filenameBase}_${periodSlug(startDate, endDate)}`);
      } catch (error) {
        console.error(`[SystemReports] ${exportPdf} error:`, error);
        res.status(400).json({ success: false, message: error.message });
      }
    },
  };
}

const disbursement = makeReportHandlers({
  getData: "getDisbursementReportData",
  exportExcel: "exportDisbursementExcel",
  exportPdf: "exportDisbursementPdf",
  filenameBase: "LoanDisbursement",
});
const dailyCollections = makeReportHandlers({
  getData: "getDailyCollectionsData",
  exportExcel: "exportDailyCollectionsExcel",
  exportPdf: "exportDailyCollectionsPdf",
  filenameBase: "DailyCollections",
});
const monthlyCollections = makeReportHandlers({
  getData: "getMonthlyCollectionsData",
  exportExcel: "exportMonthlyCollectionsExcel",
  exportPdf: "exportMonthlyCollectionsPdf",
  filenameBase: "MonthlyCollections",
});
const defaulters = makeReportHandlers({
  getData: "getDefaultersReportData",
  exportExcel: "exportDefaultersExcel",
  exportPdf: "exportDefaultersPdf",
  filenameBase: "Defaulters",
});
const revenue = makeReportHandlers({
  getData: "getRevenueReportData",
  exportExcel: "exportRevenueExcel",
  exportPdf: "exportRevenuePdf",
  filenameBase: "Revenue",
});
const loanAging = makeReportHandlers({
  getData: "getAgingReportData",
  exportExcel: "exportAgingExcel",
  exportPdf: "exportAgingPdf",
  filenameBase: "LoanAging",
});
const cashflow = makeReportHandlers({
  getData: "getCashflowReportData",
  exportExcel: "exportCashflowExcel",
  exportPdf: "exportCashflowPdf",
  filenameBase: "CashflowStatement",
});

module.exports = {
  disbursement,
  dailyCollections,
  monthlyCollections,
  defaulters,
  revenue,
  loanAging,
  cashflow,
};
