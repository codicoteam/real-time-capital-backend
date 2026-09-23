"use strict";

const XeroAccountMap = require("../../models/xero/xero_account_map.model");
const { getAuthenticatedClient } = require("./xero_client_service");
const { parseXeroError } = require("./xero_mapping_helpers");

// The chart-of-accounts snapshot from the Xero integration strategy doc (slide 7),
// plus one entry per Expense.category enum value (models/expense.model.js).
// `manual_only` accounts must be real bank accounts in Xero (Bank Transactions can only
// post against Type=BANK accounts) — we never auto-create those with fake account numbers
// against a live paid org; the user's accountant sets those up for real.
const REQUIRED_ACCOUNTS = [
  // Real bank accounts, matched by NAME (exact strings as created in Xero — see the
  // user's own bank accounts page). manual_only accounts must be real Type=BANK
  // accounts in Xero; we never auto-create these against a live paid org.
  { key: "bank_real_time_capital", label: "Real Time Capital", suggested_code: "1010", xero_type: "BANK", manual_only: true },
  { key: "ecocash_real_time_capital", label: "Real Time Capital Ecocash", suggested_code: "1020", xero_type: "BANK", manual_only: true },
  // NOTE the trailing space before the closing paren in both labels below — that's
  // not a typo, it's the exact name as created in the user's live Xero org (name
  // matching in validateChartOfAccounts() below is exact, case-insensitive only).
  // The frontend's display label (configs/xero_bank_accounts.js) uses the clean
  // version without the stray space; only this Xero-matching string needs it.
  { key: "cash_on_hand_admin", label: "Real Time Capital Cash On Hand (Admin )", suggested_code: "1000", xero_type: "BANK", manual_only: true },
  { key: "cash_on_hand_reception", label: "Real Time Capital Cash On Hand (Reception )", suggested_code: "1001", xero_type: "BANK", manual_only: true },
  // PayNow's merchant settlement account — a different legal entity (Designit Media),
  // used automatically for every app/PayNow-originated payment, and also selectable
  // manually (e.g. to correct a mis-posted entry).
  { key: "designit_media", label: "Designit Media Pvt Ltd", suggested_code: "1030", xero_type: "BANK", manual_only: true },
  { key: "loans_receivable", label: "Loans Receivable", suggested_code: "1100", xero_type: "CURRENT", manual_only: false },
  { key: "pawned_assets_inventory", label: "Pawned Assets Inventory", suggested_code: "1200", xero_type: "CURRENT", manual_only: false },
  { key: "investor_capital_payable", label: "Investor Capital Payable", suggested_code: "2000", xero_type: "CURRLIAB", manual_only: false },
  { key: "investor_profit_payable", label: "Investor Profit Payable", suggested_code: "2010", xero_type: "CURRLIAB", manual_only: false },
  { key: "interest_income", label: "Interest Income", suggested_code: "4000", xero_type: "REVENUE", manual_only: false },
  { key: "storage_income", label: "Storage Charge Income", suggested_code: "4010", xero_type: "REVENUE", manual_only: false },
  { key: "penalty_income", label: "Penalty Income", suggested_code: "4020", xero_type: "REVENUE", manual_only: false },
  { key: "asset_sale_revenue", label: "Auction / Asset Sale Revenue", suggested_code: "4030", xero_type: "REVENUE", manual_only: false },
  { key: "admin_fee_income", label: "Admin Fee Income", suggested_code: "4040", xero_type: "REVENUE", manual_only: false },
  { key: "investor_profit_share_expense", label: "Investor Profit Share", suggested_code: "6500", xero_type: "DIRECTCOSTS", manual_only: false },
  { key: "bad_debt_writeoffs", label: "Bad Debt Write-offs", suggested_code: "6300", xero_type: "EXPENSE", manual_only: false },
  { key: "cost_of_asset_sales", label: "Cost of Asset Sales", suggested_code: "6400", xero_type: "DIRECTCOSTS", manual_only: false },
  { key: "expense_rent", label: "Rent", suggested_code: "6100", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_electricity", label: "Electricity", suggested_code: "6110", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_water", label: "Water", suggested_code: "6120", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_internet", label: "Internet", suggested_code: "6130", xero_type: "OVERHEADS", manual_only: false },
  { key: "expense_salaries", label: "Salaries & Wages", suggested_code: "6010", xero_type: "EXPENSE", manual_only: false },
  { key: "agent_commission_expense", label: "Agent Commission Expense", suggested_code: "6200", xero_type: "EXPENSE", manual_only: false },
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

// Fetches the org's live chart of accounts and resolves each required key against it by
// case-insensitive Name ONLY — no code matching. suggested_code is a numbering WE invented
// for our own chart of accounts; it has no guaranteed relationship to what a different (or
// freshly-connected) Xero org happens to have sitting at that same code, and matching by
// code was found to silently resolve accounts like "Interest Income" or "Bad Debt
// Write-offs" to a completely unrelated default account (e.g. "Sale of Goods", "Rent -
// Real Estate") purely because a fresh org's own default chart of accounts happens to have
// *something* at nearly every low code. suggested_code is only ever used as the code to
// assign when CREATING a missing account (see createMissingAccounts), never for matching
// an existing one. Never creates anything — this is a read-only reconciliation pass, safe
// to run anytime.
async function validateChartOfAccounts() {
  await ensureSeeded();
  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const { body } = await accountingApi.getAccounts(tenantId);
  const liveAccounts = body.accounts || [];

  const byName = new Map(liveAccounts.map((a) => [normalize(a.name), a]));

  const checklist = [];
  for (const def of REQUIRED_ACCOUNTS) {
    const match = byName.get(normalize(def.label));
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
// Fallback code block for when suggested_code is already taken by an unrelated account —
// common when connecting to an org that shipped with a dense default chart of accounts
// (seen live: a fresh org already occupied nearly every code from 1000-8200). Picked well
// clear of any standard template's range so it should never collide again.
const FALLBACK_CODE_START = 9500;
const FALLBACK_CODE_END = 9899;

async function createMissingAccounts() {
  const { accountingApi, tenantId } = await getAuthenticatedClient();
  const unresolved = await XeroAccountMap.find({ resolved: false });

  const { body: accountsBody } = await accountingApi.getAccounts(tenantId);
  const usedCodes = new Set((accountsBody.accounts || []).filter((a) => a.code).map((a) => a.code));

  function nextFreeCode(suggested) {
    if (!usedCodes.has(suggested)) return suggested;
    for (let c = FALLBACK_CODE_START; c <= FALLBACK_CODE_END; c++) {
      const code = String(c);
      if (!usedCodes.has(code)) return code;
    }
    return null; // exhausted the fallback block — extremely unlikely
  }

  const created = [];
  const skipped = [];
  for (const row of unresolved) {
    const def = REQUIRED_ACCOUNTS.find((d) => d.key === row.key);
    if (!def || def.manual_only) {
      skipped.push({ key: row.key, reason: "Must be created manually in Xero (real bank account)." });
      continue;
    }
    const code = nextFreeCode(def.suggested_code);
    if (!code) {
      skipped.push({ key: row.key, reason: "No free account code available (fallback block exhausted)." });
      continue;
    }
    try {
      const { body } = await accountingApi.createAccount(tenantId, {
        code,
        name: def.label,
        type: def.xero_type,
      });
      const acc = body.accounts && body.accounts[0];
      usedCodes.add(code); // reserve it so the next iteration doesn't also pick it
      await XeroAccountMap.updateOne(
        { key: def.key },
        {
          $set: {
            xero_account_id: acc.accountID,
            xero_code: acc.code || code,
            xero_name: acc.name,
            resolved: true,
            resolved_at: new Date(),
          },
        },
      );
      created.push({ key: def.key, code });
    } catch (err) {
      skipped.push({ key: row.key, reason: parseXeroError(err).message });
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

// Used specifically for the `BankAccount` reference on a BankTransaction (SPEND/RECEIVE).
// Per Xero's Bank Transactions API, that reference must be identified by AccountID or Code —
// but real bank accounts (Type=BANK) in a live Xero org very often have no Code set at all
// (unlike REVENUE/EXPENSE accounts, Xero doesn't require one), which is the case for every
// manual_only bank account in this org. Always prefer AccountID — it's the one field Xero
// guarantees is present and unique for every account — and only fall back to Code for the
// rare account that has one but somehow lost its AccountID. Passing `{ code: null }` (the
// old behaviour) gets serialized by the SDK into an all-zero GUID that Xero's API rejects
// with "does not match a known bank account" — silent and easy to misdiagnose from the
// error alone, so this exists as its own function rather than reusing requireAccountCode.
async function requireBankAccountRef(key) {
  const row = await XeroAccountMap.findOne({ key, resolved: true });
  if (!row) {
    throw new Error(
      `Xero account for "${key}" is not set up yet — run chart-of-accounts validation in Super Admin > Xero Integration first.`,
    );
  }
  if (row.xero_account_id) return { accountID: row.xero_account_id };
  if (row.xero_code) return { code: row.xero_code };
  throw new Error(
    `Xero account for "${key}" resolved but has neither an AccountID nor a Code — re-run chart-of-accounts validation in Super Admin > Xero Integration.`,
  );
}

module.exports = {
  REQUIRED_ACCOUNTS,
  validateChartOfAccounts,
  createMissingAccounts,
  getAccountMap,
  requireAccountCode,
  requireBankAccountRef,
};
