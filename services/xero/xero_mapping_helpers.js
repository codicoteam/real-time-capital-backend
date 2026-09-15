"use strict";

// Every online/app-originated rail settles into the PayNow merchant account
// (Designit Media Pvt Ltd) — this is automatic and not staff-selectable.
const ONLINE_PROVIDERS = new Set(["paynow", "ecocash", "onemoney", "telecash"]);

// Resolves the xero_account_map key of the actual bank/cash account money moved
// through for a given event.
//
//   1. An explicit `bankAccountKey` (staff picked one from the dropdown) always wins.
//   2. Otherwise, if this was paid online through the app (provider is one of the
//      PayNow rails), it's automatically Designit Media — no staff choice involved.
//   3. Otherwise, fall back to a same-method-family default (used only for paths
//      that haven't been updated to capture an explicit choice yet).
function bankAccountKeyForMethod(method, { provider, bankAccountKey } = {}) {
  if (bankAccountKey) return bankAccountKey;
  if (provider && ONLINE_PROVIDERS.has(provider)) return "designit_media";

  switch (method) {
    case "mobile_money":
    case "ecocash":
    case "onemoney":
    case "telecash":
      return "ecocash_real_time_capital";
    case "bank_transfer":
    case "bank":
    case "cheque":
    case "card":
      return "bank_real_time_capital";
    case "paynow":
      return "designit_media";
    case "cash":
    default:
      // No till specified — Admin is the safer default (Reception should always be
      // explicit, since misattributing a Reception cash sale to Admin is the more
      // likely bookkeeping error to go unnoticed).
      return "cash_on_hand_admin";
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

// xero-node's generated API client (xero-node/dist/gen/api) does NOT reject with a
// normal Error on a non-2xx response — it rejects with the RAW error, which in practice
// comes through as a JSON *string* shaped like
//   {"response":{"statusCode":404,"body":"...","headers":{...}},"request":{...}}
// — not an axios-style { response: { status, data } } object, and not an Error instance
// (confirmed live: typeof err === "string", err instanceof Error === false). Any code
// that inspects a caught Xero API error — to recognize an expected 404, or to log what
// actually went wrong — must go through this parser rather than assuming err.message /
// err.response.status exist, or the check silently never matches (which is exactly what
// broke "does this contact already exist?" lookups and blocked every first-time sync).
function parseXeroError(err) {
  let obj = err;
  if (typeof err === "string") {
    try {
      obj = JSON.parse(err);
    } catch {
      obj = null;
    }
  }

  const statusCode =
    obj?.response?.statusCode ?? obj?.response?.status ?? (err && err.statusCode) ?? (err && err.status) ?? null;

  const body = obj?.response?.body ?? obj?.response?.data ?? (err && err.body) ?? null;

  const bodyText = typeof body === "string" ? body : body != null ? JSON.stringify(body) : null;

  const message = bodyText || (err && err.message) || (typeof err === "string" ? err : null) || "Unknown Xero API error";

  return { statusCode, body, message };
}

module.exports = { bankAccountKeyForMethod, expenseAccountKeyForCategory, toXeroDate, parseXeroError };
