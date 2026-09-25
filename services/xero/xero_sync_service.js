"use strict";

const { getAuthenticatedClient } = require("./xero_client_service");
const { requireAccountCode, requireBankAccountRef } = require("./xero_accounts_service");
const {
  getOrCreateCustomerContact,
  getOrCreateInvestorContact,
  getOrCreateInternalContact,
} = require("./xero_contact_service");
const { bankAccountKeyForMethod, expenseAccountKeyForCategory, toXeroDate, parseXeroError } = require("./xero_mapping_helpers");
const XeroSyncLog = require("../../models/xero/xero_sync_log.model");
const Loan = require("../../models/loan.model");
const Payment = require("../../models/payment.model");
const Expense = require("../../models/expense.model");
const InvestorTransaction = require("../../models/investor/investor_transaction.model");
const Auction = require("../../models/auction.model");
const BidPayment = require("../../models/bidPayment.model");
const Asset = require("../../models/asset.model");
const AgentCommission = require("../../models/agent_commission.model");
const InvestorLoanAllocation = require("../../models/investor/investor_loan_allocation.model");

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
    const { message } = parseXeroError(err);
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
  if (loan.xero_disbursement_transaction_id) return loan.xero_disbursement_transaction_id; // already posted
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
      const bankAccountKey = bankAccountKeyForMethod(loan.payment_method, {
        bankAccountKey: loan.disbursement_bank_account_key,
      });
      const [bankAccountRef, loansReceivableCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
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
            bankAccount: bankAccountRef,
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

// ── Admin fee recognized as RTC revenue (loan creation OR a top-up) ──────────
// Fixed 2026-09-23: this used to be routed through the generic investor-transaction
// path (recordTransaction → syncInvestorTransaction), which posted it as a "Capital
// deposit" crediting Investor Capital Payable — wrong on two counts: (1) it's RTC's own
// fee revenue, not investor capital, and (2) for a DEFERRED fee no cash has actually
// moved yet, so posting a BankTransaction RECEIVE against a real bank account recorded a
// cash movement that never happened. See syncInvestorTransaction's `tx.source ===
// "admin_fee"` skip below — that path no longer posts anything for admin-fee rows.
//
//   Upfront: real cash WAS collected separately at signing → BankTransaction RECEIVE
//            (Dr Bank, Cr Admin Fee Income).
//   Deferred: no cash has moved — the fee is just added to what the customer owes →
//             Manual Journal (Dr Loans Receivable, Cr Admin Fee Income). This is what
//             brings Loans Receivable up to match principal+fee — syncLoanDisbursed only
//             ever posts principal_amount, and postRepaymentToXero's proportional
//             "principal" split already assumes the fee is baked into
//             expected_total_repayable (see loan_service.calculateRepaymentBreakdown) —
//             without this journal, Loans Receivable would be credited down by more than
//             it was ever debited by.
async function syncAdminFeeRecognized(loan, { topUpIndex = null, feeAmount, feeType, paymentMethod, bankAccountKey, date } = {}) {
  const alreadyPosted =
    topUpIndex == null ? loan.xero_admin_fee_transaction_id : loan.top_ups?.[topUpIndex]?.xero_admin_fee_transaction_id;
  if (alreadyPosted) return alreadyPosted;
  if (!feeAmount || feeAmount <= 0) return null;

  return withSyncLog(
    {
      sourceCollection: "Loan",
      sourceId: loan._id,
      eventType: "admin_fee_recognized",
      xeroEndpoint: feeType === "upfront" ? "BankTransactions" : "ManualJournals",
      payload: { loan_no: loan.loan_no, amount: feeAmount, feeType, topUpIndex },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const revenueCode = await requireAccountCode("admin_fee_income");
      let xeroId;

      if (feeType === "upfront") {
        const contactId = await getOrCreateCustomerContact(loan.customer_user._id || loan.customer_user);
        const resolvedBankKey = bankAccountKeyForMethod(paymentMethod, { bankAccountKey });
        const bankAccountRef = await requireBankAccountRef(resolvedBankKey);
        const { body } = await accountingApi.createBankTransactions(tenantId, {
          bankTransactions: [
            {
              type: "RECEIVE",
              contact: { contactID: contactId },
              date: toXeroDate(date),
              reference: loan.loan_no,
              status: "AUTHORISED",
              bankAccount: bankAccountRef,
              lineItems: [
                {
                  description: `Admin fee (upfront)${topUpIndex != null ? " — top-up" : ""} — ${loan.loan_no}`,
                  quantity: 1,
                  unitAmount: feeAmount,
                  accountCode: revenueCode,
                },
              ],
            },
          ],
        });
        xeroId = body.bankTransactions[0].bankTransactionID;
      } else {
        const loansReceivableCode = await requireAccountCode("loans_receivable");
        const { body } = await accountingApi.createManualJournals(tenantId, {
          manualJournals: [
            {
              narration: `Admin fee (deferred)${topUpIndex != null ? " — top-up" : ""} recognized — ${loan.loan_no}`,
              date: toXeroDate(date),
              status: "POSTED",
              journalLines: [
                { lineAmount: feeAmount, accountCode: loansReceivableCode, description: "Deferred admin fee added to balance owed" },
                { lineAmount: -feeAmount, accountCode: revenueCode, description: "Admin fee income" },
              ],
            },
          ],
        });
        xeroId = body.manualJournals[0].manualJournalID;
      }

      if (topUpIndex == null) {
        await Loan.updateOne({ _id: loan._id }, { $set: { xero_admin_fee_transaction_id: xeroId } });
      } else {
        await Loan.updateOne({ _id: loan._id }, { $set: { [`top_ups.${topUpIndex}.xero_admin_fee_transaction_id`]: xeroId } });
      }
      return xeroId;
    },
  );
}

// ── Event 3: Loan written off ──────────────────────────────────────────────
// Manual Journal: Dr Bad Debt Write-offs, Cr Loans Receivable, for the remaining balance.
async function syncLoanWrittenOff(loan) {
  if (loan.xero_writeoff_journal_id) return loan.xero_writeoff_journal_id; // already posted
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
      const bankAccountKey = bankAccountKeyForMethod(bidPayment.method, {
        provider: bidPayment.provider,
        bankAccountKey: bidPayment.bank_account_key,
      });
      const [bankAccountRef, revenueCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
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
            bankAccount: bankAccountRef,
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

// ── RTC asset disposal sale ─────────────────────────────────────────────
// A collateral asset that RTC ended up owning (auction expired unsold, or a Super
// Admin sold it directly while it was still "in auction") gets sold off-platform —
// no BidPayment/bidder involved, so this is a separate entry point from
// syncAuctionSaleCompleted above, but posts to the exact same accounts: BankTransaction
// RECEIVE for the sale proceeds, plus a Manual Journal matching cost of sale against
// the loan balance that was reclassified into Pawned Assets Inventory when it defaulted.
async function syncAssetDisposalSale(asset, { costBasis, paymentMethod, bankAccountKey: explicitBankAccountKey }) {
  if (asset.xero_disposal_transaction_id) return asset.xero_disposal_transaction_id; // already posted

  return withSyncLog(
    {
      sourceCollection: "Asset",
      sourceId: asset._id,
      eventType: "asset_disposal_sale",
      xeroEndpoint: "BankTransactions",
      payload: { asset_no: asset.asset_no, amount: asset.disposal_sale_price, cost_basis: costBasis },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateInternalContact();
      const bankAccountKey = bankAccountKeyForMethod(paymentMethod, { bankAccountKey: explicitBankAccountKey });
      const [bankAccountRef, revenueCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
        requireAccountCode("asset_sale_revenue"),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "RECEIVE",
            contact: { contactID: contactId },
            date: toXeroDate(asset.disposed_at || new Date()),
            reference: asset.asset_no,
            status: "AUTHORISED",
            bankAccount: bankAccountRef,
            lineItems: [
              {
                description: `Disposal sale — ${asset.asset_no}`,
                quantity: 1,
                unitAmount: asset.disposal_sale_price,
                accountCode: revenueCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await Asset.updateOne({ _id: asset._id }, { $set: { xero_disposal_transaction_id: xeroId } });

      if (costBasis > 0) {
        const [cogsCode, inventoryCode] = await Promise.all([
          requireAccountCode("cost_of_asset_sales"),
          requireAccountCode("pawned_assets_inventory"),
        ]);
        await accountingApi.createManualJournals(tenantId, {
          manualJournals: [
            {
              narration: `Cost of asset disposed — ${asset.asset_no}`,
              date: toXeroDate(asset.disposed_at || new Date()),
              status: "POSTED",
              journalLines: [
                { lineAmount: costBasis, accountCode: cogsCode, description: "Cost of asset sales" },
                { lineAmount: -costBasis, accountCode: inventoryCode, description: "Pawned assets inventory" },
              ],
            },
          ],
        });
      }

      return xeroId;
    },
  );
}

// ── Atomic posting claims (prevents double-posting under concurrent execution) ──────
// Found 2026-09-23: 14 repayments had been posted to Xero as TWO separate real
// BankTransactions each. Root cause: both syncLoanRepayment/syncLoanRepaymentLegacy only
// ever checked `xero_bank_transaction_id` in memory before calling Xero, then wrote the
// result back afterward — a classic read-then-write race. Two near-simultaneous calls for
// the SAME payment (a live payment-recording call racing the 5-minute retry poller, or
// two retry cycles overlapping across a pm2 restart, which happens often in this
// deployment's workflow) could both read "not yet posted", both call Xero, and both
// succeed — two real transactions for one payment. Most of the 14 turned out to already
// be harmless (the org switch this session left the OLDER of each pair orphaned in a org
// we're no longer connected to), but at least one was a genuine live duplicate.
//
// Fix: atomically CLAIM the field with a sentinel value before ever calling Xero. A
// concurrent caller's claim attempt matches zero documents and backs off (returns null)
// instead of proceeding to post. If the claiming process itself dies before finishing
// (an actual crash, not just a Xero API error — those are handled by releasing the claim
// in a `finally`), the sentinel is timestamped so the retry scheduler can recognize it as
// stale (same 10-minute window as XeroSyncLog's own stuck-pending logic) and safely steal
// it back.
const POSTING_SENTINEL_PREFIX = "__POSTING__:";
const POSTING_SENTINEL_STALE_MS = 10 * 60 * 1000;

function isStalePostingSentinel(value) {
  if (typeof value !== "string" || !value.startsWith(POSTING_SENTINEL_PREFIX)) return false;
  const ts = Number(value.slice(POSTING_SENTINEL_PREFIX.length));
  return Number.isFinite(ts) && Date.now() - ts > POSTING_SENTINEL_STALE_MS;
}

// True when a stored xero_bank_transaction_id value means "still needs posting" — either
// genuinely empty, or a stale claim left behind by a crashed attempt. Used by the retry
// scheduler in place of a raw falsy check, so a stuck claim doesn't hide a payment from
// retry forever.
function needsRepaymentSync(xeroBankTransactionId) {
  return !xeroBankTransactionId || isStalePostingSentinel(xeroBankTransactionId);
}

async function claimPaymentPostingSlot(paymentId) {
  const sentinel = POSTING_SENTINEL_PREFIX + Date.now();
  let res = await Payment.updateOne({ _id: paymentId, xero_bank_transaction_id: null }, { $set: { xero_bank_transaction_id: sentinel } });
  if (res.modifiedCount > 0) return sentinel;

  const doc = await Payment.findById(paymentId).select("xero_bank_transaction_id");
  if (isStalePostingSentinel(doc?.xero_bank_transaction_id)) {
    res = await Payment.updateOne(
      { _id: paymentId, xero_bank_transaction_id: doc.xero_bank_transaction_id },
      { $set: { xero_bank_transaction_id: sentinel } },
    );
    if (res.modifiedCount > 0) return sentinel;
  }
  return null;
}

async function releasePaymentPostingSlot(paymentId, sentinel) {
  await Payment.updateOne({ _id: paymentId, xero_bank_transaction_id: sentinel }, { $set: { xero_bank_transaction_id: null } });
}

async function claimEmbeddedPaymentPostingSlot(loanId, paymentEntryId) {
  const sentinel = POSTING_SENTINEL_PREFIX + Date.now();
  let res = await Loan.updateOne(
    { _id: loanId, "payments._id": paymentEntryId, "payments.xero_bank_transaction_id": null },
    { $set: { "payments.$.xero_bank_transaction_id": sentinel } },
  );
  if (res.modifiedCount > 0) return sentinel;

  const doc = await Loan.findOne({ _id: loanId, "payments._id": paymentEntryId }, { "payments.$": 1 });
  const current = doc?.payments?.[0]?.xero_bank_transaction_id;
  if (isStalePostingSentinel(current)) {
    res = await Loan.updateOne(
      { _id: loanId, "payments._id": paymentEntryId, "payments.xero_bank_transaction_id": current },
      { $set: { "payments.$.xero_bank_transaction_id": sentinel } },
    );
    if (res.modifiedCount > 0) return sentinel;
  }
  return null;
}

async function releaseEmbeddedPaymentPostingSlot(loanId, paymentEntryId, sentinel) {
  await Loan.updateOne(
    { _id: loanId, "payments._id": paymentEntryId, "payments.xero_bank_transaction_id": sentinel },
    { $set: { "payments.$.xero_bank_transaction_id": null } },
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
  provider,
  bankAccountKey: explicitBankAccountKey,
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
      const bankAccountKey = bankAccountKeyForMethod(method, { provider, bankAccountKey: explicitBankAccountKey });

      const componentAccounts = [
        { amount: principal, key: "loans_receivable", label: "Principal repayment" },
        { amount: interest, key: "interest_income", label: "Interest" },
        { amount: storage, key: "storage_income", label: "Storage charge" },
        { amount: penalty, key: "penalty_income", label: "Penalty" },
      ].filter((c) => c.amount > 0);

      if (componentAccounts.length === 0) return null;

      const [bankAccountRef, ...componentCodes] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
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
            bankAccount: bankAccountRef,
            lineItems,
          },
        ],
      });

      return body.bankTransactions[0].bankTransactionID;
    },
  );
}

// ── Investor profit-share accrual — runs alongside every repayment, both paths ──────
// Fixed 2026-09-23: postRepaymentToXero above posts the FULL gross interest+storage of
// a payment to Interest Income/Storage Income regardless of who funded the loan — that's
// correct as a gross revenue figure. But nothing ever posted the flip side: the
// investor's cut of that same interest+storage is real money RTC owes them, and
// Investor Profit Payable (the liability account for it) was only ever being DEBITED
// (via a profit_withdrawal payout) — never CREDITED when the profit was actually earned.
// So its Xero balance had no relationship to what's actually owed, only ever drifting
// more negative over time.
//
// Manual Journal: Dr Investor Profit Share (RTC's real cost of funding through investor
// capital), Cr Investor Profit Payable, for (interest + storage of THIS payment) × the
// investor-side share %. That % is the SUM of every InvestorLoanAllocation row on this
// loan (the primary investor's investor_share_pct, plus a referral co-investor's if one
// exists) — RTC's own share (100 - that sum) is exactly what the gross Interest/Storage
// Income figures already represent, so this never touches those accounts. Skipped
// entirely when there's no InvestorLoanAllocation at all (RTC's own book, e.g. small_loans)
// — there's no investor to owe anything to.
async function accrueInvestorProfitShare(loan, { interest, storage, sourceCollection, sourceId, date }) {
  const profitPortion = Math.round(((interest || 0) + (storage || 0)) * 100) / 100;
  if (profitPortion <= 0) return null;

  const allocations = await InvestorLoanAllocation.find({ loan_id: loan._id }).select("investor_share_pct");
  if (allocations.length === 0) return null; // RTC's own book — nothing owed to anyone

  const investorSharePct = allocations.reduce((s, a) => s + (a.investor_share_pct || 0), 0);
  if (investorSharePct <= 0) return null;

  const investorAmount = Math.round(profitPortion * (investorSharePct / 100) * 100) / 100;
  if (investorAmount <= 0) return null;

  return withSyncLog(
    {
      sourceCollection,
      sourceId,
      eventType: "investor_profit_share_accrued",
      xeroEndpoint: "ManualJournals",
      payload: { loan_no: loan.loan_no, profitPortion, investorSharePct, investorAmount },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const [expenseCode, payableCode] = await Promise.all([
        requireAccountCode("investor_profit_share_expense"),
        requireAccountCode("investor_profit_payable"),
      ]);

      const { body } = await accountingApi.createManualJournals(tenantId, {
        manualJournals: [
          {
            narration: `Investor profit share accrued — ${loan.loan_no}`,
            date: toXeroDate(date),
            status: "POSTED",
            journalLines: [
              { lineAmount: investorAmount, accountCode: expenseCode, description: "Investor profit share" },
              { lineAmount: -investorAmount, accountCode: payableCode, description: "Investor profit payable" },
            ],
          },
        ],
      });

      return body.manualJournals[0].manualJournalID;
    },
  );
}

// Path 2a — the primary Payment-model repayment flow (services/payment_service.js
// updateLoanBalance). Component split comes straight from the Payment document.
async function syncLoanRepayment(payment, loan) {
  if (payment.xero_bank_transaction_id) return payment.xero_bank_transaction_id; // already posted

  const sentinel = await claimPaymentPostingSlot(payment._id);
  if (!sentinel) return null; // another process already claimed or completed this — back off

  let xeroId = null;
  try {
    xeroId = await postRepaymentToXero({
      sourceCollection: "Payment",
      sourceId: payment._id,
      loan,
      method: payment.method || payment.provider,
      provider: payment.provider,
      bankAccountKey: payment.bank_account_key,
      date: payment.paid_at,
      reference: payment.receipt_no || loan.loan_no,
      principal: payment.principal_component || 0,
      interest: payment.interest_component || 0,
      storage: payment.storage_component || 0,
      penalty: payment.penalty_component || 0,
    });
  } finally {
    if (xeroId) {
      await Payment.updateOne({ _id: payment._id }, { $set: { xero_bank_transaction_id: xeroId } });
    } else {
      await releasePaymentPostingSlot(payment._id, sentinel);
    }
  }
  if (!payment.xero_investor_profit_journal_id) {
    const journalId = await accrueInvestorProfitShare(loan, {
      interest: payment.interest_component || 0,
      storage: payment.storage_component || 0,
      sourceCollection: "Payment",
      sourceId: payment._id,
      date: payment.paid_at,
    });
    if (journalId) {
      await Payment.updateOne({ _id: payment._id }, { $set: { xero_investor_profit_journal_id: journalId } });
    }
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

  let sentinel = null;
  if (paymentEntry._id) {
    sentinel = await claimEmbeddedPaymentPostingSlot(loan._id, paymentEntry._id);
    if (!sentinel) return null; // another process already claimed or completed this — back off
  }

  const total = loan.expected_total_repayable || loan.principal_amount || 1;
  const interestRatio = (loan.interest_amount || 0) / total;
  const storageRatio = (loan.storage_charge_amount || 0) / total;

  const amount = paymentEntry.amount;
  const interest = Math.round(amount * interestRatio * 100) / 100;
  const storage = Math.round(amount * storageRatio * 100) / 100;
  const principal = Math.round((amount - interest - storage) * 100) / 100;

  let xeroId = null;
  try {
    xeroId = await postRepaymentToXero({
      sourceCollection: "Loan",
      sourceId: loan._id,
      loan,
      method: paymentEntry.payment_method,
      bankAccountKey: paymentEntry.bank_account_key,
      date: paymentEntry.payment_date,
      reference: loan.loan_no,
      principal,
      interest,
      storage,
      penalty: 0,
    });
  } finally {
    if (paymentEntry._id) {
      if (xeroId) {
        await Loan.updateOne(
          { _id: loan._id, "payments._id": paymentEntry._id },
          { $set: { "payments.$.xero_bank_transaction_id": xeroId } },
        );
      } else {
        await releaseEmbeddedPaymentPostingSlot(loan._id, paymentEntry._id, sentinel);
      }
    }
  }

  if (paymentEntry._id && !paymentEntry.xero_investor_profit_journal_id) {
    const journalId = await accrueInvestorProfitShare(loan, {
      interest,
      storage,
      sourceCollection: "Loan",
      sourceId: paymentEntry._id,
      date: paymentEntry.payment_date,
    });
    if (journalId) {
      await Loan.updateOne(
        { _id: loan._id, "payments._id": paymentEntry._id },
        { $set: { "payments.$.xero_investor_profit_journal_id": journalId } },
      );
    }
  }

  return xeroId;
}

// ── Event 4: Expense approved ──────────────────────────────────────────────
// BankTransaction (SPEND), contact = internal placeholder (this system doesn't track
// individual vendors), coded to the account matching the expense's category.
async function syncExpenseApproved(expense) {
  if (expense.xero_bank_transaction_id) return expense.xero_bank_transaction_id; // already posted
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
      const bankAccountKey = bankAccountKeyForMethod(expense.payment_method, {
        bankAccountKey: expense.bank_account_key,
      });
      const expenseKey = expenseAccountKeyForCategory(expense.category);
      const [bankAccountRef, expenseCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
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
            bankAccount: bankAccountRef,
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
  if (tx.xero_bank_transaction_id) return tx.xero_bank_transaction_id; // already posted
  if (tx.type === "expense") return null; // posted separately via syncExpenseApproved
  // Fixed 2026-09-23: this used to fall through to the generic deposit/withdrawal
  // mapping below, which posted admin fee revenue as a "Capital deposit" into Investor
  // Capital Payable — wrong account, and (for deferred fees) a fake cash movement that
  // never happened. Posted correctly now via syncAdminFeeRecognized instead — this row
  // still exists purely for RTC's own internal capital-ledger bookkeeping in Mongo.
  if (tx.source === "admin_fee") return null;

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
      const bankAccountKey = bankAccountKeyForMethod(tx.payment_method, {
        bankAccountKey: tx.bank_account_key,
      });
      const [bankAccountRef, lineCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
        requireAccountCode(mapping.accountKey),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: mapping.type,
            contact: { contactID: contactId },
            date: toXeroDate(tx.transaction_date || tx.created_at || new Date()),
            reference: tx.source || mapping.label,
            status: "AUTHORISED",
            bankAccount: bankAccountRef,
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

// ── Event 7: Agent referral commission paid ────────────────────────────────
// BankTransaction (SPEND), contact = the agent (a User — reuses getOrCreateCustomerContact,
// which already works for any User, not just customers), coded to "Agent Commission
// Expense". One transaction per payout batch. A batch has no single document of its own
// (it's several AgentCommission rows sharing payout_batch_id), so idempotency is checked
// by asking whether any row in the batch already carries a xero_bank_transaction_id.
async function syncAgentCommissionPaid(batch) {
  const alreadyPosted = await AgentCommission.findOne({
    payout_batch_id: batch.payout_batch_id,
    xero_bank_transaction_id: { $ne: null },
  });
  if (alreadyPosted) return alreadyPosted.xero_bank_transaction_id;

  return withSyncLog(
    {
      sourceCollection: "AgentCommission",
      sourceId: batch.payout_batch_id,
      eventType: "agent_commission_paid",
      xeroEndpoint: "BankTransactions",
      payload: { agent_id: batch.agent_id, total_amount: batch.total_amount, commission_ids: batch.commission_ids },
    },
    async () => {
      const { accountingApi, tenantId } = await getAuthenticatedClient();
      const contactId = await getOrCreateCustomerContact(batch.agent_id);
      const bankAccountKey = bankAccountKeyForMethod(batch.payout_method, {
        bankAccountKey: batch.payout_bank_account_key,
      });
      const [bankAccountRef, expenseCode] = await Promise.all([
        requireBankAccountRef(bankAccountKey),
        requireAccountCode("agent_commission_expense"),
      ]);

      const { body } = await accountingApi.createBankTransactions(tenantId, {
        bankTransactions: [
          {
            type: "SPEND",
            contact: { contactID: contactId },
            date: toXeroDate(batch.paid_at),
            reference: batch.payout_batch_id,
            status: "AUTHORISED",
            bankAccount: bankAccountRef,
            lineItems: [
              {
                description: `Agent referral commission payout (${batch.commission_ids.length} commission(s))`,
                quantity: 1,
                unitAmount: batch.total_amount,
                accountCode: expenseCode,
              },
            ],
          },
        ],
      });

      const xeroId = body.bankTransactions[0].bankTransactionID;
      await AgentCommission.updateMany(
        { _id: { $in: batch.commission_ids } },
        { $set: { xero_bank_transaction_id: xeroId } },
      );
      return xeroId;
    },
  );
}

module.exports = {
  syncLoanDisbursed,
  syncAdminFeeRecognized,
  syncLoanWrittenOff,
  syncLoanMovedToAuction,
  syncAuctionSaleCompleted,
  syncAssetDisposalSale,
  syncLoanRepayment,
  syncLoanRepaymentLegacy,
  accrueInvestorProfitShare,
  syncExpenseApproved,
  syncInvestorTransaction,
  syncAgentCommissionPaid,
  needsRepaymentSync,
};
