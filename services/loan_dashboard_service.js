// services/loan_report_service.js
"use strict";

const mongoose = require("mongoose");
const ExcelJS = require("exceljs");
const Loan = require("../models/loan.model");
const LoanApplication = require("../models/loanApplication.model");
const User = require("../models/user.model");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATE_RANGE_DAYS = 30;

/** Statuses that represent a live or settled disbursed loan */
const ACTIVE_LOAN_STATUSES = [
  "active",
  "overdue",
  "in_grace",
  "partially_paid",
  "redeemed",
  "defaulted",
];

/** Statuses that generate actual interest revenue (money was lent) */
const REVENUE_LOAN_STATUSES = [
  "active",
  "overdue",
  "in_grace",
  "partially_paid",
  "redeemed",
  "defaulted",
  "written_off",
];

/** Application statuses considered "live" in the pipeline */
const PIPELINE_APP_STATUSES = ["submitted", "processing", "approved"];

// ---------------------------------------------------------------------------

class LoanReportService {
  /**
   * Generate the loan financial report.
   * @param {{ startDate?: string, endDate?: string }} options
   */
  async getLoanReportData(options = {}) {
    const { startDate, endDate } = options;

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() - DEFAULT_DATE_RANGE_DAYS);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end = endDate ? new Date(endDate) : now;

    // Validate dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid startDate or endDate provided.");
    }
    if (start > end) {
      throw new Error("startDate must be before endDate.");
    }

    const [
      loanSummary,
      applicationSummary,
      interestRevenue,
      projectedRevenue,
      loansByStatus,
      applicationsByStatus,
      loansByCollateral,
      applicationsByCollateral,
      loanDisbursementTrend,
      applicationTrend,
      interestTrend,
      repaymentTypeSplit,
      loanList,
      applicationList,
    ] = await Promise.all([
      this._getLoanSummary(start, end),
      this._getApplicationSummary(start, end),
      this._getInterestRevenue(start, end),
      this._getProjectedRevenueFromApplications(start, end),
      this._getLoansByStatus(start, end),
      this._getApplicationsByStatus(start, end),
      this._getLoansByCollateralCategory(start, end),
      this._getApplicationsByCollateralCategory(start, end),
      this._getLoanDisbursementTrend(start, end),
      this._getApplicationTrend(start, end),
      this._getInterestRevenueTrend(start, end),
      this._getRepaymentTypeSplit(start, end),
      this._getLoanList(start, end),
      this._getApplicationList(start, end),
    ]);

    return {
      success: true,
      data: {
        period: {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
        },

        // ── Financial summary cards ──
        financial_summary: {
          // Loans disbursed in period
          total_loans_disbursed: loanSummary.count,
          total_principal_disbursed: this._round(loanSummary.total_principal),
          total_expected_repayable: this._round(
            loanSummary.total_expected_repayable,
          ),
          total_interest_on_books: this._round(loanSummary.total_interest),
          total_collected_payments: this._round(loanSummary.total_paid),
          total_outstanding_balance: this._round(
            loanSummary.total_current_balance,
          ),

          // Actual interest earned (from payments already received)
          actual_interest_earned: this._round(interestRevenue.actual_earned),

          // Projected from active/overdue loans not yet fully paid
          projected_remaining_interest: this._round(
            interestRevenue.projected_remaining,
          ),

          // What we COULD earn if ALL period applications were approved + disbursed
          projected_interest_from_applications: this._round(
            projectedRevenue.projected_interest,
          ),
          projected_total_repayable_from_applications: this._round(
            projectedRevenue.projected_total_repayable,
          ),

          // Applications pipeline
          total_applications: applicationSummary.count,
          total_requested_amount: this._round(
            applicationSummary.total_requested,
          ),

          // Averages
          avg_loan_amount: this._round(loanSummary.avg_principal),
          avg_interest_rate_percent: this._round(loanSummary.avg_interest_rate),
        },

        // ── Charts (5 charts) ──
        charts: {
          // Chart 1: Loan disbursement trend (principal over time)
          loan_disbursement_trend: loanDisbursementTrend,

          // Chart 2: Application volume trend by status over time
          application_trend: applicationTrend,

          // Chart 3: Loans by status (pie/donut)
          loans_by_status: loansByStatus,

          // Chart 4: Interest revenue earned vs projected over time
          interest_revenue_trend: interestTrend,

          // Chart 5: Collateral category breakdown (loans vs applications)
          collateral_category_breakdown: {
            loans: loansByCollateral,
            applications: applicationsByCollateral,
          },
        },

        // ── Supplementary breakdowns ──
        breakdowns: {
          loans_by_status: loansByStatus,
          applications_by_status: applicationsByStatus,
          loans_by_collateral: loansByCollateral,
          applications_by_collateral: applicationsByCollateral,
          repayment_type_split: repaymentTypeSplit,
        },

        // ── Detailed lists (populated) ──
        tables: {
          loans: loanList,
          loan_applications: applicationList,
        },
      },
      message: "Loan financial report generated successfully.",
    };
  }

  // ─────────────────────── Private helpers ───────────────────────

  /** Round to 2 decimal places */
  _round(val) {
    return Math.round((Number(val) || 0) * 100) / 100;
  }

  /**
   * Summary totals for Loans created (disbursed) in the period.
   * Uses created_at to scope to the period; does NOT filter by status so that
   * ALL loans created in the window are counted regardless of current status.
   */
  async _getLoanSummary(start, end) {
    const [result] = await Loan.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total_principal: { $sum: "$principal_amount" },
          total_expected_repayable: { $sum: "$expected_total_repayable" },
          total_current_balance: { $sum: "$current_balance" },
          total_paid: { $sum: "$total_paid" },
          avg_principal: { $avg: "$principal_amount" },
          avg_interest_rate: { $avg: "$interest_rate_percent" },
        },
      },
    ]);

    if (!result) {
      return {
        count: 0,
        total_principal: 0,
        total_expected_repayable: 0,
        total_current_balance: 0,
        total_paid: 0,
        avg_principal: 0,
        avg_interest_rate: 0,
        total_interest: 0,
      };
    }

    // Total interest on books = expected_total_repayable - principal
    const total_interest =
      (result.total_expected_repayable || 0) - (result.total_principal || 0);

    return { ...result, total_interest };
  }

  /**
   * Summary totals for LoanApplications created in the period.
   */
  async _getApplicationSummary(start, end) {
    const [result] = await LoanApplication.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total_requested: { $sum: "$requested_loan_amount" },
          avg_requested: { $avg: "$requested_loan_amount" },
        },
      },
    ]);

    return result ? result : { count: 0, total_requested: 0, avg_requested: 0 };
  }

  /**
   * Actual interest earned: sum of (total_paid - principal repaid) across
   * loans in the period.
   *
   * Since the Loan model tracks total_paid and principal_amount we estimate:
   *   actual_earned  = SUM(MIN(total_paid, expected_total_repayable) - principal_already_collected)
   *
   * Safer proxy (no Payment model dependency):
   *   For each loan, interest_earned = MAX(0, total_paid - principal_amount)
   *   capped at the interest portion (expected_total_repayable - principal_amount).
   *
   * projected_remaining = SUM(expected_total_repayable - total_paid) for
   * loans that are NOT yet redeemed/written_off/cancelled.
   */
  async _getInterestRevenue(start, end) {
    const loans = await Loan.find(
      { created_at: { $gte: start, $lte: end } },
      {
        principal_amount: 1,
        expected_total_repayable: 1,
        total_paid: 1,
        status: 1,
      },
    ).lean();

    let actual_earned = 0;
    let projected_remaining = 0;

    for (const loan of loans) {
      const principal = loan.principal_amount || 0;
      const expected = loan.expected_total_repayable || 0;
      const paid = loan.total_paid || 0;
      const interestPortion = Math.max(0, expected - principal);

      // Interest collected = paid amount that exceeds the principal
      const interestCollected = Math.min(
        Math.max(0, paid - principal),
        interestPortion,
      );
      actual_earned += interestCollected;

      // Remaining projected interest only for open loans
      const closedStatuses = ["redeemed", "cancelled", "written_off"];
      if (!closedStatuses.includes(loan.status)) {
        const remainingInterest = Math.max(
          0,
          interestPortion - interestCollected,
        );
        projected_remaining += remainingInterest;
      }
    }

    return { actual_earned, projected_remaining };
  }

  /**
   * What we COULD earn if all applications in the pipeline get approved and disbursed.
   * Uses interest_amount and total_repayable_amount set by the loan officer.
   * Falls back to 0 when fields are absent (not yet set).
   */
  async _getProjectedRevenueFromApplications(start, end) {
    const [result] = await LoanApplication.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          status: { $in: PIPELINE_APP_STATUSES },
        },
      },
      {
        $group: {
          _id: null,
          projected_interest: { $sum: { $ifNull: ["$interest_amount", 0] } },
          projected_total_repayable: {
            $sum: { $ifNull: ["$total_repayable_amount", 0] },
          },
          projected_principal: { $sum: "$requested_loan_amount" },
        },
      },
    ]);

    if (!result) {
      return {
        projected_interest: 0,
        projected_total_repayable: 0,
        projected_principal: 0,
      };
    }

    // If interest_amount was not set by officer, fall back to rate estimate
    // (best effort — only applies when interest_amount is missing on apps)
    return result;
  }

  /**
   * Count of loans grouped by status, restricted to period.
   */
  async _getLoansByStatus(start, end) {
    const rows = await Loan.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      data: rows.map((r) => r.count),
      raw: rows.reduce((acc, r) => {
        acc[r._id] = r.count;
        return acc;
      }, {}),
    };
  }

  /**
   * Count of applications grouped by status, restricted to period.
   */
  async _getApplicationsByStatus(start, end) {
    const rows = await LoanApplication.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      data: rows.map((r) => r.count),
      raw: rows.reduce((acc, r) => {
        acc[r._id] = r.count;
        return acc;
      }, {}),
    };
  }

  /**
   * Loan principal + interest grouped by collateral category in the period.
   */
  async _getLoansByCollateralCategory(start, end) {
    const rows = await Loan.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$collateral_category",
          count: { $sum: 1 },
          total_principal: { $sum: "$principal_amount" },
          total_interest: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: ["$expected_total_repayable", "$principal_amount"],
                },
              ],
            },
          },
        },
      },
      { $sort: { total_principal: -1 } },
    ]);

    return rows.map((r) => ({
      category: r._id,
      count: r.count,
      total_principal: this._round(r.total_principal),
      total_interest: this._round(r.total_interest),
    }));
  }

  /**
   * Application requested amounts grouped by collateral category.
   */
  async _getApplicationsByCollateralCategory(start, end) {
    const rows = await LoanApplication.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$collateral_category",
          count: { $sum: 1 },
          total_requested: { $sum: "$requested_loan_amount" },
          projected_interest: {
            $sum: { $ifNull: ["$interest_amount", 0] },
          },
        },
      },
      { $sort: { total_requested: -1 } },
    ]);

    return rows.map((r) => ({
      category: r._id,
      count: r.count,
      total_requested: this._round(r.total_requested),
      projected_interest: this._round(r.projected_interest),
    }));
  }

  /**
   * Chart 1: Daily principal disbursed + number of loans in the period.
   */
  async _getLoanDisbursementTrend(start, end) {
    const rows = await Loan.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
          },
          total_principal: { $sum: "$principal_amount" },
          total_interest: {
            $sum: {
              $max: [
                0,
                {
                  $subtract: ["$expected_total_repayable", "$principal_amount"],
                },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      datasets: [
        {
          label: "Principal Disbursed (USD)",
          data: rows.map((r) => this._round(r.total_principal)),
        },
        {
          label: "Interest on Books (USD)",
          data: rows.map((r) => this._round(r.total_interest)),
        },
        {
          label: "Number of Loans",
          data: rows.map((r) => r.count),
          yAxisID: "count",
        },
      ],
    };
  }

  /**
   * Chart 2: Daily application count by status in the period.
   */
  async _getApplicationTrend(start, end) {
    const TRACKED = [
      "submitted",
      "processing",
      "approved",
      "rejected",
      "cancelled",
    ];

    const rows = await LoanApplication.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
            },
            status: "$status",
          },
          count: { $sum: 1 },
          total_requested: { $sum: "$requested_loan_amount" },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]);

    const labels = Array.from(new Set(rows.map((r) => r._id.date))).sort();

    const dataMap = TRACKED.reduce((acc, s) => {
      acc[s] = new Array(labels.length).fill(0);
      return acc;
    }, {});

    const amountData = new Array(labels.length).fill(0);

    rows.forEach((r) => {
      const idx = labels.indexOf(r._id.date);
      if (idx !== -1) {
        if (dataMap[r._id.status]) {
          dataMap[r._id.status][idx] += r.count;
        }
        amountData[idx] += r.total_requested || 0;
      }
    });

    return {
      labels,
      datasets: [
        ...TRACKED.map((s) => ({
          label: s.charAt(0).toUpperCase() + s.slice(1),
          data: dataMap[s],
          stack: "status",
        })),
        {
          label: "Total Requested Amount (USD)",
          data: amountData.map((v) => this._round(v)),
          yAxisID: "amount",
        },
      ],
    };
  }

  /**
   * Chart 4: Daily interest earned (proxy: payments above principal) over time.
   * Since payments are embedded in Loan.payments[], we query the loans and
   * sum their embedded payment arrays scoped to the period dates.
   */
  async _getInterestRevenueTrend(start, end) {
    /**
     * Unwind the embedded payments array on each loan and group by date.
     * interest_component proxy = amount - principal, capped at 0.
     * When expected_total_repayable is set we can derive the interest fraction.
     */
    const rows = await Loan.aggregate([
      {
        $match: {
          created_at: { $gte: start, $lte: end },
          "payments.0": { $exists: true }, // has at least one payment
        },
      },
      { $unwind: "$payments" },
      {
        $match: {
          "payments.payment_date": { $gte: start, $lte: end },
        },
      },
      {
        $addFields: {
          interest_fraction: {
            $cond: [
              { $gt: ["$expected_total_repayable", "$principal_amount"] },
              {
                $divide: [
                  {
                    $subtract: [
                      "$expected_total_repayable",
                      "$principal_amount",
                    ],
                  },
                  "$expected_total_repayable",
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$payments.payment_date",
            },
          },
          total_payment: { $sum: "$payments.amount" },
          estimated_interest: {
            $sum: {
              $multiply: ["$payments.amount", "$interest_fraction"],
            },
          },
          payment_count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      labels: rows.map((r) => r._id),
      datasets: [
        {
          label: "Total Payments Received (USD)",
          data: rows.map((r) => this._round(r.total_payment)),
        },
        {
          label: "Estimated Interest Component (USD)",
          data: rows.map((r) => this._round(r.estimated_interest)),
        },
        {
          label: "Number of Payments",
          data: rows.map((r) => r.payment_count),
          yAxisID: "count",
        },
      ],
    };
  }

  /**
   * Loan period split — two_weeks vs one_month breakdown for loans in period.
   */
  async _getRepaymentTypeSplit(start, end) {
    const rows = await Loan.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$loan_period_type",
          count: { $sum: 1 },
          total_principal: { $sum: "$principal_amount" },
        },
      },
    ]);

    return rows.map((r) => ({
      type: r._id || "unknown",
      count: r.count,
      total_principal: this._round(r.total_principal),
    }));
  }

  /**
   * Full loan list (populated) for the period.
   * Populates: customer name, profile fields, national_id.
   */
  async _getLoanList(start, end) {
    const loans = await Loan.find({ created_at: { $gte: start, $lte: end } })
      .sort({ created_at: -1 })
      .populate(
        "customer_user",
        "first_name last_name email phone national_id_number profile_pic_url kyc_verification_status",
      )
      .populate("application", "application_no requested_loan_amount status")
      .lean();

    return loans.map((l) => {
      const customer = l.customer_user || {};
      const interestOnBook = Math.max(
        0,
        (l.expected_total_repayable || 0) - (l.principal_amount || 0),
      );
      const interestCollected = Math.max(
        0,
        Math.min(
          Math.max(0, (l.total_paid || 0) - (l.principal_amount || 0)),
          interestOnBook,
        ),
      );

      return {
        loan_id: l._id,
        loan_no: l.loan_no,
        status: l.status,
        collateral_category: l.collateral_category,
        repayment_type: "once_off",
        loan_period_type: l.loan_period_type || null,
        currency: l.currency || "USD",

        // Financials
        principal_amount: this._round(l.principal_amount),
        expected_total_repayable: this._round(l.expected_total_repayable),
        interest_on_book: this._round(interestOnBook),
        total_paid: this._round(l.total_paid),
        current_balance: this._round(l.current_balance),
        interest_collected: this._round(interestCollected),
        interest_rate_percent: this._round(l.interest_rate_percent),
        storage_charge_percent: this._round(l.storage_charge_percent),

        // Dates
        start_date: l.start_date,
        due_date: l.due_date,
        disbursement_date: l.disbursement_date,
        created_at: l.created_at,

        // Linked application
        application_no: l.application?.application_no || null,

        // Customer
        customer: {
          id: customer._id,
          full_name:
            `${customer.first_name || ""} ${customer.last_name || ""}`.trim(),
          email: customer.email,
          phone: customer.phone,
          national_id_number: customer.national_id_number,
          profile_pic_url: customer.profile_pic_url,
          kyc_status: customer.kyc_verification_status,
        },
      };
    });
  }

  /**
   * Full loan application list (populated) for the period.
   */
  async _getApplicationList(start, end) {
    const apps = await LoanApplication.find({
      created_at: { $gte: start, $lte: end },
    })
      .sort({ created_at: -1 })
      .populate(
        "customer_user",
        "first_name last_name email phone national_id_number profile_pic_url kyc_verification_status",
      )
      .lean();

    return apps.map((a) => {
      const customer = a.customer_user || {};

      return {
        application_id: a._id,
        application_no: a.application_no,
        status: a.status,
        collateral_category: a.collateral_category,
        repayment_type: "once_off",
        loan_period_type: a.loan_period_type || null,
        application_source: a.application_source,

        // Financials
        requested_loan_amount: this._round(a.requested_loan_amount),
        interest_rate: this._round(a.interest_rate),
        interest_amount: this._round(a.interest_amount),
        total_repayable_amount: this._round(a.total_repayable_amount),
        declared_asset_value: this._round(a.declared_asset_value),

        // Dates
        created_at: a.created_at,
        declaration_signed_at: a.declaration_signed_at,

        // Customer
        customer: {
          id: customer._id,
          full_name:
            `${customer.first_name || ""} ${customer.last_name || ""}`.trim(),
          email: customer.email,
          phone: customer.phone,
          national_id_number: customer.national_id_number,
          profile_pic_url: customer.profile_pic_url,
          kyc_status: customer.kyc_verification_status,
        },
      };
    });
  }

  // ─────────────────────── Excel Export ─────────────────────────────────────

  /**
   * Build and return an ExcelJS Workbook for the given date range.
   * Sheets: Summary | Loans | Loan Applications | Breakdowns
   */
  async exportLoanReportExcel(options = {}) {
    const { startDate, endDate } = options;

    const now = new Date();
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() - DEFAULT_DATE_RANGE_DAYS);

    const start = startDate ? new Date(startDate) : defaultStart;
    const end   = endDate   ? new Date(endDate)   : now;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw new Error("Invalid dates.");
    if (start > end) throw new Error("startDate must be before endDate.");

    const [
      loanSummary, applicationSummary, interestRevenue, projectedRevenue,
      loansByStatus, applicationsByStatus,
      loansByCollateral, applicationsByCollateral,
      repaymentTypeSplit, loanList, applicationList,
    ] = await Promise.all([
      this._getLoanSummary(start, end),
      this._getApplicationSummary(start, end),
      this._getInterestRevenue(start, end),
      this._getProjectedRevenueFromApplications(start, end),
      this._getLoansByStatus(start, end),
      this._getApplicationsByStatus(start, end),
      this._getLoansByCollateralCategory(start, end),
      this._getApplicationsByCollateralCategory(start, end),
      this._getRepaymentTypeSplit(start, end),
      this._getLoanList(start, end),
      this._getApplicationList(start, end),
    ]);

    // ── Workbook ──────────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "RealTimeCapital System";
    wb.created  = new Date();
    wb.modified = new Date();

    // ── Shared styles ─────────────────────────────────────────────────────────
    const BRAND   = "10B981"; // emerald
    const DARK    = "0F172A";
    const HEADER  = "064E3B"; // dark emerald
    const SUB_HDR = "D1FAE5"; // light emerald
    const ALT_ROW = "F0FDF4";
    const WHITE   = "FFFFFF";
    const BORDER_COLOR = "CBD5E1";
    const WARN    = "FEF3C7"; // amber light

    const thin = { style: "thin", color: { argb: `FF${BORDER_COLOR}` } };
    const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };

    const hdrFont  = { bold: true, size: 11, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    const bodyFont = { size: 10, name: "Calibri" };
    const boldFont = { bold: true, size: 10, name: "Calibri" };

    const centerAlign   = { horizontal: "center",  vertical: "middle" };
    const leftAlign     = { horizontal: "left",    vertical: "middle" };
    const rightAlign    = { horizontal: "right",   vertical: "middle" };

    const USD = '"$"#,##0.00';
    const PCT = '0.00"%"';
    const NUM = '#,##0';
    const DT  = 'yyyy-mm-dd';

    const fmtDate = (d) => {
      if (!d) return "";
      try { return new Date(d).toISOString().split("T")[0]; } catch { return ""; }
    };

    const applyHdrStyle = (row, bgArgb = `FF${HEADER}`) => {
      row.height = 22;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font   = hdrFont;
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
        cell.border = cellBorder;
        cell.alignment = centerAlign;
      });
    };

    const applyAltRow = (row, idx) => {
      const bg = idx % 2 === 0 ? `FF${WHITE}` : `FF${ALT_ROW}`;
      row.height = 18;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font   = bodyFont;
        cell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        cell.border = cellBorder;
        if (cell.alignment?.horizontal !== "right") cell.alignment = leftAlign;
      });
    };

    const statusFill = (status) => {
      const map = {
        active:       "D1FAE5", overdue:     "FEE2E2", defaulted:    "FEE2E2",
        redeemed:     "CCFBF1", cancelled:   "FEF3C7", written_off:  "F1F5F9",
        submitted:    "DBEAFE", processing:  "EDE9FE", approved:     "BAE6FD",
        rejected:     "FEE2E2", draft:       "F1F5F9", in_grace:     "DBEAFE",
        partially_paid:"CFFAFE",loan_created:"F3E8FF",
      };
      const key = String(status || "").toLowerCase().replace(/[\s-]+/g, "_");
      return map[key] ? `FF${map[key]}` : `FF${WHITE}`;
    };

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 1 — Executive Summary
    // ══════════════════════════════════════════════════════════════════════════
    const s1 = wb.addWorksheet("Executive Summary", { properties: { tabColor: { argb: `FF${BRAND}` } } });
    s1.views = [{ showGridLines: false }];

    // Title banner
    s1.mergeCells("A1:F1");
    const titleCell = s1.getCell("A1");
    titleCell.value = "REALTIMECAPITAL — Loan & Application Financial Report";
    titleCell.font  = { bold: true, size: 16, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    titleCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
    titleCell.alignment = centerAlign;
    s1.getRow(1).height = 36;

    s1.mergeCells("A2:F2");
    const subCell = s1.getCell("A2");
    subCell.value = `Report Period: ${fmtDate(start)} to ${fmtDate(end)}   |   Generated: ${fmtDate(now)}`;
    subCell.font  = { size: 10, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    subCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER}` } };
    subCell.alignment = centerAlign;
    s1.getRow(2).height = 20;

    s1.addRow([]);

    // Section: Financial KPIs
    const kpiHdr = s1.addRow(["KPI", "Value", "", "KPI", "Value", ""]);
    applyHdrStyle(kpiHdr);

    const totalInterest = this._round((loanSummary.total_expected_repayable || 0) - (loanSummary.total_principal || 0));
    const kpis = [
      ["Loans Disbursed (Period)", loanSummary.count || 0,                          "Loan Applications (Period)", applicationSummary.count || 0],
      ["Total Principal Disbursed", this._round(loanSummary.total_principal),        "Total Requested (Apps)",      this._round(applicationSummary.total_requested)],
      ["Expected Total Repayable",  this._round(loanSummary.total_expected_repayable),"Projected Interest (Apps)",  this._round(projectedRevenue.projected_interest)],
      ["Total Interest On Books",   totalInterest,                                    "Proj. Total Repayable (Apps)",this._round(projectedRevenue.projected_total_repayable)],
      ["Total Payments Collected",  this._round(loanSummary.total_paid),             "Avg Loan Amount",             this._round(loanSummary.avg_principal)],
      ["Outstanding Balance",       this._round(loanSummary.total_current_balance),  "Avg Interest Rate",           this._round(loanSummary.avg_interest_rate)],
      ["Actual Interest Earned",    this._round(interestRevenue.actual_earned),       "Projected Remaining Interest",this._round(interestRevenue.projected_remaining)],
    ];

    kpis.forEach((row, i) => {
      const r = s1.addRow([row[0], row[1], "", row[2], row[3], ""]);
      const bg = i % 2 === 0 ? `FF${WHITE}` : `FF${ALT_ROW}`;
      r.height = 20;

      const labelStyle = (c) => {
        c.font   = boldFont;
        c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.border = cellBorder;
        c.alignment = leftAlign;
      };
      const valStyle = (c, isNum) => {
        c.font   = { size: 10, name: "Calibri", color: { argb: `FF${HEADER}` }, bold: true };
        c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.border = cellBorder;
        c.alignment = rightAlign;
        if (isNum && typeof row[1] === "number") {
          c.numFmt = i > 0 ? USD : NUM; // row 0 = count, rest = money
        }
      };

      const isMoneyRow = i > 0;
      labelStyle(r.getCell(1));
      valStyle(r.getCell(2), isMoneyRow);
      r.getCell(3).border = cellBorder;
      labelStyle(r.getCell(4));
      valStyle(r.getCell(5), isMoneyRow);
      r.getCell(6).border = cellBorder;

      if (isMoneyRow) {
        r.getCell(2).numFmt = USD;
        r.getCell(5).numFmt = (row[2] && row[2].toString().includes("Rate")) ? PCT : USD;
      }
    });

    s1.addRow([]);

    // Loan status mini breakdown
    const lsHdr = s1.addRow(["LOANS BY STATUS", "", "", "APPLICATIONS BY STATUS", "", ""]);
    s1.mergeCells(`A${lsHdr.number}:C${lsHdr.number}`);
    s1.mergeCells(`D${lsHdr.number}:F${lsHdr.number}`);
    applyHdrStyle(lsHdr);

    const lsColHdr = s1.addRow(["Status", "Count", "", "Status", "Count", ""]);
    applyHdrStyle(lsColHdr, `FF${HEADER}88` || `FF${SUB_HDR.slice(0,6)}`);
    lsColHdr.eachCell((c) => { c.font = { bold: true, size: 10, name: "Calibri" }; });

    const statusKeys = Array.from(new Set([
      ...(loansByStatus.labels || []),
      ...(applicationsByStatus.labels || []),
    ]));
    const maxLen = Math.max(
      (loansByStatus.labels || []).length,
      (applicationsByStatus.labels || []).length,
    );

    for (let i = 0; i < maxLen; i++) {
      const lLabel = (loansByStatus.labels || [])[i] || "";
      const lCount = (loansByStatus.data   || [])[i] ?? "";
      const aLabel = (applicationsByStatus.labels || [])[i] || "";
      const aCount = (applicationsByStatus.data   || [])[i] ?? "";
      const r = s1.addRow([lLabel, lCount, "", aLabel, aCount, ""]);
      r.height = 18;
      [[1, lLabel], [4, aLabel]].forEach(([col, lbl]) => {
        const c = r.getCell(Number(col));
        c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill(lbl) } };
        c.border = cellBorder;
        c.font   = boldFont;
        c.alignment = leftAlign;
      });
      [[2], [5]].forEach(([col]) => {
        const c = r.getCell(Number(col));
        c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: i%2===0?`FF${WHITE}`:`FF${ALT_ROW}` } };
        c.border = cellBorder;
        c.numFmt = NUM;
        c.alignment = rightAlign;
      });
      r.getCell(3).border = cellBorder;
      r.getCell(6).border = cellBorder;
    }

    // Column widths for sheet 1
    [38, 20, 2, 38, 20, 2].forEach((w, i) => { s1.getColumn(i + 1).width = w; });

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 2 — Loans
    // ══════════════════════════════════════════════════════════════════════════
    const s2 = wb.addWorksheet("Loans", { properties: { tabColor: { argb: "FF3B82F6" } } });
    s2.views = [{ showGridLines: false, state: "frozen", ySplit: 3 }];

    s2.mergeCells("A1:N1");
    const s2Title = s2.getCell("A1");
    s2Title.value = `Loans — ${fmtDate(start)} to ${fmtDate(end)} (${loanList.length} records)`;
    s2Title.font  = { bold: true, size: 13, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    s2Title.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
    s2Title.alignment = leftAlign;
    s2.getRow(1).height = 28;

    const loanCols = [
      { header: "Loan #",           key: "loan_no",              width: 16, numFmt: null,  align: "left" },
      { header: "Customer Name",    key: "customer",             width: 24, numFmt: null,  align: "left" },
      { header: "Email",            key: "email",                width: 28, numFmt: null,  align: "left" },
      { header: "Phone",            key: "phone",                width: 16, numFmt: null,  align: "left" },
      { header: "National ID",      key: "national_id",          width: 18, numFmt: null,  align: "left" },
      { header: "Status",           key: "status",               width: 16, numFmt: null,  align: "left" },
      { header: "Collateral",       key: "collateral_category",  width: 18, numFmt: null,  align: "left" },
      { header: "Loan Period",      key: "loan_period_type",     width: 16, numFmt: null,  align: "left" },
      { header: "Principal (USD)",  key: "principal_amount",     width: 18, numFmt: USD,   align: "right" },
      { header: "Exp. Repayable",   key: "expected_repayable",   width: 18, numFmt: USD,   align: "right" },
      { header: "Total Paid",       key: "total_paid",           width: 16, numFmt: USD,   align: "right" },
      { header: "Balance",          key: "current_balance",      width: 16, numFmt: USD,   align: "right" },
      { header: "Due Date",         key: "due_date",             width: 14, numFmt: DT,    align: "center" },
      { header: "Created",          key: "created_at",           width: 14, numFmt: DT,    align: "center" },
    ];

    const s2HdrRow = s2.addRow(loanCols.map((c) => c.header));
    applyHdrStyle(s2HdrRow);
    loanCols.forEach((col, i) => { s2.getColumn(i + 1).width = col.width; });

    loanList.forEach((loan, idx) => {
      const r = s2.addRow([
        loan.loan_no || loan.loan_id,
        loan.customer?.full_name || "",
        loan.customer?.email || "",
        loan.customer?.phone || "",
        loan.customer?.national_id_number || "",
        loan.status || "",
        loan.collateral_category || "",
        (loan.loan_period_type || "").replace(/_/g, " "),
        loan.principal_amount,
        loan.expected_total_repayable,
        loan.total_paid,
        loan.current_balance,
        loan.due_date   ? new Date(loan.due_date)   : "",
        loan.created_at ? new Date(loan.created_at) : "",
      ]);
      applyAltRow(r, idx);

      // Status cell colored
      const statusCell = r.getCell(6);
      statusCell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill(loan.status) } };
      statusCell.font   = boldFont;
      statusCell.border = cellBorder;

      // Apply number formats
      loanCols.forEach((col, i) => {
        const c = r.getCell(i + 1);
        if (col.numFmt) c.numFmt = col.numFmt;
        c.alignment = { horizontal: col.align || "left", vertical: "middle" };
      });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 3 — Loan Applications
    // ══════════════════════════════════════════════════════════════════════════
    const s3 = wb.addWorksheet("Loan Applications", { properties: { tabColor: { argb: "FF8B5CF6" } } });
    s3.views = [{ showGridLines: false, state: "frozen", ySplit: 3 }];

    s3.mergeCells("A1:L1");
    const s3Title = s3.getCell("A1");
    s3Title.value = `Loan Applications — ${fmtDate(start)} to ${fmtDate(end)} (${applicationList.length} records)`;
    s3Title.font  = { bold: true, size: 13, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    s3Title.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
    s3Title.alignment = leftAlign;
    s3.getRow(1).height = 28;

    const appCols = [
      { header: "Application #",    key: "application_no",        width: 18, numFmt: null, align: "left" },
      { header: "Customer Name",    key: "customer",              width: 24, numFmt: null, align: "left" },
      { header: "Email",            key: "email",                 width: 28, numFmt: null, align: "left" },
      { header: "Phone",            key: "phone",                 width: 16, numFmt: null, align: "left" },
      { header: "National ID",      key: "national_id",           width: 18, numFmt: null, align: "left" },
      { header: "Status",           key: "status",                width: 16, numFmt: null, align: "left" },
      { header: "Collateral",       key: "collateral_category",   width: 18, numFmt: null, align: "left" },
      { header: "Loan Period",      key: "loan_period_type",      width: 16, numFmt: null, align: "left" },
      { header: "Requested (USD)",  key: "requested_loan_amount", width: 18, numFmt: USD,  align: "right" },
      { header: "Interest Amt",     key: "interest_amount",       width: 16, numFmt: USD,  align: "right" },
      { header: "Total Repayable",  key: "total_repayable_amount",width: 18, numFmt: USD,  align: "right" },
      { header: "Submitted",        key: "created_at",            width: 14, numFmt: DT,   align: "center" },
    ];

    const s3HdrRow = s3.addRow(appCols.map((c) => c.header));
    applyHdrStyle(s3HdrRow, `FF4C1D95`); // deep purple header
    appCols.forEach((col, i) => { s3.getColumn(i + 1).width = col.width; });

    applicationList.forEach((app, idx) => {
      const r = s3.addRow([
        app.application_no || app.application_id,
        app.customer?.full_name || "",
        app.customer?.email || "",
        app.customer?.phone || "",
        app.customer?.national_id_number || "",
        app.status || "",
        app.collateral_category || "",
        (app.loan_period_type || "").replace(/_/g, " "),
        app.requested_loan_amount,
        app.interest_amount,
        app.total_repayable_amount,
        app.created_at ? new Date(app.created_at) : "",
      ]);
      applyAltRow(r, idx);

      const statusCell = r.getCell(6);
      statusCell.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: statusFill(app.status) } };
      statusCell.font   = boldFont;
      statusCell.border = cellBorder;

      appCols.forEach((col, i) => {
        const c = r.getCell(i + 1);
        if (col.numFmt) c.numFmt = col.numFmt;
        c.alignment = { horizontal: col.align || "left", vertical: "middle" };
      });
    });

    // ══════════════════════════════════════════════════════════════════════════
    // SHEET 4 — Breakdowns & Analytics
    // ══════════════════════════════════════════════════════════════════════════
    const s4 = wb.addWorksheet("Breakdowns", { properties: { tabColor: { argb: "FFF59E0B" } } });
    s4.views = [{ showGridLines: false }];
    [30, 18, 18, 18, 4, 30, 18, 18, 4].forEach((w, i) => { s4.getColumn(i + 1).width = w; });

    const addBreakdownSection = (title, colHeaders, rows, startCol = 1) => {
      const titleRow = s4.addRow([]);
      const endCol = startCol + colHeaders.length - 1;
      s4.mergeCells(`${String.fromCharCode(64 + startCol)}${titleRow.number}:${String.fromCharCode(64 + endCol)}${titleRow.number}`);
      const tc = titleRow.getCell(startCol);
      tc.value = title;
      tc.font  = { bold: true, size: 11, color: { argb: `FF${WHITE}` }, name: "Calibri" };
      tc.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER}` } };
      tc.alignment = centerAlign;
      titleRow.height = 22;

      const hRow = s4.addRow([]);
      colHeaders.forEach((h, i) => {
        const c = hRow.getCell(startCol + i);
        c.value = h;
        c.font  = { bold: true, size: 10, name: "Calibri" };
        c.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${SUB_HDR}` } };
        c.border = cellBorder;
        c.alignment = i === 0 ? leftAlign : rightAlign;
      });
      hRow.height = 20;

      rows.forEach((row, idx) => {
        const r = s4.addRow([]);
        const bg = idx % 2 === 0 ? `FF${WHITE}` : `FF${ALT_ROW}`;
        row.forEach((val, i) => {
          const c = r.getCell(startCol + i);
          c.value  = val;
          c.font   = i === 0 ? boldFont : bodyFont;
          c.fill   = { type: "pattern", pattern: "solid", fgColor: { argb: i === 0 ? statusFill(String(val)) : bg } };
          c.border = cellBorder;
          c.alignment = i === 0 ? leftAlign : rightAlign;
          if (i > 0 && typeof val === "number") c.numFmt = i === 1 ? NUM : USD;
        });
        r.height = 18;
      });
      s4.addRow([]);
    };

    s4.mergeCells("A1:H1");
    const s4Title = s4.getCell("A1");
    s4Title.value = `Breakdowns & Analytics — ${fmtDate(start)} to ${fmtDate(end)}`;
    s4Title.font  = { bold: true, size: 14, color: { argb: `FF${WHITE}` }, name: "Calibri" };
    s4Title.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${DARK}` } };
    s4Title.alignment = leftAlign;
    s4.getRow(1).height = 30;
    s4.addRow([]);

    addBreakdownSection(
      "Loans by Status",
      ["Status", "Count"],
      (loansByStatus.labels || []).map((lbl, i) => [lbl, (loansByStatus.data || [])[i] ?? 0]),
    );

    addBreakdownSection(
      "Loan Applications by Status",
      ["Status", "Count"],
      (applicationsByStatus.labels || []).map((lbl, i) => [lbl, (applicationsByStatus.data || [])[i] ?? 0]),
    );

    addBreakdownSection(
      "Loan Period / Repayment Type Split",
      ["Type", "Count", "Total Principal (USD)"],
      repaymentTypeSplit.map((r) => [r.type, r.count, r.total_principal]),
    );

    addBreakdownSection(
      "Loans by Collateral Category",
      ["Category", "Count", "Total Principal (USD)", "Total Interest (USD)"],
      loansByCollateral.map((r) => [r.category || "Unknown", r.count, r.total_principal, r.total_interest]),
    );

    addBreakdownSection(
      "Applications by Collateral Category",
      ["Category", "Count", "Total Requested (USD)", "Projected Interest (USD)"],
      applicationsByCollateral.map((r) => [r.category || "Unknown", r.count, r.total_requested, r.projected_interest]),
    );

    return wb;
  }
}

module.exports = new LoanReportService();
