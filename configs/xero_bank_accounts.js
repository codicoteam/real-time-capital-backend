"use strict";

// The 5 real Xero bank accounts staff can post against — single source of truth,
// reused across every model that records a bank/cash movement (Loan, Payment,
// Expense, BidPayment, InvestorTransaction) plus the account-mapping keys in
// services/xero/xero_accounts_service.js. Keep this in sync with that file's
// REQUIRED_ACCOUNTS list and with the frontend's matching constants file
// (src/constants/xeroBankAccounts.ts).
const XERO_BANK_ACCOUNTS = [
  {
    key: "bank_real_time_capital",
    label: "Real Time Capital",
    type: "bank",
  },
  {
    key: "ecocash_real_time_capital",
    label: "Real Time Capital Ecocash",
    type: "mobile_money",
  },
  {
    key: "cash_on_hand_admin",
    label: "Real Time Capital Cash On Hand (Admin)",
    type: "cash",
  },
  {
    key: "cash_on_hand_reception",
    label: "Real Time Capital Cash On Hand (Reception)",
    type: "cash",
  },
  {
    key: "designit_media",
    label: "Designit Media Pvt Ltd",
    type: "bank",
    note: "PayNow settlement account — used automatically for app/PayNow payments, also selectable manually.",
  },
];

const XERO_BANK_ACCOUNT_KEYS = XERO_BANK_ACCOUNTS.map((a) => a.key);

module.exports = { XERO_BANK_ACCOUNTS, XERO_BANK_ACCOUNT_KEYS };
