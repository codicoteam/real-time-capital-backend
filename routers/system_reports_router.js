"use strict";

const express = require("express");
const router = express.Router();
const reports = require("../controllers/system_reports_controller");
const { authMiddleware } = require("../middlewares/auth_middleware");

router.use(authMiddleware);

// Registers GET /<slug>, GET /<slug>/export/excel, GET /<slug>/export/pdf for one report.
function mount(slug, handlers) {
  router.get(`/${slug}`, handlers.get);
  router.get(`/${slug}/export/excel`, handlers.exportExcelHandler);
  router.get(`/${slug}/export/pdf`, handlers.exportPdfHandler);
}

mount("loan-disbursement", reports.disbursement);
mount("daily-collections", reports.dailyCollections);
mount("monthly-collections", reports.monthlyCollections);
mount("defaulters", reports.defaulters);
mount("revenue", reports.revenue);
mount("loan-aging", reports.loanAging);
mount("cashflow-statement", reports.cashflow);

module.exports = router;
