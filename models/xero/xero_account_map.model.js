"use strict";

const mongoose = require("mongoose");

// One row per internal account key -> the real Xero account it resolves to.
// Populated by the chart-of-accounts validation flow (services/xero/xero_accounts_service.js),
// never hardcoded, since actual Xero account codes belong to the org's accountant.
const XeroAccountMapSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: [
        "cash_on_hand",
        "bank_fbc_cbz",
        "loans_receivable",
        "pawned_assets_inventory",
        "investor_capital_payable",
        "investor_profit_payable",
        "interest_income",
        "storage_income",
        "penalty_income",
        "asset_sale_revenue",
        "bad_debt_writeoffs",
        "cost_of_asset_sales",
        // One per Expense.category enum value (models/expense.model.js)
        "expense_rent",
        "expense_electricity",
        "expense_water",
        "expense_internet",
        "expense_salaries",
        "expense_maintenance",
        "expense_transport",
        "expense_office_supplies",
        "expense_security",
        "expense_marketing",
        "expense_other",
      ],
      index: true,
    },
    label: { type: String, required: true, trim: true }, // human-readable, e.g. "Loans Receivable"
    suggested_code: { type: String, trim: true }, // from the strategy doc's chart-of-accounts snapshot, e.g. "1100"

    xero_account_id: { type: String, default: null },
    xero_code: { type: String, default: null },
    xero_name: { type: String, default: null },

    resolved: { type: Boolean, default: false },
    resolved_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("XeroAccountMap", XeroAccountMapSchema);
