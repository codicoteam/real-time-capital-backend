// services/loan_report_service.js
"use strict";

const mongoose = require("mongoose");
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
     * interest_component proxy = amount - (principal/installment_count) capped at 0.
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
   * Repayment type split for loans in period (once_off vs installment).
   */
  async _getRepaymentTypeSplit(start, end) {
    const rows = await Loan.aggregate([
      { $match: { created_at: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$repayment_type",
          count: { $sum: 1 },
          total_principal: { $sum: "$principal_amount" },
        },
      },
    ]);

    return rows.map((r) => ({
      type: r._id,
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
        repayment_type: l.repayment_type,
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
        repayment_type: a.repayment_type,
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
}

module.exports = new LoanReportService();
