"use strict";

const mongoose = require("mongoose");
const Loan = require("../models/loan.model");
const User = require("../models/user.model");
const AgentCommission = require("../models/agent_commission.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");

const round2 = (n) => Math.round((n || 0) * 100) / 100;

class AgentCommissionService {
  /**
   * Validates and normalizes the referral/commission fields on loanData at loan-creation
   * time. Mirrors LoanService.applyNegotiatedRate's pattern: derives is_referral_loan from
   * whether a real, valid referral_agent_id was sent — never trusts a client boolean
   * directly. Called from LoanService.createLoan right after validateAdminFee, so
   * loanData.admin_fee_pct is already resolved by the time this runs.
   */
  async validateReferralCommission(loanData, userId) {
    const agentId = loanData.referral_agent_id;

    if (!agentId) {
      loanData.is_referral_loan = false;
      loanData.referral_agent_id = null;
      loanData.admin_fee_commission_pct = 0;
      loanData.admin_fee_commission_amount = 0;
      loanData.interest_commission_enabled = false;
      loanData.interest_commission_pct = 0;
      loanData.referral_set_by = null;
      loanData.referral_set_by_role = null;
      loanData.referral_set_at = null;
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      throw { status: 400, message: "referral_agent_id is not a valid user ID." };
    }
    const agent = await User.findById(agentId).select("roles status");
    if (!agent || !agent.roles.includes("agent")) {
      throw { status: 400, message: "referral_agent_id must belong to a registered agent." };
    }
    if (agent.status !== "active") {
      throw { status: 400, message: "This agent's account is not active." };
    }

    const adminFeePct = loanData.admin_fee_pct || 0;
    const commissionPct = Number(loanData.admin_fee_commission_pct);
    if (loanData.admin_fee_commission_pct == null || Number.isNaN(commissionPct) || commissionPct < 0) {
      throw {
        status: 400,
        message: "admin_fee_commission_pct must be a number 0 or greater when a referral agent is set.",
      };
    }
    if (adminFeePct === 0 && commissionPct > 0) {
      throw { status: 400, message: "This loan has no admin fee — admin_fee_commission_pct must be 0." };
    }
    if (commissionPct > adminFeePct) {
      throw {
        status: 400,
        message: `admin_fee_commission_pct (${commissionPct}) cannot exceed the loan's admin_fee_pct (${adminFeePct}).`,
      };
    }

    loanData.is_referral_loan = true;
    loanData.admin_fee_commission_pct = commissionPct;
    loanData.admin_fee_commission_amount = round2((loanData.principal_amount || 0) * (commissionPct / 100));

    if (loanData.interest_commission_enabled) {
      const interestPct = Number(loanData.interest_commission_pct);
      if (Number.isNaN(interestPct) || interestPct < 0 || interestPct > 100) {
        throw { status: 400, message: "interest_commission_pct must be a number between 0 and 100." };
      }
      loanData.interest_commission_enabled = true;
      loanData.interest_commission_pct = interestPct;
    } else {
      loanData.interest_commission_enabled = false;
      loanData.interest_commission_pct = 0;
    }

    let actorRole = null;
    if (userId) {
      const actor = await User.findById(userId).select("roles");
      actorRole = actor?.roles?.[0] || null;
    }
    loanData.referral_set_by = userId || null;
    loanData.referral_set_by_role = actorRole;
    loanData.referral_set_at = new Date();
  }

  /**
   * Accrues the agent's cut of an admin fee that was just recognized as RTC revenue
   * (loan creation via investorAllocationService.assignLoan, or a top-up via
   * LoanService.topUpLoan). No-op if the loan isn't a referral loan or the rate is 0.
   * Idempotent via AgentCommission's partial unique index on
   * (loan_id, commission_type, source_event, top_up_index) — a duplicate call is
   * swallowed, not thrown, so it's safe to call from a retried/fire-and-forget path.
   */
  async accrueAdminFeeCommission(loan, { sourceEvent, topUpIndex = null, feeAmount, relevantPrincipal, commissionPct }) {
    if (!loan.is_referral_loan || !loan.referral_agent_id) return null;
    const pct = commissionPct != null ? commissionPct : loan.admin_fee_commission_pct;
    if (!pct || pct <= 0) return null;
    if (!feeAmount || feeAmount <= 0) return null;

    const commissionAmount = round2((relevantPrincipal || 0) * (pct / 100));
    if (commissionAmount <= 0) return null;

    try {
      return await AgentCommission.create({
        agent_id: loan.referral_agent_id,
        loan_id: loan._id,
        loan_no: loan.loan_no,
        customer_user: loan.customer_user,
        commission_type: "admin_fee",
        source_event: sourceEvent,
        top_up_index: topUpIndex,
        basis_amount: round2(feeAmount),
        commission_pct: pct,
        commission_amount: commissionAmount,
        rtc_kept_amount: round2(feeAmount - commissionAmount),
      });
    } catch (err) {
      if (err.code === 11000) return null; // already accrued for this loan/event
      throw err;
    }
  }

  /**
   * RTC's revenue share % for this loan's interest income, read from the loan's primary
   * InvestorLoanAllocation (100 - investor_share_pct). Once every loan (including
   * rollovers, per the rolloverLoan fix) gets a real allocation, this never needs an
   * approximation fallback — if it's missing, that's a real data problem worth surfacing,
   * not silently guessing.
   */
  async getRtcInterestSharePct(loan) {
    const allocation = await InvestorLoanAllocation.findOne({
      loan_id: loan._id,
      is_co_investor: false,
    }).select("investor_share_pct");
    if (!allocation) {
      console.warn(
        `[AgentCommission] No investor allocation found for loan ${loan.loan_no} — skipping interest commission for this payment.`,
      );
      return null;
    }
    return 100 - allocation.investor_share_pct;
  }

  /**
   * The core per-payment hook. Computes the interest portion of THIS payment using the
   * same proportional ratio already used for Xero GL posting (xero_sync_service's
   * syncLoanRepaymentLegacy) — reused deliberately rather than reinvented, since it's the
   * one place in the codebase that already isolates "how much of this payment was
   * interest." Storage is never touched. Commission tracks only what was actually paid,
   * never a front-loaded expected total, and automatically reflects top-ups because
   * loan.interest_amount/expected_total_repayable are already mutated in place by
   * LoanService.topUpLoan.
   */
  async accrueInterestCommission(loan, paymentAmount, paymentId) {
    if (!loan.is_referral_loan || !loan.interest_commission_enabled || !loan.referral_agent_id) return null;
    if (!loan.interest_commission_pct || loan.interest_commission_pct <= 0) return null;
    if (!paymentAmount || paymentAmount <= 0) return null;

    const total = loan.expected_total_repayable || loan.principal_amount || 1;
    const interestRatio = (loan.interest_amount || 0) / total;
    const interestPortion = round2(paymentAmount * interestRatio);
    if (interestPortion <= 0) return null;

    const rtcSharePct = await this.getRtcInterestSharePct(loan);
    if (rtcSharePct == null) return null;

    const rtcInterestRevenue = round2(interestPortion * (rtcSharePct / 100));
    if (rtcInterestRevenue <= 0) return null;
    const commissionAmount = round2(rtcInterestRevenue * (loan.interest_commission_pct / 100));
    if (commissionAmount <= 0) return null;

    try {
      return await AgentCommission.create({
        agent_id: loan.referral_agent_id,
        loan_id: loan._id,
        loan_no: loan.loan_no,
        customer_user: loan.customer_user,
        commission_type: "interest",
        source_event: "payment",
        payment_id: paymentId || null,
        basis_amount: rtcInterestRevenue,
        commission_pct: loan.interest_commission_pct,
        commission_amount: commissionAmount,
        rtc_kept_amount: round2(rtcInterestRevenue - commissionAmount),
      });
    } catch (err) {
      if (err.code === 11000) return null; // already accrued for this loan/payment
      throw err;
    }
  }

  // ── Agent-facing reads ───────────────────────────────────────────────────

  async getAgentCommissions(agentId, { status, page = 1, limit = 20 } = {}) {
    const filter = { agent_id: agentId };
    if (status) filter.status = status;
    const skip = (Math.max(1, page) - 1) * limit;
    const [rows, total] = await Promise.all([
      AgentCommission.find(filter).sort({ accrued_at: -1 }).skip(skip).limit(limit),
      AgentCommission.countDocuments(filter),
    ]);
    return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getAgentCommissionsSummary(agentId) {
    const rows = await AgentCommission.aggregate([
      { $match: { agent_id: new mongoose.Types.ObjectId(agentId), status: { $ne: "cancelled" } } },
      { $group: { _id: "$status", total: { $sum: "$commission_amount" } } },
    ]);
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.total]));
    return {
      pending_total: round2(byStatus.pending || 0),
      paid_total: round2(byStatus.paid || 0),
      lifetime_total: round2((byStatus.pending || 0) + (byStatus.paid || 0)),
    };
  }

  // ── RTC-admin reads ──────────────────────────────────────────────────────

  async getAllCommissions({ agent_id, status, loan_no, dateFrom, dateTo, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (agent_id) filter.agent_id = agent_id;
    if (status) filter.status = status;
    if (loan_no) filter.loan_no = new RegExp(loan_no.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (dateFrom || dateTo) {
      filter.accrued_at = {};
      if (dateFrom) filter.accrued_at.$gte = new Date(dateFrom);
      if (dateTo) filter.accrued_at.$lte = new Date(dateTo);
    }
    const skip = (Math.max(1, page) - 1) * limit;
    const [rows, total] = await Promise.all([
      AgentCommission.find(filter)
        .sort({ accrued_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate("agent_id", "first_name last_name email"),
      AgentCommission.countDocuments(filter),
    ]);
    return { rows, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * The RTC-team report: total admin-fee revenue (across ALL loans, referral or not — the
   * baseline "how much are we making" figure) vs. how much of it was given to agents vs.
   * kept, and the equivalent breakdown for interest commission — always reported as its
   * own section, never blended with admin-fee figures, since the two have genuinely
   * different bases (admin fee revenue is a tracked platform total; RTC's interest
   * revenue isn't tracked as a standalone running total anywhere today, it only exists
   * per-loan inside InvestorLoanAllocation and blends in storage — so "given to agents"
   * is reported honestly on its own rather than paired with a fabricated "total").
   */
  async getCommissionsReport({ dateFrom, dateTo } = {}) {
    const dateFilter = {};
    if (dateFrom) dateFilter.$gte = new Date(dateFrom);
    if (dateTo) dateFilter.$lte = new Date(dateTo);
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    const loanMatch = { admin_fee_collected: true };
    if (hasDateFilter) loanMatch.admin_fee_collected_at = dateFilter;
    const loans = await Loan.find(loanMatch).select("admin_fee_amount");
    // Top-up admin fees are already folded into loan.admin_fee_amount by topUpLoan, so a
    // single sum here doesn't double count them.
    const totalAdminFeeRevenue = round2(loans.reduce((s, l) => s + (l.admin_fee_amount || 0), 0));

    const commissionMatch = { status: { $ne: "cancelled" } };
    if (hasDateFilter) commissionMatch.accrued_at = dateFilter;

    const byTypeAgg = await AgentCommission.aggregate([
      { $match: commissionMatch },
      { $group: { _id: "$commission_type", total: { $sum: "$commission_amount" } } },
    ]);
    const givenByType = Object.fromEntries(byTypeAgg.map((r) => [r._id, round2(r.total)]));
    const givenAdminFee = givenByType.admin_fee || 0;
    const givenInterest = givenByType.interest || 0;

    const byAgentAgg = await AgentCommission.aggregate([
      { $match: commissionMatch },
      {
        $group: {
          _id: { agent_id: "$agent_id", commission_type: "$commission_type" },
          total: { $sum: "$commission_amount" },
          count: { $sum: 1 },
        },
      },
    ]);
    const byAgentMap = new Map();
    for (const row of byAgentAgg) {
      const key = row._id.agent_id.toString();
      if (!byAgentMap.has(key)) {
        byAgentMap.set(key, { agent_id: key, admin_fee_total: 0, interest_total: 0, count: 0 });
      }
      const entry = byAgentMap.get(key);
      entry[row._id.commission_type === "admin_fee" ? "admin_fee_total" : "interest_total"] = round2(row.total);
      entry.count += row.count;
    }
    const agents = await User.find({ _id: { $in: [...byAgentMap.keys()] } }).select("first_name last_name email");
    const agentById = Object.fromEntries(agents.map((a) => [a._id.toString(), a]));
    const byAgent = [...byAgentMap.values()].map((e) => ({
      ...e,
      agent_name: agentById[e.agent_id]
        ? `${agentById[e.agent_id].first_name || ""} ${agentById[e.agent_id].last_name || ""}`.trim()
        : "Unknown agent",
      agent_email: agentById[e.agent_id]?.email || null,
    }));

    const byLoanAgg = await AgentCommission.aggregate([
      { $match: commissionMatch },
      {
        $group: {
          _id: { loan_id: "$loan_id", loan_no: "$loan_no", commission_type: "$commission_type" },
          total: { $sum: "$commission_amount" },
        },
      },
    ]);
    const byLoanMap = new Map();
    for (const row of byLoanAgg) {
      const key = row._id.loan_id.toString();
      if (!byLoanMap.has(key)) {
        byLoanMap.set(key, { loan_id: key, loan_no: row._id.loan_no, admin_fee_total: 0, interest_total: 0 });
      }
      const entry = byLoanMap.get(key);
      entry[row._id.commission_type === "admin_fee" ? "admin_fee_total" : "interest_total"] = round2(row.total);
    }

    return {
      admin_fee: {
        total_revenue: totalAdminFeeRevenue,
        given_to_agents: givenAdminFee,
        kept_by_rtc: round2(totalAdminFeeRevenue - givenAdminFee),
      },
      interest: {
        given_to_agents: givenInterest,
      },
      by_agent: byAgent,
      by_loan: [...byLoanMap.values()],
    };
  }

  /**
   * Marks a batch of pending commissions as paid. All rows must belong to the same agent
   * (keeps one Xero contact/transaction per batch, avoids ambiguity). Returns the batch
   * summary the caller can hand to xeroSyncService.syncAgentCommissionPaid.
   */
  async payoutCommissions({ commission_ids, payout_method, payout_bank_account_key, payout_notes, userId }) {
    if (!Array.isArray(commission_ids) || commission_ids.length === 0) {
      throw { status: 400, message: "commission_ids must be a non-empty array." };
    }
    const rows = await AgentCommission.find({ _id: { $in: commission_ids } });
    if (rows.length !== commission_ids.length) {
      throw { status: 404, message: "One or more commission rows were not found." };
    }
    const agentIds = new Set(rows.map((r) => r.agent_id.toString()));
    if (agentIds.size > 1) {
      throw { status: 400, message: "All commissions in a single payout batch must belong to the same agent." };
    }
    const notPending = rows.filter((r) => r.status !== "pending");
    if (notPending.length > 0) {
      throw { status: 400, message: `${notPending.length} of the selected commissions are already paid or cancelled.` };
    }

    const payoutBatchId = `AGTCOMM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    await AgentCommission.updateMany(
      { _id: { $in: commission_ids } },
      {
        $set: {
          status: "paid",
          paid_at: now,
          paid_by: userId || null,
          payout_batch_id: payoutBatchId,
          payout_method: payout_method || null,
          payout_bank_account_key: payout_bank_account_key || null,
          payout_notes: payout_notes || null,
        },
      },
    );

    const totalAmount = round2(rows.reduce((s, r) => s + r.commission_amount, 0));
    return {
      payout_batch_id: payoutBatchId,
      agent_id: [...agentIds][0],
      total_amount: totalAmount,
      commission_ids: rows.map((r) => r._id.toString()),
      payout_method: payout_method || null,
      payout_bank_account_key: payout_bank_account_key || null,
      paid_at: now,
    };
  }
}

module.exports = new AgentCommissionService();
