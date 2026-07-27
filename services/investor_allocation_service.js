"use strict";

const Investor = require("../models/investor/investor.model");
const InvestorProfitSplit = require("../models/investor/investor_profit_split.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const InvestorRRState = require("../models/investor/investor_rr_state.model");
const InvestorTransaction = require("../models/investor/investor_transaction.model");
const Loan = require("../models/loan.model");
const investorEmailService = require("./investor_email_service");

const DEFAULT_PROFIT_SPLIT = {
  two_week: { borrower_rate: 20, investor_share: 60, label: "2-Week Loan", days: 14 },
  one_month: { borrower_rate: 30, investor_share: 65, label: "1-Month Loan", days: 30 },
};

// Loan model uses "two_weeks", investor system uses "two_week"
const mapPeriodToTermKey = (loan_period_type) => {
  if (loan_period_type === "two_weeks") return "two_week";
  return loan_period_type;
};

class InvestorAllocationService {

  async getProfitSplitConfig() {
    let config = await InvestorProfitSplit.findOne();
    if (!config) config = await InvestorProfitSplit.create(DEFAULT_PROFIT_SPLIT);
    return config;
  }

  // ─── SWRR CORE ──────────────────────────────────────────────────────────────

  /**
   * Find all active investors eligible for a given loan based on their
   * loan_type_preferences and loan_term_preferences.
   */
  async getEligibleInvestors(loan) {
    const termKey = mapPeriodToTermKey(loan.loan_period_type);
    const loanPrincipal = loan.principal_amount || 0;

    // Fetch all preference-matched active investors
    const candidates = await Investor.find({
      kind: { $in: ["individual", "company", "company_client", "rtc"] },
      status: "active",
      loan_type_preferences: loan.collateral_category,
      loan_term_preferences: termKey,
      committed_capital: { $gt: 0 },
    }).sort({ committed_capital: -1 });

    if (candidates.length === 0) return [];

    // Compute available balance: committed_capital − capital locked in active loans
    const investorIds = candidates.map((i) => i._id);
    const activeAllocations = await InvestorLoanAllocation.find({
      investor_id: { $in: investorIds },
      status: "active",
    }).select("investor_id principal_amount");

    const deployedMap = new Map();
    for (const alloc of activeAllocations) {
      const id = alloc.investor_id.toString();
      deployedMap.set(id, (deployedMap.get(id) || 0) + alloc.principal_amount);
    }

    return candidates.filter((investor) => {
      const deployed = deployedMap.get(investor._id.toString()) || 0;
      const available = investor.committed_capital - deployed;
      if (available < loanPrincipal) {
        console.warn(
          `[InvestorAllocation] Skipping ${investor.name}: ` +
            `available cash $${available.toFixed(2)} < loan principal $${loanPrincipal.toFixed(2)}`,
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Smooth Weighted Round-Robin selection.
   *
   * Algorithm (per cycle):
   *   1. For each eligible investor i: weight[i] += committed_capital[i]
   *   2. Select investor with max weight
   *   3. weight[selected] -= total_committed_capital_of_eligible_investors
   *
   * This naturally distributes loans proportionally to committed capital
   * across any number of cycles without resetting.
   */
  async selectInvestorSWRR(eligibleInvestors) {
    if (eligibleInvestors.length === 0) return null;

    let state = await InvestorRRState.findOne();
    if (!state) state = await InvestorRRState.create({ weights: [] });

    const weightMap = new Map();
    for (const w of state.weights) {
      weightMap.set(w.investor_id.toString(), w.current_weight);
    }

    const totalCapital = eligibleInvestors.reduce((s, inv) => s + inv.committed_capital, 0);

    // Step 1: add each investor's committed_capital to their running weight
    for (const investor of eligibleInvestors) {
      const id = investor._id.toString();
      weightMap.set(id, (weightMap.get(id) ?? 0) + investor.committed_capital);
    }

    // Step 2: pick highest weight
    let maxWeight = -Infinity;
    let selected = null;
    for (const investor of eligibleInvestors) {
      const w = weightMap.get(investor._id.toString()) ?? 0;
      if (w > maxWeight) {
        maxWeight = w;
        selected = investor;
      }
    }

    if (!selected) return null;

    // Step 3: deduct total capital from winner
    const sid = selected._id.toString();
    weightMap.set(sid, weightMap.get(sid) - totalCapital);

    // Merge with full state (preserves weights of non-eligible investors)
    const merged = new Map();
    for (const w of state.weights) merged.set(w.investor_id.toString(), w.current_weight);
    for (const [id, weight] of weightMap) merged.set(id, weight);

    state.weights = Array.from(merged.entries()).map(([investor_id, current_weight]) => ({
      investor_id,
      current_weight,
    }));
    await state.save();

    return selected;
  }

  // ─── ASSIGNMENT ──────────────────────────────────────────────────────────────

  /**
   * Assign a loan to the best eligible investor via SWRR.
   * Called automatically when a loan transitions to "active" status.
   */
  async assignLoan(loanId) {
    const existing = await InvestorLoanAllocation.findOne({ loan_id: loanId });
    if (existing) {
      return { success: false, message: "Loan is already assigned.", allocation: existing };
    }

    const loan = await Loan.findById(loanId);
    if (!loan) return { success: false, message: "Loan not found." };

    const eligibleInvestors = await this.getEligibleInvestors(loan);
    if (eligibleInvestors.length === 0) {
      console.warn(
        `[InvestorAllocation] No eligible investors for loan ${loan.loan_no} ` +
          `(category=${loan.collateral_category}, period=${loan.loan_period_type}, ` +
          `principal=$${(loan.principal_amount || 0).toFixed(2)}) — ` +
          `no investor has sufficient available cash balance.`,
      );
      return {
        success: false,
        message:
          "No eligible investors for this loan — either no preferences match or no investor " +
          "has sufficient available cash balance to fund this loan.",
      };
    }

    const selectedInvestor = await this.selectInvestorSWRR(eligibleInvestors);
    if (!selectedInvestor) return { success: false, message: "Could not select investor." };

    const profitConfig = await this.getProfitSplitConfig();
    const termKey = mapPeriodToTermKey(loan.loan_period_type);
    const termConfig = profitConfig[termKey] || DEFAULT_PROFIT_SPLIT[termKey];

    // Per-investor negotiated share takes precedence over the platform default
    const investorSharePct =
      selectedInvestor.profit_share_override?.[termKey] ?? termConfig.investor_share;

    const totalLoanProfit = Math.max(
      (loan.expected_total_repayable || loan.principal_amount) - loan.principal_amount,
      0,
    );
    const investorProfit = parseFloat((totalLoanProfit * (investorSharePct / 100)).toFixed(2));
    const rtcRevenue = parseFloat((totalLoanProfit - investorProfit).toFixed(2));

    const allocation = await InvestorLoanAllocation.create({
      investor_id: selectedInvestor._id,
      loan_id: loan._id,
      loan_no: loan.loan_no,
      collateral_category: loan.collateral_category,
      loan_period_key: termKey,
      principal_amount: loan.principal_amount,
      total_loan_profit: totalLoanProfit,
      investor_share_pct: investorSharePct,
      investor_profit: investorProfit,
      rtc_revenue: rtcRevenue,
      status: "active",
    });

    console.log(
      `[InvestorAllocation] Loan ${loan.loan_no} → ${selectedInvestor.name} ` +
        `(share=${investorSharePct}%, profit=$${investorProfit})`,
    );

    // Fire-and-forget: populate loan with asset + borrower for email, then send
    Loan.findById(loanId)
      .populate("asset", "title asset_images evaluated_value")
      .populate("customer_user", "first_name last_name phone")
      .then((populatedLoan) => {
        if (!populatedLoan) return;
        return investorEmailService.sendLoanAssignmentEmails({
          investor: selectedInvestor,
          loan: populatedLoan,
          allocation,
          asset: populatedLoan.asset,
          borrower: populatedLoan.customer_user,
        });
      })
      .catch((err) => console.error("[assignLoan] Email error:", err));

    return { success: true, allocation, investor: selectedInvestor };
  }

  /**
   * Update allocation status when the underlying loan status changes.
   * active → "redeemed" / "defaulted" / "written_off" / "cancelled"
   */
  async syncAllocationStatus(loanId, loanStatus) {
    const allocation = await InvestorLoanAllocation.findOne({ loan_id: loanId });
    if (!allocation || allocation.status !== "active") return null;

    const terminalCompleted = ["redeemed", "partially_paid"];
    const terminalDefaulted = ["defaulted", "written_off", "auction"];
    const terminalCancelled = ["cancelled"];

    let newStatus = null;
    if (terminalCompleted.includes(loanStatus)) newStatus = "completed";
    else if (terminalDefaulted.includes(loanStatus)) newStatus = "defaulted";
    else if (terminalCancelled.includes(loanStatus)) newStatus = "cancelled";

    if (newStatus) {
      allocation.status = newStatus;
      allocation.completed_at = new Date();
      await allocation.save();
    }

    return allocation;
  }

  // ─── QUERIES ─────────────────────────────────────────────────────────────────

  /**
   * Get all allocations for a single investor, populated with full loan + borrower + asset data.
   */
  async getInvestorAllocations(investorId, { page = 1, limit = 50, status } = {}) {
    const filter = { investor_id: investorId };
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const [allocations, total] = await Promise.all([
      InvestorLoanAllocation.find(filter)
        .sort({ allocated_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate({
          path: "loan_id",
          select:
            "loan_no principal_amount loan_period_type interest_amount storage_charge_amount expected_total_repayable start_date due_date status collateral_category",
          populate: [
            {
              path: "customer_user",
              select:
                "first_name last_name phone national_id_number address national_id_image_url",
            },
            {
              path: "asset",
              select: "title category asset_images storage_location evaluated_value description",
            },
          ],
        }),
      InvestorLoanAllocation.countDocuments(filter),
    ]);

    return { allocations, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) };
  }

  /**
   * Aggregate portfolio stats for a single investor.
   */
  async getInvestorStats(investorId) {
    const investor = await Investor.findById(investorId);
    if (!investor) return null;

    const allocations = await InvestorLoanAllocation.find({ investor_id: investorId });

    const active = allocations.filter((a) => a.status === "active");
    const completed = allocations.filter((a) => a.status === "completed");
    const defaulted = allocations.filter((a) => a.status === "defaulted");

    const deployedCapital = active.reduce((s, a) => s + a.principal_amount, 0);
    const totalProfit = completed.reduce((s, a) => s + a.investor_profit, 0);
    const expectedReturns = active.reduce((s, a) => s + a.investor_profit, 0);
    const availableBalance = Math.max(investor.committed_capital - deployedCapital, 0);
    const roiPct =
      investor.committed_capital > 0
        ? parseFloat(((totalProfit / investor.committed_capital) * 100).toFixed(2))
        : 0;

    return {
      committed_capital: investor.committed_capital,
      deployed_capital: deployedCapital,
      available_balance: availableBalance,
      total_investor_profit: totalProfit,
      expected_returns: expectedReturns,
      roi_pct: roiPct,
      active_loan_count: active.length,
      completed_loan_count: completed.length,
      defaulted_loan_count: defaulted.length,
      total_loan_count: allocations.length,
    };
  }

  /**
   * Monthly portfolio value for an investor (actual + projected).
   */
  async getInvestorGrowthHistory(investorId, monthsBack = 11, monthsForward = 5) {
    const investor = await Investor.findById(investorId);
    if (!investor) return [];

    const completedAllocations = await InvestorLoanAllocation.find({
      investor_id: investorId,
      status: "completed",
      completed_at: { $ne: null },
    }).sort({ completed_at: 1 });

    const now = new Date();
    const points = [];

    // Compute average monthly return rate from completed history
    let monthlyRate = 0;
    if (completedAllocations.length > 0 && investor.committed_capital > 0) {
      const totalProfit = completedAllocations.reduce((s, a) => s + a.investor_profit, 0);
      const firstAt = new Date(completedAllocations[0].completed_at);
      const monthsDiff = Math.max(
        1,
        (now.getTime() - firstAt.getTime()) / (1000 * 60 * 60 * 24 * 30),
      );
      monthlyRate = totalProfit / investor.committed_capital / monthsDiff;
    }

    for (let m = -monthsBack; m <= monthsForward; m++) {
      const date = new Date(now);
      date.setMonth(date.getMonth() + m);
      date.setDate(1);
      const isProjected = m > 0;

      // End of this month for historical lookup
      const endOfMonth = new Date(date);
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);
      endOfMonth.setHours(23, 59, 59, 999);

      let cumulativeProfit = 0;
      for (const alloc of completedAllocations) {
        if (new Date(alloc.completed_at) <= endOfMonth) {
          cumulativeProfit += alloc.investor_profit;
        }
      }

      let projectedExtra = 0;
      if (isProjected) {
        projectedExtra = investor.committed_capital * monthlyRate * m;
      }

      points.push({
        date: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        value: Math.round(investor.committed_capital + cumulativeProfit + projectedExtra),
        projected: isProjected,
      });
    }

    return points;
  }

  /**
   * Platform-wide aggregate stats for the admin dashboard.
   */
  async getAdminStats() {
    const [investors, allAllocations] = await Promise.all([
      Investor.find({ kind: { $ne: "admin" }, status: { $ne: "deleted" } }),
      InvestorLoanAllocation.find(),
    ]);

    const byKind = { individual: 0, company: 0, company_client: 0, rtc: 0 };
    let totalCommitted = 0;
    let rtcCommitted = 0;
    let rtcInvestorId = null;

    for (const inv of investors) {
      if (inv.kind in byKind) byKind[inv.kind]++;
      totalCommitted += inv.committed_capital;
      if (inv.kind === "rtc") {
        rtcCommitted += inv.committed_capital;
        rtcInvestorId = inv._id.toString();
      }
    }

    const active = allAllocations.filter((a) => a.status === "active");
    const completed = allAllocations.filter((a) => a.status === "completed");

    const totalDeployed = active.reduce((s, a) => s + a.principal_amount, 0);
    const totalInvestorProfit = completed.reduce((s, a) => s + a.investor_profit, 0);
    const totalRtcRevenue = completed.reduce((s, a) => s + a.rtc_revenue, 0);
    const totalExpectedReturns = active.reduce((s, a) => s + a.investor_profit, 0);

    // RTC-as-investor specific stats
    const rtcActive = rtcInvestorId
      ? active.filter((a) => a.investor_id.toString() === rtcInvestorId)
      : [];
    const rtcCompleted = rtcInvestorId
      ? completed.filter((a) => a.investor_id.toString() === rtcInvestorId)
      : [];
    const rtcProfit = rtcCompleted.reduce((s, a) => s + a.investor_profit, 0);
    const rtcDeployed = rtcActive.reduce((s, a) => s + a.principal_amount, 0);

    return {
      total_committed_capital: totalCommitted,
      total_deployed: totalDeployed,
      total_available: Math.max(totalCommitted - totalDeployed, 0),
      total_investor_profit: totalInvestorProfit,
      total_rtc_revenue: totalRtcRevenue,
      total_expected_returns: totalExpectedReturns,
      active_loan_count: active.length,
      completed_loan_count: completed.length,
      investor_count: byKind,
      // RTC-as-investor breakdown
      rtc_committed_capital: rtcCommitted,
      rtc_deployed_capital: rtcDeployed,
      rtc_investor_profit: rtcProfit,
      rtc_active_loan_count: rtcActive.length,
      external_committed_capital: totalCommitted - rtcCommitted,
    };
  }

  // ─── RTC ACCOUNT ─────────────────────────────────────────────────────────────

  /**
   * Get (or create) Real Time Capital's own singleton investor account.
   * The RTC account participates in the SWRR algorithm alongside external investors.
   */
  async getRtcAccount() {
    let account = await Investor.findOne({ kind: "rtc" });
    if (!account) {
      const bcrypt = require("bcryptjs");
      const password_hash = await bcrypt.hash(
        require("crypto").randomBytes(32).toString("hex"),
        10,
      );
      account = await Investor.create({
        kind: "rtc",
        name: "Real Time Capital",
        email: "rtc.capital@rtcapital.co.zw",
        password_hash,
        avatar_color: "#10b981",
        status: "active",
        committed_capital: 0,
        loan_type_preferences: ["small_loans", "motor_vehicle", "jewellery"],
        loan_term_preferences: ["two_week", "one_month"],
        title: "RTC Internal Investment Account",
        notes: "Capital pool from Real Time Capital's own funds deployed alongside investor funds.",
      });
      console.log("[InvestorAllocation] Created RTC investor account:", account._id);
    }
    return account;
  }

  /**
   * Update the amount of capital RTC has committed as an investor.
   */
  async updateRtcCapital(amount) {
    const account = await this.getRtcAccount();
    account.committed_capital = Math.max(0, amount);
    await account.save();
    return account;
  }

  /**
   * All allocations across the platform (admin loans ledger).
   */
  async getAllAllocations({ page = 1, limit = 50, status, investorId } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (investorId) filter.investor_id = investorId;

    const skip = (Number(page) - 1) * Number(limit);

    const [allocations, total] = await Promise.all([
      InvestorLoanAllocation.find(filter)
        .sort({ allocated_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("investor_id", "name email kind avatar_color")
        .populate({
          path: "loan_id",
          select:
            "loan_no principal_amount loan_period_type start_date due_date status collateral_category",
          populate: [
            { path: "customer_user", select: "first_name last_name national_id_number phone" },
            { path: "asset", select: "title asset_images" },
          ],
        }),
      InvestorLoanAllocation.countDocuments(filter),
    ]);

    return { allocations, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) };
  }

  // ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

  /**
   * Compute the full accounting summary for one investor.
   *
   * Accounting rules:
   *   committed_capital         = investor.committed_capital (updated on deposit/capital_withdrawal)
   *   deployed_capital          = sum(principal) of ACTIVE allocations
   *   available_balance         = committed_capital − deployed_capital  (idle, can be withdrawn)
   *   total_realized_profit     = sum(investor_profit) of COMPLETED allocations
   *   total_profit_withdrawn    = sum(amount) of profit_withdrawal transactions
   *   available_profit          = total_realized_profit − total_profit_withdrawn
   *   pending_profit            = sum(investor_profit) of ACTIVE allocations (in-flight)
   */
  async getTransactionSummary(investorId) {
    const investor = await Investor.findById(investorId);
    if (!investor) return null;

    const [transactions, allocations] = await Promise.all([
      InvestorTransaction.find({ investor_id: investorId }),
      InvestorLoanAllocation.find({ investor_id: investorId }),
    ]);

    const activeAllocs = allocations.filter((a) => a.status === "active");
    const completedAllocs = allocations.filter((a) => a.status === "completed");

    const totalDeposits = transactions
      .filter((t) => t.type === "deposit")
      .reduce((s, t) => s + t.amount, 0);
    const totalCapitalWithdrawn = transactions
      .filter((t) => t.type === "capital_withdrawal")
      .reduce((s, t) => s + t.amount, 0);
    const totalProfitWithdrawn = transactions
      .filter((t) => t.type === "profit_withdrawal")
      .reduce((s, t) => s + t.amount, 0);

    const deployedCapital = activeAllocs.reduce((s, a) => s + a.principal_amount, 0);
    const totalRealizedProfit = completedAllocs.reduce((s, a) => s + a.investor_profit, 0);
    const pendingProfit = activeAllocs.reduce((s, a) => s + a.investor_profit, 0);

    const committedCapital = investor.committed_capital;
    const availableBalance = Math.max(committedCapital - deployedCapital, 0);
    const availableProfitToWithdraw = Math.max(totalRealizedProfit - totalProfitWithdrawn, 0);

    return {
      committed_capital: committedCapital,
      deployed_capital: deployedCapital,
      available_balance: availableBalance,
      total_deposits: totalDeposits,
      total_capital_withdrawn: totalCapitalWithdrawn,
      total_profit_withdrawn: totalProfitWithdrawn,
      total_realized_profit: totalRealizedProfit,
      available_profit_to_withdraw: availableProfitToWithdraw,
      available_capital_to_withdraw: availableBalance,
      pending_profit: pendingProfit,
    };
  }

  /**
   * Record a deposit, profit withdrawal, or capital withdrawal.
   * Validates available balance before recording. Updates committed_capital atomically.
   */
  async recordTransaction(investorId, { type, amount, notes, recordedById }) {
    const investor = await Investor.findById(investorId);
    if (!investor) throw new Error("Investor not found.");

    const validTypes = ["deposit", "profit_withdrawal", "capital_withdrawal"];
    if (!validTypes.includes(type)) throw new Error("Invalid transaction type.");
    if (!amount || amount <= 0) throw new Error("Amount must be greater than zero.");

    const capitalBefore = investor.committed_capital;
    let capitalAfter = capitalBefore;

    if (type === "deposit") {
      capitalAfter = parseFloat((capitalBefore + amount).toFixed(2));
      investor.committed_capital = capitalAfter;
      await investor.save();
    } else if (type === "capital_withdrawal") {
      const activeAllocs = await InvestorLoanAllocation.find({
        investor_id: investorId,
        status: "active",
      });
      const deployedCapital = activeAllocs.reduce((s, a) => s + a.principal_amount, 0);
      const availableBalance = capitalBefore - deployedCapital;
      if (amount > availableBalance + 0.01) {
        throw new Error(
          `Only $${availableBalance.toFixed(2)} is available for capital withdrawal ` +
            `(committed: $${capitalBefore.toFixed(2)}, deployed in active loans: $${deployedCapital.toFixed(2)}).`,
        );
      }
      capitalAfter = parseFloat(Math.max(capitalBefore - amount, 0).toFixed(2));
      investor.committed_capital = capitalAfter;
      await investor.save();
    } else if (type === "profit_withdrawal") {
      const [existingWithdrawals, completedAllocs] = await Promise.all([
        InvestorTransaction.find({ investor_id: investorId, type: "profit_withdrawal" }),
        InvestorLoanAllocation.find({ investor_id: investorId, status: "completed" }),
      ]);
      const totalProfitWithdrawn = existingWithdrawals.reduce((s, t) => s + t.amount, 0);
      const totalRealizedProfit = completedAllocs.reduce((s, a) => s + a.investor_profit, 0);
      const availableProfit = totalRealizedProfit - totalProfitWithdrawn;
      if (amount > availableProfit + 0.01) {
        throw new Error(
          `Only $${availableProfit.toFixed(2)} in realized profit is available ` +
            `(earned: $${totalRealizedProfit.toFixed(2)}, already paid out: $${totalProfitWithdrawn.toFixed(2)}).`,
        );
      }
      capitalAfter = capitalBefore; // profit withdrawal never reduces committed_capital
    }

    const tx = await InvestorTransaction.create({
      investor_id: investorId,
      type,
      amount: parseFloat(amount.toFixed(2)),
      notes: notes ? notes.trim() : null,
      recorded_by: recordedById || null,
      committed_capital_before: capitalBefore,
      committed_capital_after: capitalAfter,
    });

    const populated = await InvestorTransaction.findById(tx._id).populate("recorded_by", "name email");

    // Fire-and-forget confirmation email to investor
    investorEmailService.sendTransactionConfirmationEmail({
      investor,
      transaction: populated,
    }).catch((err) => console.error("[recordTransaction] Email error:", err));

    return { transaction: populated, investor };
  }

  /**
   * Get transaction history for an investor (newest first).
   */
  async getTransactions(investorId, { page = 1, limit = 100 } = {}) {
    const skip = (Number(page) - 1) * Number(limit);
    const [transactions, total] = await Promise.all([
      InvestorTransaction.find({ investor_id: investorId })
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("recorded_by", "name email"),
      InvestorTransaction.countDocuments({ investor_id: investorId }),
    ]);
    return { transactions, total };
  }
}

module.exports = new InvestorAllocationService();
