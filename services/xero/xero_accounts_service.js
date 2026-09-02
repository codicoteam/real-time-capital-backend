"use strict";

const XeroAccountMap = require("../../models/xero/xero_account_map.model");
const { getAuthenticatedClient } = require("./xero_client_service");

// The chart-of-accounts snapshot from the Xero integration strategy doc (slide 7),
// plus one entry per Expense.category enum value (models/expense.model.js).
// `manual_only` accounts must be real bank accounts in Xero (Bank Transactions can only
// post against Type=BANK accounts) — we never auto-create those with fake account numbers
// against a live paid org; the user's accountant sets those up for real.
const REQUIRED_ACCOUNTS = [
  { key: "cash_on_hand", label: "Cash on Hand", suggested_code: "1000", xero_type: "BANK", manual_only: true },
  { key: "bank_fbc_cbz", label: "Bank — FBC / CBZ", suggested_code: "1010", xero_type: "BANK", manual_only: true },
  { key: "loans_receivable", label: "Loans Receivable", suggested_code: "1100", xero_type: "CURRENT", manual_only: false },
  { key: "pawned_assets_inventory", label: "Pawned Assets Inventory", suggested_code: "1200", xero_type: "CURRENT", manual_only: false },
  { key: "investor_capital_payable", label: "Investor Capital Payable", suggested_code: "2000", xero_type: "CURRLIAB", manual_only: false },
  { key: "investor_profit_payable", label: "Investor Profit Payable", suggested_code: "2010", xero_type: "CURRLIAB", manual_only: false },
  { key: "interest_income", label: "Interest Income", suggested_code: "4000", xero_type: "REVENUE", manual_only: false },
  { key: "storage_income", label: "Storage Charge Income", suggested_code: "4010", xero_type: "REVENUE", manual_only: false },
  { key: "penalty_income", label: "Penalty Income", suggested_code: "4020", xero_type: "REVENUE", manual_only: false },
  { key: "asset_sale_revenue", label: "Auction / Asset Sale Revenue", suggested_code: "4030", xero_type: "REVENUE", manual_only: false },
  { key: "bad_debt_writeoffs", label: "Bad Debt Write-offs", suggested_code: "6300", xero_type: "EXPENSE", manual_only: false },
  { key: "cost_of_asset_sales", label: "Cost of Asset Sales", suggested_code: "6400", xero_type: "DIRECTCOSTS", manual_only: false },
  { key: "expense_rent", label: "Rent", suggested_code: "6100", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_electricity", label: "Electricity", suggested_code: "6110", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_water", label: "Water", suggested_code: "6120", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_internet", label: "Internet", suggested_code: "6130", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_salaries", label: "Salaries & Wages", suggested_code: "6010", xero_type: "EXPENSE", manual_only: false },
  { key: "expense_maintenance", label: "Maintenance", suggested_code: "6140", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_transport", label: "Transport", suggested_code: "6150", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_office_supplies", label: "Office Supplies", suggested_code: "6160", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_security", label: "Security", suggested_code: "6170", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_marketing", label: "Marketing", suggested_code: "6180", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_other", label: "Other Expenses", suggested_code: "6190", xero_type: "OVERHEADS", manual_only: false },
];

async function ensureSeeded() {
  for (const def of REQUIRED_ACCOUNTS) {
    await XeroAccountMap.updateOne(
      { key: def.key },
      { $setOnInsert: { key: def.key, label: def.label, suggested_code: def.suggested_code } },
      { upsert: true },
    );
  }
}

function normalize(name) {
  return String(name || "").trim().toLowerCase();
}

// Fetches the org's live chart of accounts and resolves each required key against it,
// matching first by exact account Code, then by case-insensitive Name. Never creates
// anything — this is a read-only reconciliation pass, safe to run anytime.
async function validateChartOfAccounts() {
  await ensureSeeded();
  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const { body } = await accountingApi.getAccounts(tenantId);
  const liveAccounts = body.accounts || [];

  const byCode = new Map(liveAccounts.filter((a) => a.code).map((a) => [a.code, a]));
  const byName = new Map(liveAccounts.map((a) => [normalize(a.name), a]));

  const checklist = [];
  for (const def of REQUIRED_ACCOUNTS) {
    const match = byCode.get(def.suggested_code) || byName.get(normalize(def.label));
    const update = match
      ? {
          xero_account_id: match.accountID,
          xero_code: match.code || null,
          xero_name: match.name,
          resolved: true,
          resolved_at: new Date(),
        }
      : { resolved: false, xero_account_id: null, xero_code: null, xero_name: null };

    await XeroAccountMap.updateOne({ key: def.key }, { $set: update });
    checklist.push({ ...def, ...update });
  }

  return checklist;
}

// Explicit, user-triggered creation of the accounts that were NOT found and are safe
// to auto-create (i.e. not a real bank account). Requires validateChartOfAccounts to
// have run first so we know what's missing.
async function createMissingAccounts() {
  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const unresolved = await XeroAccountMap.find({ resolved: false });

  const created = [];
  const skipped = [];
  for (const row of unresolved) {
    const def = REQUIRED_ACCOUNTS.find((d) => d.key === row.key);
    if (!def || def.manual_only) {
      skipped.push({ key: row.key, reason: "Must be created manually in Xero (real bank account)." });
      continue;
    }
    try {
      const { body } = await accountingApi.createAccount(tenantId, {
        code: def.suggested_code,
        name: def.label,
        type: def.xero_type,
      });
      const acc = body.accounts && body.accounts[0];
      await XeroAccountMap.updateOne(
        { key: def.key },
        {
          $set: {
            xero_account_id: acc.accountID,
            xero_code: acc.code || def.suggested_code,
            xero_name: acc.name,
            resolved: true,
            resolved_at: new Date(),
          },
        },
      );
      created.push(def.key);
    } catch (err) {
      skipped.push({ key: row.key, reason: err.message });
    }
  }

  return { created, skipped };
}

async function getAccountMap() {
  await ensureSeeded();
  return XeroAccountMap.find({}).sort({ key: 1 });
}

// Used by the sync services to resolve "loans_receivable" etc. to a real Xero AccountID/Code.
// Throws a clear error if the org's chart of accounts hasn't been reconciled yet.
async function requireAccountCode(key) {
  const row = await XeroAccountMap.findOne({ key, resolved: true });
  if (!row) {
    throw new Error(
      `Xero account for "${key}" is not set up yet — run chart-of-accounts validation in Super Admin > Xero Integration first.`,
    );
  }
  return row.xero_code;
}

module.exports = {
  REQUIRED_ACCOUNTS,
  validateChartOfAccounts,
  createMissingAccounts,
  getAccountMap,
  requireAccountCode,
};
