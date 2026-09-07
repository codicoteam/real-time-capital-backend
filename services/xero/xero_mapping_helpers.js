"use strict";

// Maps our internal payment_method values (used across Loan/Payment/Expense) to the
// xero_account_map key of the actual bank/cash account money moved through.
function bankAccountKeyForMethod(method) {
  switch (method) {
    case "mobile_money":
    case "ecocash":
    case "onemoney":
    case "telecash":
      return "ecocash_float";
    case "bank_transfer":
    case "bank":
    case "cheque":
    case "card":
    case "paynow":
      return "bank_fbc_cbz";
    case "cash":
    default:
      return "cash_on_hand";
  }
}

// Maps Expense.category (models/expense.model.js) to the xero_account_map key.
const EXPENSE_CATEGORY_TO_KEY = {
  Rent: "expense_rent",
  Electricity: "expense_electricity",
  Water: "expense_water",
  Internet: "expense_internet",
  Salaries: "expense_salaries",
  Maintenance: "expense_maintenance",
  Transport: "expense_transport",
  "Office Supplies": "expense_office_supplies",
  Security: "expense_security",
  Marketing: "expense_marketing",
  Other: "expense_other",
};

function expenseAccountKeyForCategory(category) {
  return EXPENSE_CATEGORY_TO_KEY[category] || "expense_other";
}

function toXeroDate(date) {
  const d = date ? new Date(date) : new Date();
  return d.toISOString().slice(0, 10);
}

module.exports = { bankAccountKeyForMethod, expenseAccountKeyForCategory, toXeroDate };
