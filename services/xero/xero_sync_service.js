"use strict";

const { getAuthenticatedClient } = require("./xero_client_service");
const { requireAccountCode } = require("./xero_accounts_service");
const {
  getOrCreateCustomerContact,
  getOrCreateInvestorContact,
  getOrCreateInternalContact,
} = require("./xero_contact_service");
const { bankAccountKeyForMethod, expenseAccountKeyForCategory, toXeroDate } = require("./xero_mapping_helpers");
const XeroSyncLog = require("../../models/xero/xero_sync_log.model");
const Loan = require("../../models/loan.model");
const Payment = require("../../models/payment.model");
const Expense = require("../../models/expense.model");
const InvestorTransaction = require("../../models/investor/investor_transaction.model");
const Auction = require("../../models/auction.model");
const BidPayment = require("../../models/bidPayment.model");

// Every event funnels through here: logs the attempt, never throws to the caller
// (callers use `.catch()` fire-and-forget per this codebase's existing convention —
// see loan_service.js lines ~1122-1139), and schedules a retry on failure.
async function withSyncLog({ sourceCollection, sourceId, eventType, xeroEndpoint, payload }, fn) {
  const log = await XeroSyncLog.create({
    source_collection: sourceCollection,
    source_id: sourceId,
    event_type: eventType,
    xero_endpoint: xeroEndpoint,
    status: "pending",
    payload,
  });

  try {
    const xeroId = await fn();
    log.status = "success";
    log.xero_id = xeroId;
    log.attempts += 1;
    await log.save();
    return xeroId;
  } catch (err) {
    const message = (err.response && err.response.body && JSON.stringify(err.response.body)) || err.message;
    log.status = "failed";
    log.last_error = message;
    log.attempts += 1;
    log.next_retry_at = new Date(Date.now() + 5 * 60 * 1000);
    await log.save();
    console.error(`[Xero] ${eventType} sync failed for ${sourceCollection} ${sourceId}:`, message);
    return null;
  }
}

// ── Event 1: Loan disbursed ────────────────────────────────────────────────
// Single BankTransaction (SPEND): Dr Loans Receivable, Cr Bank/Cash, contact = customer.
async function syncLoanDisbursed(loan) {
  return withSyncLog(
    {
      sourceCollection: "Loan",
      sourceId: loan._id,
      eventType: "loan_disbursed",
      xeroEndpoint: "BankTransactions",
      payload: { loan_no: loan.loan_no, principal_amount: loan.principal_amount },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateCustomerContact(loan.customer_user._id || loan.customer_user);
      const bankAccountKey = bankAccountKeyForMethod(loan.payment_method);
      const [bankCode, loansReceivableCode] = await Promise.all([
        requireAccountCode(bankAccountKey),
        requireAccountCode("loans_receivable"),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "SPEND",
            contact: { contactID: contactId },
            date: toXeroDate(loan.disbursement_date),
            reference: loan.loan_no,
            status: "AUTHORISED",
            bankAccount: { code: bankCode },
            lineItems: [
              {
                description: `Loan disbursement — ${loan.loan_no}`,
                quantity: 1,
                unitAmount: loan.principal_amount,
                accountCode: loansReceivableCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await Loan.updateOne({ _id: loan._id }, { $set: { xero_disbursement_transaction_id: xeroId } });
      return xeroId;
    },
  );
}

// ── Event 3: Loan written off ──────────────────────────────────────────────
// Manual Journal: Dr Bad Debt Write-offs, Cr Loans Receivable, for the remaining balance.
async function syncLoanWrittenOff(loan) {
  return withSyncLog(
    {
      sourceCollection: "Loan",
      sourceId: loan._id,
      eventType: "loan_written_off",
      xeroEndpoint: "ManualJournals",
      payload: { loan_no: loan.loan_no, current_balance: loan.current_balance },
    },
    async () => {
      if (!loan.current_balance || loan.current_balance <= 0) return null; // nothing to write off

      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const [writeOffCode, loansReceivableCode] = await Promise.all([
        requireAccountCode("bad_debt_writeoffs"),
        requireAccountCode("loans_receivable"),
      ]);

      const { body } = await accountingApi.createManualJournals(tenantId, {
        manualJournals: [
          {
            narration: `Loan written off — ${loan.loan_no}`,
            date: toXeroDate(new Date()),
            status: "POSTED",
            journalLines: [
              { lineAmount: loan.current_balance, accountCode: writeOffCode, description: "Bad debt write-off" },
              { lineAmount: -loan.current_balance, accountCode: loansReceivableCode, description: "Loans receivable" },
            ],
          },
        ],
      });

      const xeroId = body.manualJournals[0].manualJournalID;
      await Loan.updateOne({ _id: loan._id }, { $set: { xero_writeoff_journal_id: xeroId } });
      return xeroId;
    },
  );
}

// ── Loan defaults, moves to auction ────────────────────────────────────────
// Manual Journal: Dr Pawned Assets Inventory, Cr Loans Receivable, for the outstanding
// balance. We're no longer expecting cash repayment on this loan — we're now holding
// sellable collateral instead. This is what gives syncAuctionSaleCompleted a COGS basis
// to match against when the asset actually sells.
async function syncLoanMovedToAuction(loan) {
  if (loan.xero_auction_reclass_journal_id) return loan.xero_auction_reclass_journal_id; // already reclassified
  if (!loan.current_balance || loan.current_balance <= 0) return null;

  return withSyncLog(
    {
      sourceCollection: "Loan",
      sourceId: loan._id,
      eventType: "loan_moved_to_auction",
      xeroEndpoint: "ManualJournals",
      payload: { loan_no: loan.loan_no, reclass_amount: loan.current_balance },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const [inventoryCode, loansReceivableCode] = await Promise.all([
        requireAccountCode("pawned_assets_inventory"),
        requireAccountCode("loans_receivable"),
      ]);

      const { body } = await accountingApi.createManualJournals(tenantId, {
        manualJournals: [
          {
            narration: `Loan moved to auction — collateral reclassified as inventory — ${loan.loan_no}`,
            date: toXeroDate(new Date()),
            status: "POSTED",
            journalLines: [
              { lineAmount: loan.current_balance, accountCode: inventoryCode, description: "Pawned assets inventory" },
              { lineAmount: -loan.current_balance, accountCode: loansReceivableCode, description: "Loans receivable" },
            ],
          },
        ],
      });

      const xeroId = body.manualJournals[0].manualJournalID;
      await Loan.updateOne(
        { _id: loan._id },
        { $set: { xero_auction_reclass_journal_id: xeroId, xero_auction_reclass_amount: loan.current_balance } },
      );
      return xeroId;
    },
  );
}

// ── Event 7: Auction sale completed (payment cleared) ─────────────────────
// BankTransaction (RECEIVE) for the full sale proceeds, contact = winning bidder, coded
// to Asset Sale Revenue. Plus a Manual Journal matching cost of sale against whatever was
// reclassified into Pawned Assets Inventory when the loan defaulted (see above) — skipped
// if that never happened (e.g. historical/manually-seeded auctions with no linked loan).
async function syncAuctionSaleCompleted(bidPayment) {
  if (bidPayment.xero_bank_transaction_id) return bidPayment.xero_bank_transaction_id; // already posted

  return withSyncLog(
    {
      sourceCollection: "BidPayment",
      sourceId: bidPayment._id,
      eventType: "auction_sale",
      xeroEndpoint: "BankTransactions",
      payload: { auction_id: bidPayment.auction, amount: bidPayment.amount },
    },
    async () => {
      const auction = await Auction.findById(bidPayment.auction);
      if (!auction) throw new Error(`Auction ${bidPayment.auction} not found for BidPayment ${bidPayment._id}`);

      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateCustomerContact(bidPayment.payer_user._id || bidPayment.payer_user);
      const bankAccountKey = bankAccountKeyForMethod(bidPayment.method);
      const [bankCode, revenueCode] = await Promise.all([
        requireAccountCode(bankAccountKey),
        requireAccountCode("asset_sale_revenue"),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "RECEIVE",
            contact: { contactID: contactId },
            date: toXeroDate(bidPayment.paid_at || new Date()),
            reference: auction.auction_no,
            status: "AUTHORISED",
            bankAccount: { code: bankCode },
            lineItems: [
              {
                description: `Auction sale — ${auction.auction_no}`,
                quantity: 1,
                unitAmount: bidPayment.amount,
                accountCode: revenueCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await BidPayment.updateOne({ _id: bidPayment._id }, { $set: { xero_bank_transaction_id: xeroId } });

      // Match cost of sale against the reclassified inventory value, if there is one.
      const loan = await Loan.findOne({ asset: auction.asset, xero_auction_reclass_amount: { $gt: 0 } }).sort({
        created_at: -1,
      });
      if (loan) {
        const [cogsCode, inventoryCode] = await Promise.all([
          requireAccountCode("cost_of_asset_sales"),
          requireAccountCode("pawned_assets_inventory"),
        ]);
        await accountingApi.createManualJournals(tenantId, {
          manualJournals: [
            {
              narration: `Cost of asset sold at auction — ${auction.auction_no}`,
              date: toXeroDate(bidPayment.paid_at || new Date()),
              status: "POSTED",
              journalLines: [
                { lineAmount: loan.xero_auction_reclass_amount, accountCode: cogsCode, description: "Cost of asset sales" },
                { lineAmount: -loan.xero_auction_reclass_amount, accountCode: inventoryCode, description: "Pawned assets inventory" },
              ],
            },
          ],
        });
        await Loan.updateOne({ _id: loan._id }, { $set: { xero_auction_reclass_amount: null } });
      }

      return xeroId;
    },
  );
}

// ── Event 2: Loan repayment (shared by both repayment code paths) ─────────
// BankTransaction (RECEIVE) with one line item per component, contact = customer.
// A RECEIVE credits each line-item account and debits the bank account — exactly
// Dr Bank / Cr Loans Receivable + Interest Income + Storage Income + Penalty Income.
async function postRepaymentToXero({
  sourceCollection,
  sourceId,
  loan,
  method,
  date,
  reference,
  principal,
  interest,
  storage,
  penalty,
}) {
  return withSyncLog(
    {
      sourceCollection,
      sourceId,
      eventType: "loan_repayment",
      xeroEndpoint: "BankTransactions",
      payload: { loan_no: loan.loan_no, principal, interest, storage, penalty },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateCustomerContact(loan.customer_user._id || loan.customer_user);
      const bankAccountKey = bankAccountKeyForMethod(method);

      const componentAccounts = [
        { amount: principal, key: "loans_receivable", label: "Principal repayment" },
        { amount: interest, key: "interest_income", label: "Interest" },
        { amount: storage, key: "storage_income", label: "Storage charge" },
        { amount: penalty, key: "penalty_income", label: "Penalty" },
      ].filter((c) => c.amount > 0);

      if (componentAccounts.length === 0) return null;

      const [bankCode, ...componentCodes] = await Promise.all([
        requireAccountCode(bankAccountKey),
        ...componentAccounts.map((c) => requireAccountCode(c.key)),
      ]);

      const lineItems = componentAccounts.map((c, i) => ({
        description: `${c.label} — ${loan.loan_no}`,
        quantity: 1,
        unitAmount: c.amount,
        accountCode: componentCodes[i],
      }));

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "RECEIVE",
            contact: { contactID: contactId },
            date: toXeroDate(date),
            reference: reference || loan.loan_no,
            status: "AUTHORISED",
            bankAccount: { code: bankCode },
            lineItems,
          },
        ],
      });

      return body.bankTransactions[0].bankTransactionID;
    },
  );
}

// Path 2a — the primary Payment-model repayment flow (services/payment_service.js
// updateLoanBalance). Component split comes straight from the Payment document.
async function syncLoanRepayment(payment, loan) {
  const xeroId = await postRepaymentToXero({
    sourceCollection: "Payment",
    sourceId: payment._id,
    loan,
    method: payment.method || payment.provider,
    date: payment.paid_at,
    reference: payment.receipt_no || loan.loan_no,
    principal: payment.principal_component || 0,
    interest: payment.interest_component || 0,
    storage: payment.storage_component || 0,
    penalty: payment.penalty_component || 0,
  });
  if (xeroId) {
    await Payment.updateOne({ _id: payment._id }, { $set: { xero_bank_transaction_id: xeroId } });
  }
  return xeroId;
}

// Path 2b — the legacy embedded-array repayment flow (services/loan_service.js
// processPayment). No component breakdown is recorded there, so this is a documented
// simplification: split proportionally using the loan's own stored interest/storage
// amounts vs. its expected_total_repayable, with any remainder (incl. penalties) folded
// into principal so no money is ever silently dropped.
async function syncLoanRepaymentLegacy(loan, paymentEntry) {
  if (paymentEntry.xero_bank_transaction_id) return paymentEntry.xero_bank_transaction_id; // already posted

  const total = loan.expected_total_repayable || loan.principal_amount || 1;
  const interestRatio = (loan.interest_amount || 0) / total;
  const storageRatio = (loan.storage_charge_amount || 0) / total;

  const amount = paymentEntry.amount;
  const interest = Math.round(amount * interestRatio * 100) / 100;
  const storage = Math.round(amount * storageRatio * 100) / 100;
  const principal = Math.round((amount - interest - storage) * 100) / 100;

  const xeroId = await postRepaymentToXero({
    sourceCollection: "Loan",
    sourceId: loan._id,
    loan,
    method: paymentEntry.payment_method,
    date: paymentEntry.payment_date,
    reference: loan.loan_no,
    principal,
    interest,
    storage,
    penalty: 0,
  });

  if (xeroId && paymentEntry._id) {
    await Loan.updateOne(
      { _id: loan._id, "payments._id": paymentEntry._id },
      { $set: { "payments.$.xero_bank_transaction_id": xeroId } },
    );
  }
  return xeroId;
}

// ── Event 4: Expense approved ──────────────────────────────────────────────
// BankTransaction (SPEND), contact = internal placeholder (this system doesn't track
// individual vendors), coded to the account matching the expense's category.
async function syncExpenseApproved(expense) {
  return withSyncLog(
    {
      sourceCollection: "Expense",
      sourceId: expense._id,
      eventType: "expense_approved",
      xeroEndpoint: "BankTransactions",
      payload: { expense_no: expense.expense_no, amount: expense.amount, category: expense.category },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateInternalContact();
      const bankAccountKey = bankAccountKeyForMethod(expense.payment_method);
      const expenseKey = expenseAccountKeyForCategory(expense.category);
      const [bankCode, expenseCode] = await Promise.all([
        requireAccountCode(bankAccountKey),
        requireAccountCode(expenseKey),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "SPEND",
            contact: { contactID: contactId },
            date: toXeroDate(expense.expense_date),
            reference: expense.expense_no,
            status: "AUTHORISED",
            bankAccount: { code: bankCode },
            lineItems: [
              {
                description: expense.description || expense.category,
                quantity: 1,
                unitAmount: expense.amount,
                accountCode: expenseCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await Expense.updateOne({ _id: expense._id }, { $set: { xero_bank_transaction_id: xeroId } });
      return xeroId;
    },
  );
}

// ── Events 5/6: Investor deposit / capital withdrawal / profit withdrawal / drawing ──
// Single shared hook (investor_allocation_service.js recordTransaction). "expense" type
// rows are skipped here — they're already posted via syncExpenseApproved and linked by
// InvestorTransaction.expense_id, so posting them again would double-count the outflow.
const INVESTOR_TX_MAP = {
  deposit: { type: "RECEIVE", accountKey: "investor_capital_payable", label: "Capital deposit" },
  capital_withdrawal: { type: "SPEND", accountKey: "investor_capital_payable", label: "Capital withdrawal" },
  profit_withdrawal: { type: "SPEND", accountKey: "investor_profit_payable", label: "Profit withdrawal" },
  drawing: { type: "SPEND", accountKey: "investor_capital_payable", label: "Drawing" },
};

async function syncInvestorTransaction(tx) {
  if (tx.type === "expense") return null; // posted separately via syncExpenseApproved

  const mapping = INVESTOR_TX_MAP[tx.type];
  if (!mapping) return null;

  const eventType =
    tx.type === "deposit"
      ? "investor_deposit"
      : tx.type === "capital_withdrawal"
      ? "investor_capital_withdrawal"
      : tx.type === "profit_withdrawal"
      ? "investor_profit_withdrawal"
      : "investor_drawing";

  return withSyncLog(
    {
      sourceCollection: "InvestorTransaction",
      sourceId: tx._id,
      eventType,
      xeroEndpoint: "BankTransactions",
      payload: { investor_id: tx.investor_id, type: tx.type, amount: tx.amount },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateInvestorContact(tx.investor_id._id || tx.investor_id);
      // Investor cash movements aren't tied to a specific payment_method in this system —
      // default to the main bank account.
      const [bankCode, lineCode] = await Promise.all([
        requireAccountCode("bank_fbc_cbz"),
        requireAccountCode(mapping.accountKey),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: mapping.type,
            contact: { contactID: contactId },
            date: toXeroDate(tx.created_at || new Date()),
            reference: tx.source || mapping.label,
            status: "AUTHORISED",
            bankAccount: { code: bankCode },
            lineItems: [
              {
                description: `${mapping.label}${tx.notes ? ` — ${tx.notes}` : ""}`,
                quantity: 1,
                unitAmount: tx.amount,
                accountCode: lineCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await InvestorTransaction.updateOne({ _id: tx._id }, { $set: { xero_bank_transaction_id: xeroId } });
      return xeroId;
    },
  );
}

module.exports = {
  syncLoanDisbursed,
  syncLoanWrittenOff,
  syncLoanMovedToAuction,
  syncAuctionSaleCompleted,
  syncLoanRepayment,
  syncLoanRepaymentLegacy,
  syncExpenseApproved,
  syncInvestorTransaction,
};
