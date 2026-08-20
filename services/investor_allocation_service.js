"use strict";

const Investor = require("../models/investor/investor.model");
const InvestorProfitSplit = require("../models/investor/investor_profit_split.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const InvestorRRState = require("../models/investor/investor_rr_state.model");
const InvestorTransaction = require("../models/investor/investor_transaction.model");
const InvestorMonthlyInterest = require("../models/investor/investor_monthly_interest.model");
const TitleDeed = require("../models/investor/title_deed.model");
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
   *
   * small_loans is a special case: RTC funds every small loan directly and
   * keeps the profit, so it's never opened up to external investors here —
   * regardless of what any external investor has set in their own
   * loan_type_preferences.
   */
  async getEligibleInvestors(loan) {
    const termKey = mapPeriodToTermKey(loan.loan_period_type);
    const loanPrincipal = loan.principal_amount || 0;

    const eligibleKinds = loan.collateral_category === "small_loans"
      ? ["rtc"]
      : ["individual", "company", "company_client", "rtc"];

    // Fetch all preference-matched active investors
    const candidates = await Investor.find({
      kind: { $in: eligibleKinds },
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

    const [allocations, activeDeeds] = await Promise.all([
      InvestorLoanAllocation.find({ investor_id: investorId }),
      TitleDeed.find({ investor_id: investorId, status: { $in: ["active", "pending"] } }).select("loan_amount"),
    ]);

    const active = allocations.filter((a) => a.status === "active");
    const completed = allocations.filter((a) => a.status === "completed");
    const defaulted = allocations.filter((a) => a.status === "defaulted");

    const pawnDeployedCapital = active.reduce((s, a) => s + a.principal_amount, 0);
    const titleDeedDeployedCapital = activeDeeds.reduce((s, d) => s + d.loan_amount, 0);
    const deployedCapital = pawnDeployedCapital + titleDeedDeployedCapital;

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

  // ─── REFERRAL PARTNERSHIPS ────────────────────────────────────────────────────

  /**
   * A company investor (e.g. Cranbrook) can co-invest on loans whose primary funder
   * is a different investor they introduced to the platform (e.g. Roi Kanner, at a
   * 12% co-investor share vs Roi's 48%, with RTC keeping the remaining 40%). Both
   * sides are already stored as separate InvestorLoanAllocation rows sharing the
   * same loan_no (companyId row has is_co_investor=true) — this just pairs them up
   * and aggregates by primary investor.
   *
   * @param {string} companyInvestorId
   * @param {boolean} includeRtc  — true only for admin callers. RTC's revenue must
   *   never be included in a response served to the company investor themselves.
   */
  async getReferralPartnerships(companyInvestorId, includeRtc = false) {
    const coInvestorAllocs = await InvestorLoanAllocation.find({
      investor_id: companyInvestorId,
      is_co_investor: true,
    }).sort({ allocated_at: -1 });

    if (coInvestorAllocs.length === 0) return [];

    const loanNos = coInvestorAllocs.map((a) => a.loan_no).filter(Boolean);
    const primaryAllocs = await InvestorLoanAllocation.find({
      loan_no: { $in: loanNos },
      investor_id: { $ne: companyInvestorId },
      is_co_investor: false,
    }).populate("investor_id", "name avatar_color kind");

    const primaryByLoanNo = new Map(primaryAllocs.map((a) => [a.loan_no, a]));

    const groups = new Map(); // primaryInvestorId -> { investor, loans: [] }
    for (const coAlloc of coInvestorAllocs) {
      const primary = primaryByLoanNo.get(coAlloc.loan_no);
      if (!primary || !primary.investor_id) continue; // orphaned co-investor row — skip

      const primaryId = primary.investor_id._id.toString();
      if (!groups.has(primaryId)) {
        groups.set(primaryId, { investor: primary.investor_id, loans: [] });
      }

      groups.get(primaryId).loans.push({
        loan_no: coAlloc.loan_no,
        borrower_name: primary.borrower_name || coAlloc.borrower_name || null,
        collateral_description: primary.collateral_description || null,
        principal_amount: primary.principal_amount,
        total_loan_profit: primary.total_loan_profit,
        status: primary.loan_status_override || primary.status,
        company_share_pct: coAlloc.investor_share_pct,
        company_profit: coAlloc.investor_profit,
        primary_investor_share_pct: primary.investor_share_pct,
        primary_investor_profit: primary.investor_profit,
        ...(includeRtc && {
          rtc_share_pct: Math.max(100 - coAlloc.investor_share_pct - primary.investor_share_pct, 0),
          rtc_profit: (primary.rtc_revenue || 0) + (coAlloc.rtc_revenue || 0),
        }),
      });
    }

    return Array.from(groups.values()).map(({ investor, loans }) => {
      const loanCount = loans.length;
      const totalPrincipal = loans.reduce((s, l) => s + l.principal_amount, 0);
      const totalLoanProfit = loans.reduce((s, l) => s + l.total_loan_profit, 0);
      const companyProfit = loans.reduce((s, l) => s + l.company_profit, 0);
      const primaryInvestorProfit = loans.reduce((s, l) => s + l.primary_investor_profit, 0);
      const companySharePct = loans[0]?.company_share_pct ?? 0;
      const primaryInvestorSharePct = loans[0]?.primary_investor_share_pct ?? 0;

      return {
        primary_investor_id: investor._id,
        primary_investor_name: investor.name,
        primary_investor_avatar_color: investor.avatar_color,
        company_share_pct: companySharePct,
        primary_investor_share_pct: primaryInvestorSharePct,
        loan_count: loanCount,
        total_principal: totalPrincipal,
        total_loan_profit: totalLoanProfit,
        company_profit: companyProfit,
        primary_investor_profit: primaryInvestorProfit,
        ...(includeRtc && {
          rtc_share_pct: Math.max(100 - companySharePct - primaryInvestorSharePct, 0),
          rtc_profit: loans.reduce((s, l) => s + (l.rtc_profit || 0), 0),
        }),
        loans,
      };
    });
  }

  // ─── MANUAL ALLOCATIONS ──────────────────────────────────────────────────────

  /**
   * Create one or more manually-entered loan allocations (CSV seeding / admin
   * back-fill). Unlike the SWRR auto-assign path these records may:
   *   - have no corresponding pawn-system Loan (loan_id is optional)
   *   - share the same loan_no across two investors (primary + co-investor)
   *   - carry an explicit loan_status_override instead of reading Loan.status
   *
   * @param {Array} items  — array of allocation descriptor objects
   * @returns {Array}      — per-item { success, allocation?, error?, loan_no }
   */
  async createManualAllocations(items) {
    const results = [];
    for (const item of items) {
      try {
        // Try to find the loan in pawn system by loan_no
        let loanDoc = null;
        if (item.loan_no) {
          loanDoc = await Loan.findOne({ loan_no: item.loan_no });
        }

        const allocData = {
          investor_id: item.investor_id,
          loan_id: loanDoc ? loanDoc._id : undefined,
          loan_no: item.loan_no,
          collateral_category: item.collateral_category || "motor_vehicle",
          loan_period_key: item.loan_period_key || "one_month",
          principal_amount: item.principal_amount || 0,
          total_loan_profit: item.total_interest_receivable || 0,
          investor_share_pct: item.investor_share_pct,
          investor_profit: item.investor_profit,
          rtc_revenue: item.rtc_revenue,
          status: item.alloc_status || "active",
          is_co_investor: item.is_co_investor || false,
          borrower_name: item.borrower_name,
          collateral_description: item.collateral_description,
          loan_date: item.loan_date ? new Date(item.loan_date) : undefined,
          maturity_date: item.maturity_date ? new Date(item.maturity_date) : undefined,
          loan_term_months: item.loan_term_months,
          monthly_interest_rate: item.monthly_interest_rate,
          total_interest_receivable: item.total_interest_receivable || 0,
          loan_status_override: item.loan_status_override || null,
          notes: item.notes,
        };

        const alloc = await InvestorLoanAllocation.create(allocData);
        results.push({ success: true, allocation: alloc, loan_no: item.loan_no });
      } catch (err) {
        results.push({ success: false, error: err.message, loan_no: item.loan_no });
      }
    }
    return results;
  }

  async deleteManualAllocation(allocationId) {
    const allocation = await InvestorLoanAllocation.findByIdAndDelete(allocationId);
    if (!allocation) throw new Error("Allocation not found.");
    return allocation;
  }

  // ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

  /**
   * Compute the full accounting summary for one investor.
   *
   * Accounting rules:
   *   committed_capital         = investor.committed_capital (updated on deposit/capital_withdrawal)
   *   deployed_capital          = sum(principal) of ACTIVE allocations
   *   available_balance         = committed_capital − deployed_capital  (idle capital: never deployed,
   *                                or principal that has already returned from a completed loan —
   *                                sits uninvested until redeployed or withdrawn)
   *   total_realized_profit     = sum(investor_profit) of COMPLETED allocations
   *   total_profit_withdrawn    = sum(amount) of profit_withdrawal transactions
   *   available_profit          = total_realized_profit − total_profit_withdrawn
   *   pending_profit            = sum(investor_profit) of ACTIVE allocations (in-flight, not cash yet)
   *   liquid_cash                = available_balance + available_profit
   *                                the actual cash RTC is holding for this investor right now —
   *                                idle capital plus earned-but-unpaid profit. This is the number
   *                                that answers "how much could I withdraw today?"
   */
  async getTransactionSummary(investorId) {
    const investor = await Investor.findById(investorId);
    if (!investor) return null;

    const [transactions, allocations, monthlyInterestRecords, activeDeeds] = await Promise.all([
      InvestorTransaction.find({ investor_id: investorId }),
      InvestorLoanAllocation.find({ investor_id: investorId }),
      InvestorMonthlyInterest.find({ investor_id: investorId }),
      TitleDeed.find({ investor_id: investorId, status: { $in: ["active", "pending"] } }).select("loan_amount"),
    ]);

    const activeAllocs = allocations.filter((a) => a.status === "active");
    const completedAllocs = allocations.filter((a) => a.status === "completed");

    const totalDeposits = transactions
      .filter((t) => t.type === "deposit")
      .reduce((s, t) => s + t.amount, 0);
    // capital_withdrawal, drawing, and expense all reduce committed_capital the same way
    // (see recordTransaction below) — count all three as "withdrawn", not just
    // capital_withdrawal, or this figure silently diverges from the actual committed_capital.
    const totalCapitalWithdrawn = transactions
      .filter((t) => t.type === "capital_withdrawal" || t.type === "drawing" || t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);
    const totalProfitWithdrawn = transactions
      .filter((t) => t.type === "profit_withdrawal")
      .reduce((s, t) => s + t.amount, 0);

    const pawnDeployedCapital = activeAllocs.reduce((s, a) => s + a.principal_amount, 0);
    const titleDeedDeployedCapital = activeDeeds.reduce((s, d) => s + d.loan_amount, 0);
    const deployedCapital = pawnDeployedCapital + titleDeedDeployedCapital;

    const totalRealizedProfit = completedAllocs.reduce((s, a) => s + a.investor_profit, 0);
    const totalMonthlyInterestEarned = monthlyInterestRecords.reduce((s, r) => s + r.investor_amount, 0);

    // For active allocations, pending profit = projected investor_profit minus monthly interest already received
    const monthlyPaidByAlloc = new Map();
    for (const r of monthlyInterestRecords) {
      const key = r.allocation_id.toString();
      monthlyPaidByAlloc.set(key, (monthlyPaidByAlloc.get(key) || 0) + r.investor_amount);
    }
    const pendingProfit = activeAllocs.reduce((s, a) => {
      const alreadyPaid = monthlyPaidByAlloc.get(a._id.toString()) || 0;
      return s + Math.max(a.investor_profit - alreadyPaid, 0);
    }, 0);

    const committedCapital = investor.committed_capital;
    const availableBalance = Math.max(committedCapital - deployedCapital, 0);
    // Available profit to withdraw includes both completed-loan profits and monthly interest received
    const availableProfitToWithdraw = Math.max(
      totalRealizedProfit + totalMonthlyInterestEarned - totalProfitWithdrawn,
      0,
    );
    // Real cash on hand for this investor: idle capital + earned profit not yet paid out.
    const liquidCash = availableBalance + availableProfitToWithdraw;

    return {
      committed_capital: committedCapital,
      deployed_capital: deployedCapital,
      available_balance: availableBalance,
      total_deposits: totalDeposits,
      total_capital_withdrawn: totalCapitalWithdrawn,
      total_profit_withdrawn: totalProfitWithdrawn,
      total_realized_profit: totalRealizedProfit,
      total_monthly_interest_earned: totalMonthlyInterestEarned,
      available_profit_to_withdraw: availableProfitToWithdraw,
      available_capital_to_withdraw: availableBalance,
      pending_profit: pendingProfit,
      liquid_cash: liquidCash,
    };
  }

  /**
   * Record a deposit, profit withdrawal, or capital withdrawal.
   * Validates available balance before recording. Updates committed_capital atomically.
   */
  async recordTransaction(investorId, { type, amount, notes, recordedById, actorInfo, source, expenseId, expenseCategory }) {
    const investor = await Investor.findById(investorId);
    if (!investor) throw new Error("Investor not found.");

    const validTypes = ["deposit", "profit_withdrawal", "capital_withdrawal", "drawing", "expense"];
    if (!validTypes.includes(type)) throw new Error("Invalid transaction type.");
    if (!amount || amount <= 0) throw new Error("Amount must be greater than zero.");

    const capitalBefore = investor.committed_capital;
    let capitalAfter = capitalBefore;

    if (type === "deposit") {
      capitalAfter = parseFloat((capitalBefore + amount).toFixed(2));
      investor.committed_capital = capitalAfter;
      await investor.save();
    } else if (type === "capital_withdrawal" || type === "drawing" || type === "expense") {
      const [activeAllocs, activeDeeds] = await Promise.all([
        InvestorLoanAllocation.find({ investor_id: investorId, status: "active" }),
        TitleDeed.find({ investor_id: investorId, status: { $in: ["active", "pending"] } }).select("loan_amount"),
      ]);
      const pawnDeployed = activeAllocs.reduce((s, a) => s + a.principal_amount, 0);
      const deedDeployed = activeDeeds.reduce((s, d) => s + d.loan_amount, 0);
      const deployedCapital = pawnDeployed + deedDeployed;
      const availableBalance = capitalBefore - deployedCapital;
      if (amount > availableBalance + 0.01) {
        const actionLabel = type === "expense" ? "expense" : type === "drawing" ? "drawing" : "capital withdrawal";
        throw new Error(
          `Only $${availableBalance.toFixed(2)} is available for this ${actionLabel} ` +
            `(committed: $${capitalBefore.toFixed(2)}, deployed in active loans: $${deployedCapital.toFixed(2)}).`,
        );
      }
      capitalAfter = parseFloat(Math.max(capitalBefore - amount, 0).toFixed(2));
      investor.committed_capital = capitalAfter;
      await investor.save();
    } else if (type === "profit_withdrawal") {
      const [existingWithdrawals, completedAllocs, monthlyRecords] = await Promise.all([
        InvestorTransaction.find({ investor_id: investorId, type: "profit_withdrawal" }),
        InvestorLoanAllocation.find({ investor_id: investorId, status: "completed" }),
        InvestorMonthlyInterest.find({ investor_id: investorId }),
      ]);
      const totalProfitWithdrawn = existingWithdrawals.reduce((s, t) => s + t.amount, 0);
      const totalRealizedProfit = completedAllocs.reduce((s, a) => s + a.investor_profit, 0);
      const totalMonthlyInterestEarned = monthlyRecords.reduce((s, r) => s + r.investor_amount, 0);
      const availableProfit = totalRealizedProfit + totalMonthlyInterestEarned - totalProfitWithdrawn;
      if (amount > availableProfit + 0.01) {
        throw new Error(
          `Only $${availableProfit.toFixed(2)} in realized profit is available ` +
            `(earned: $${(totalRealizedProfit + totalMonthlyInterestEarned).toFixed(2)}, already paid out: $${totalProfitWithdrawn.toFixed(2)}).`,
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
      actor: actorInfo || null,
      source: source || null,
      expense_id: expenseId || null,
      expense_category: expenseCategory || null,
    });

    const populated = await InvestorTransaction.findById(tx._id).populate("recorded_by", "name email");

    // Fire-and-forget confirmation email to investor
    investorEmailService.sendTransactionConfirmationEmail({
      investor,
      transaction: populated,
    }).catch((err) => console.error("[recordTransaction] Email error:", err));

    return { transaction: populated, investor };
  }

  // ─── MONTHLY INTEREST ─────────────────────────────────────────────────────────

  /**
   * Record a monthly interest payment received from a borrower on an active loan.
   * The investor earns their share_pct of the interest immediately — the loan
   * principal remains outstanding and the allocation stays "active".
   */
  async recordMonthlyInterest(allocationId, { borrower_interest_paid, period_month, payment_date, payment_method, notes, recorded_by, actorInfo }) {
    const allocation = await InvestorLoanAllocation.findById(allocationId);
    if (!allocation) throw new Error("Allocation not found.");
    if (allocation.status !== "active") throw new Error("Can only record monthly interest on active allocations.");
    if (!period_month || !/^\d{4}-\d{2}$/.test(period_month)) {
      throw new Error("period_month must be in YYYY-MM format (e.g. 2026-03).");
    }
    if (!borrower_interest_paid || borrower_interest_paid <= 0) {
      throw new Error("borrower_interest_paid must be greater than zero.");
    }

    const investor_amount = parseFloat((borrower_interest_paid * (allocation.investor_share_pct / 100)).toFixed(2));
    const rtc_amount = parseFloat((borrower_interest_paid - investor_amount).toFixed(2));

    const record = await InvestorMonthlyInterest.create({
      investor_id: allocation.investor_id,
      allocation_id: allocation._id,
      loan_id: allocation.loan_id || null,
      loan_no: allocation.loan_no || null,
      period_month,
      borrower_interest_paid: parseFloat(borrower_interest_paid.toFixed(2)),
      investor_share_pct: allocation.investor_share_pct,
      investor_amount,
      rtc_amount,
      payment_date: payment_date ? new Date(payment_date) : new Date(),
      payment_method: payment_method || "cash",
      notes: notes || null,
      recorded_by: recorded_by || null,
      actor: actorInfo || null,
    });

    return record;
  }

  /**
   * Get all monthly interest records for a single allocation (newest month first).
   */
  async getMonthlyInterestForAllocation(allocationId) {
    return InvestorMonthlyInterest.find({ allocation_id: allocationId })
      .sort({ period_month: -1 })
      .populate("recorded_by", "name email");
  }

  // ─── REPAYMENT SCHEDULE (restructured / court-ordered recoveries) ────────────

  /**
   * Replace the full installment plan on an allocation — e.g. a court-ordered
   * settlement paid over several months. Admin sets this up once; individual
   * installments are marked paid via markRepaymentInstallmentPaid as money
   * actually comes in.
   */
  async setRepaymentSchedule(allocationId, installments) {
    const allocation = await InvestorLoanAllocation.findById(allocationId);
    if (!allocation) throw new Error("Allocation not found.");
    if (!Array.isArray(installments) || installments.length === 0) {
      throw new Error("installments must be a non-empty array.");
    }
    allocation.repayment_schedule = installments.map((i) => ({
      label: i.label || null,
      due_date: new Date(i.due_date),
      amount: Number(i.amount),
      status: i.status || "pending",
      paid_date: i.paid_date ? new Date(i.paid_date) : null,
      paid_amount: i.paid_amount != null ? Number(i.paid_amount) : null,
      monthly_interest_id: i.monthly_interest_id || null,
    }));
    await allocation.save();
    return allocation;
  }

  /**
   * Mark one installment in the schedule as paid, and record the matching
   * InvestorMonthlyInterest payment (using the allocation's CURRENT
   * investor_share_pct — fix the split first if it needs correcting) so the
   * payment flows into every existing profit/chart calculation automatically.
   */
  async markRepaymentInstallmentPaid(allocationId, installmentIndex, { paid_date, paid_amount, payment_method, notes, recorded_by, actorInfo }) {
    const allocation = await InvestorLoanAllocation.findById(allocationId);
    if (!allocation) throw new Error("Allocation not found.");
    const installment = allocation.repayment_schedule?.[installmentIndex];
    if (!installment) throw new Error("Installment not found.");
    if (installment.status === "paid") throw new Error("Installment is already marked paid.");

    const amount = paid_amount != null ? Number(paid_amount) : installment.amount;
    const periodMonth = new Date(paid_date || Date.now()).toISOString().slice(0, 7);

    const record = await this.recordMonthlyInterest(allocationId, {
      borrower_interest_paid: amount,
      period_month: periodMonth,
      payment_date: paid_date,
      payment_method,
      notes: notes || `Installment: ${installment.label || `#${installmentIndex + 1}`}`,
      recorded_by,
      actorInfo,
    });

    installment.status = "paid";
    installment.paid_date = paid_date ? new Date(paid_date) : new Date();
    installment.paid_amount = amount;
    installment.monthly_interest_id = record._id;
    await allocation.save();

    return { allocation, record };
  }

  /**
   * Get all monthly interest records for an investor across all their allocations.
   */
  async getMonthlyInterestForInvestor(investorId) {
    return InvestorMonthlyInterest.find({ investor_id: investorId })
      .sort({ created_at: -1 })
      .populate("recorded_by", "name email");
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

  // ─── UNIFIED LEDGER ────────────────────────────────────────────────────────────

  /**
   * One chronological ledger merging every kind of money movement for this investor:
   *   - capital transactions (deposit, capital_withdrawal, profit_withdrawal, drawing, expense)
   *   - loan fundings (capital going OUT into a loan)
   *   - loan repayments (principal coming back IN when a loan completes)
   *   - loan profit realized at completion (lump sum, IN)
   *   - monthly interest received on a loan that's still active (IN)
   *
   * This is the source for the investor-facing "Account Ledger" table — a single
   * bank-statement-style view instead of three separately-fetched, differently-shaped lists.
   */
  async getInvestorLedger(investorId) {
    const [transactions, allocations, monthlyInterestRecords] = await Promise.all([
      InvestorTransaction.find({ investor_id: investorId }).populate("recorded_by", "name email"),
      InvestorLoanAllocation.find({ investor_id: investorId }),
      InvestorMonthlyInterest.find({ investor_id: investorId }),
    ]);

    const entries = [];

    for (const t of transactions) {
      const direction = t.type === "deposit" ? "in" : "out";
      entries.push({
        date: t.created_at,
        type: t.type,
        label: t.notes || null,
        amount: t.amount,
        direction,
        recorded_by: t.recorded_by ? { name: t.recorded_by.name, email: t.recorded_by.email } : null,
      });
    }

    for (const a of allocations) {
      const loanLabel = a.borrower_name ? `${a.loan_no || "Loan"} — ${a.borrower_name}` : (a.loan_no || "Loan");
      // completed_at is sometimes missing on manually-seeded/imported allocations even
      // though status is already "completed" — fall back through other loan dates rather
      // than silently dropping the entry (and the real profit it represents) from the ledger.
      const completionDate = a.completed_at || a.maturity_date || a.loan_date || a.allocated_at;

      // Co-investor rows (e.g. Cranbrook's 12% referral cut on a Roi Kanner loan) carry
      // the FULL loan principal for allocation/eligibility purposes, but that principal was
      // never this investor's own money — the primary funder (Roi) put it up and gets it
      // back. Only the primary funder's row should show loan_funded/loan_repaid; the
      // co-investor only ever sees their profit share, never the principal.
      if (!a.is_co_investor && a.principal_amount > 0) {
        entries.push({
          date: a.loan_date || a.allocated_at,
          type: "loan_funded",
          label: loanLabel,
          amount: a.principal_amount,
          direction: "out",
          loan_no: a.loan_no || null,
        });
        if (a.status === "completed") {
          entries.push({
            date: completionDate,
            type: "loan_repaid",
            label: loanLabel,
            amount: a.principal_amount,
            direction: "in",
            loan_no: a.loan_no || null,
          });
        }
      }
      if (a.status === "completed" && a.investor_profit > 0) {
        entries.push({
          date: completionDate,
          type: "loan_profit",
          label: a.is_co_investor ? `${loanLabel} — referral interest (${a.investor_share_pct}% co-investor share)` : loanLabel,
          amount: a.investor_profit,
          direction: "in",
          loan_no: a.loan_no || null,
        });
      }
    }

    const coInvestorAllocationIds = new Set(
      allocations.filter((a) => a.is_co_investor).map((a) => a._id.toString()),
    );
    for (const r of monthlyInterestRecords) {
      const isReferral = coInvestorAllocationIds.has(r.allocation_id.toString());
      const base = r.loan_no ? `${r.loan_no} (${r.period_month})` : `${r.period_month}`;
      entries.push({
        date: r.payment_date,
        type: "interest_earned",
        label: isReferral ? `${base} — referral interest (${r.investor_share_pct}% co-investor share)` : `Monthly interest — ${base}`,
        amount: r.investor_amount,
        direction: "in",
        loan_no: r.loan_no || null,
      });
    }

    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    return entries;
  }

  /**
   * Best-effort projection of profit expected THIS calendar month:
   *   - loans with a multi-month term (loan_term_months > 1) contribute their monthly
   *     installment rate (investor_profit / loan_term_months) — a recurring cash flow,
   *     regardless of exactly which day it lands
   *   - single-term loans maturing this calendar month contribute their full remaining
   *     (not-yet-received) profit
   */
  async getExpectedMonthlyIncome(investorId) {
    const [allocations, monthlyInterestRecords] = await Promise.all([
      InvestorLoanAllocation.find({ investor_id: investorId, status: "active" }),
      InvestorMonthlyInterest.find({ investor_id: investorId }),
    ]);

    const alreadyPaidByAlloc = new Map();
    for (const r of monthlyInterestRecords) {
      const key = r.allocation_id.toString();
      alreadyPaidByAlloc.set(key, (alreadyPaidByAlloc.get(key) || 0) + r.investor_amount);
    }

    const now = new Date();
    let expected = 0;
    for (const a of allocations) {
      if (a.loan_term_months && a.loan_term_months > 1) {
        expected += (a.investor_profit || 0) / a.loan_term_months;
      } else if (a.maturity_date) {
        const m = new Date(a.maturity_date);
        if (m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth()) {
          const alreadyPaid = alreadyPaidByAlloc.get(a._id.toString()) || 0;
          expected += Math.max((a.investor_profit || 0) - alreadyPaid, 0);
        }
      }
    }
    return parseFloat(expected.toFixed(2));
  }
}

module.exports = new InvestorAllocationService();
