"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Investor = require("../../models/investor/investor.model");
const InvestorProfitSplit = require("../../models/investor/investor_profit_split.model");
const investorAllocationService = require("../../services/investor_allocation_service");

const AVATAR_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#14b8a6"];
const VALID_LOAN_TYPES = ["small_loans", "motor_vehicle", "jewellery"];
const VALID_LOAN_TERMS = ["two_week", "one_month"];

const parseLoanTypePreferences = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: VALID_LOAN_TYPES.slice() };
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "loan_type_preferences must be a non-empty array." };
  }
  const invalid = raw.filter((t) => !VALID_LOAN_TYPES.includes(t));
  if (invalid.length > 0) {
    return { ok: false, message: `Invalid loan type(s): ${invalid.join(", ")}. Valid values: ${VALID_LOAN_TYPES.join(", ")}.` };
  }
  return { ok: true, value: raw };
};

const parseLoanTermPreferences = (raw) => {
  if (raw === undefined || raw === null) return { ok: true, value: VALID_LOAN_TERMS.slice() };
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "loan_term_preferences must be a non-empty array." };
  }
  const invalid = raw.filter((t) => !VALID_LOAN_TERMS.includes(t));
  if (invalid.length > 0) {
    return { ok: false, message: `Invalid loan term(s): ${invalid.join(", ")}. Valid values: ${VALID_LOAN_TERMS.join(", ")}.` };
  }
  return { ok: true, value: raw };
};
const DEFAULT_PROFIT_SPLIT = {
  two_week: { borrower_rate: 20, investor_share: 60, label: "2-Week Loan", days: 14 },
  one_month: { borrower_rate: 30, investor_share: 65, label: "1-Month Loan", days: 30 },
};

const generateToken = (investor) => {
  return jwt.sign(
    {
      investorId: investor._id,
      email: investor.email,
      kind: investor.kind,
      name: investor.name,
    },
    process.env.INVESTOR_JWT_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.INVESTOR_JWT_EXPIRES_IN || "7d" },
  );
};

const hashPassword = async (plain) => bcrypt.hash(plain, 10);
const comparePassword = async (plain, hash) => bcrypt.compare(plain, hash);

const pickRandomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

const safeInvestor = (doc) => {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.password_hash;
  delete obj.reset_password_otp;
  delete obj.reset_password_expires_at;
  return obj;
};

class InvestorController {
  // ─── AUTH ──────────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/investors/auth/login
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
      }

      const investor = await Investor.findOne({ email: email.trim().toLowerCase() }).select("+password_hash");
      if (!investor) {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }
      if (investor.status === "deleted") {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }
      if (investor.status === "suspended") {
        return res.status(403).json({ success: false, message: "Account is suspended. Contact support." });
      }

      const valid = await comparePassword(password, investor.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }

      const token = generateToken(investor);

      return res.json({
        success: true,
        message: "Login successful.",
        data: { investor: safeInvestor(investor), token },
      });
    } catch (error) {
      console.error("InvestorController.login:", error);
      return res.status(500).json({ success: false, message: "Login failed." });
    }
  }

  // ─── INVESTOR CRUD ─────────────────────────────────────────────────────────

  /**
   * POST /api/v1/investors
   * Admin creates an individual investor or a company investor account.
   */
  async createInvestor(req, res) {
    try {
      const { kind, name, email, password, phone, location, committed_capital, profit_share_override, loan_type_preferences, loan_term_preferences, title, notes } =
        req.body;

      if (!kind || !["individual", "company"].includes(kind)) {
        return res.status(400).json({ success: false, message: "kind must be 'individual' or 'company'." });
      }
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "name is required." });
      }
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ success: false, message: "A valid email address is required." });
      }
      if (!password || password.trim().length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }
      if (!committed_capital || Number(committed_capital) <= 0) {
        return res.status(400).json({ success: false, message: "committed_capital must be greater than 0." });
      }

      const loanTypeParsed = parseLoanTypePreferences(loan_type_preferences);
      if (!loanTypeParsed.ok) {
        return res.status(400).json({ success: false, message: loanTypeParsed.message });
      }

      const loanTermParsed = parseLoanTermPreferences(loan_term_preferences);
      if (!loanTermParsed.ok) {
        return res.status(400).json({ success: false, message: loanTermParsed.message });
      }

      const existing = await Investor.findOne({ email: email.trim().toLowerCase() });
      if (existing) {
        return res.status(409).json({ success: false, message: "An investor with this email already exists." });
      }

      const password_hash = await hashPassword(password.trim());

      const investor = await Investor.create({
        kind,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password_hash,
        avatar_color: pickRandomColor(),
        status: "active",
        phone: phone ? phone.trim() : undefined,
        location: location ? location.trim() : undefined,
        committed_capital: Number(committed_capital),
        profit_share_override: profit_share_override || null,
        loan_type_preferences: loanTypeParsed.value,
        loan_term_preferences: loanTermParsed.value,
        title: title ? title.trim() : undefined,
        notes: notes ? notes.trim() : undefined,
        added_by: req.investor._id,
        onboarded_by_actor: req.actorInfo || null,
      });

      return res.status(201).json({
        success: true,
        message: `${kind === "company" ? "Company" : "Investor"} account created successfully.`,
        data: { investor: safeInvestor(investor) },
      });
    } catch (error) {
      console.error("InvestorController.createInvestor:", error);
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "An investor with this email already exists." });
      }
      return res.status(500).json({ success: false, message: "Failed to create investor." });
    }
  }

  /**
   * POST /api/v1/investors/companies/:companyId/clients
   * Admin adds a client under an existing company investor account.
   */
  async addCompanyClient(req, res) {
    try {
      const { companyId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: "Invalid companyId." });
      }

      const company = await Investor.findOne({ _id: companyId, kind: "company", status: { $ne: "deleted" } });
      if (!company) {
        return res.status(404).json({ success: false, message: "Company investor account not found." });
      }

      const { name, email, password, phone, location, committed_capital, profit_share_override, loan_type_preferences, loan_term_preferences, notes } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: "name is required." });
      }
      if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ success: false, message: "A valid email address is required." });
      }
      if (!password || password.trim().length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }
      if (!committed_capital || Number(committed_capital) <= 0) {
        return res.status(400).json({ success: false, message: "committed_capital must be greater than 0." });
      }

      const loanTypeParsed = parseLoanTypePreferences(loan_type_preferences);
      if (!loanTypeParsed.ok) {
        return res.status(400).json({ success: false, message: loanTypeParsed.message });
      }

      const loanTermParsed = parseLoanTermPreferences(loan_term_preferences);
      if (!loanTermParsed.ok) {
        return res.status(400).json({ success: false, message: loanTermParsed.message });
      }

      const existing = await Investor.findOne({ email: email.trim().toLowerCase() });
      if (existing) {
        return res.status(409).json({ success: false, message: "An investor with this email already exists." });
      }

      const password_hash = await hashPassword(password.trim());

      const client = await Investor.create({
        kind: "company_client",
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password_hash,
        avatar_color: pickRandomColor(),
        status: "active",
        phone: phone ? phone.trim() : undefined,
        location: location ? location.trim() : undefined,
        committed_capital: Number(committed_capital),
        parent_company_id: company._id,
        profit_share_override: profit_share_override || null,
        loan_type_preferences: loanTypeParsed.value,
        loan_term_preferences: loanTermParsed.value,
        notes: notes ? notes.trim() : undefined,
        added_by: req.investor._id,
        onboarded_by_actor: req.actorInfo || null,
      });

      return res.status(201).json({
        success: true,
        message: "Company client account created successfully.",
        data: { investor: safeInvestor(client) },
      });
    } catch (error) {
      console.error("InvestorController.addCompanyClient:", error);
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "An investor with this email already exists." });
      }
      return res.status(500).json({ success: false, message: "Failed to create company client." });
    }
  }

  /**
   * GET /api/v1/investors
   * Admin lists all investors with optional kind filter and search.
   * Query: ?kind=individual|company|company_client&search=<text>&status=active&page=1&limit=20
   */
  async listInvestors(req, res) {
    try {
      const { kind, search, status, page = 1, limit = 20 } = req.query;

      const filter = { kind: { $ne: "admin" } };

      if (kind && ["individual", "company", "company_client"].includes(kind)) {
        filter.kind = kind;
      }
      if (status && ["active", "pending", "suspended", "deleted"].includes(status)) {
        filter.status = status;
      } else {
        filter.status = { $ne: "deleted" };
      }
      if (search && search.trim()) {
        const q = search.trim();
        filter.$or = [
          { name: { $regex: q, $options: "i" } },
          { email: { $regex: q, $options: "i" } },
          { phone: { $regex: q, $options: "i" } },
          { location: { $regex: q, $options: "i" } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [investors, total] = await Promise.all([
        Investor.find(filter).sort({ committed_capital: -1, created_at: -1 }).skip(skip).limit(Number(limit)),
        Investor.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        data: {
          investors: investors.map(safeInvestor),
          pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
        },
      });
    } catch (error) {
      console.error("InvestorController.listInvestors:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch investors." });
    }
  }

  /**
   * GET /api/v1/investors/:id
   * Admin or the investor themselves.
   */
  async getInvestor(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const investor = await Investor.findOne({ _id: id, status: { $ne: "deleted" } });
      if (!investor) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }

      return res.json({ success: true, data: { investor: safeInvestor(investor) } });
    } catch (error) {
      console.error("InvestorController.getInvestor:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch investor." });
    }
  }

  /**
   * PUT /api/v1/investors/:id
   * Admin or the investor themselves. Admins can also update status and notes.
   */
  async updateInvestor(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const investor = await Investor.findOne({ _id: id, status: { $ne: "deleted" } });
      if (!investor) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }

      const isAdmin = req.investor.kind === "admin";
      const isSelf = req.investor._id.toString() === id;

      const { name, phone, location, password, avatar_color, committed_capital, status, notes, loan_type_preferences, loan_term_preferences } = req.body;

      if (name !== undefined) investor.name = name.trim();
      if (phone !== undefined) investor.phone = phone.trim();
      if (location !== undefined) investor.location = location.trim();
      if (avatar_color !== undefined) investor.avatar_color = avatar_color.trim();

      if (password) {
        if (password.trim().length < 6) {
          return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
        }
        investor.password_hash = await hashPassword(password.trim());
      }

      // Admin-only fields
      if (isAdmin) {
        if (committed_capital !== undefined) {
          if (Number(committed_capital) < 0) {
            return res.status(400).json({ success: false, message: "committed_capital cannot be negative." });
          }
          investor.committed_capital = Number(committed_capital);
        }
        if (status && ["active", "pending", "suspended"].includes(status)) {
          investor.status = status;
        }
        if (notes !== undefined) investor.notes = notes.trim();
        if (loan_type_preferences !== undefined) {
          const parsed = parseLoanTypePreferences(loan_type_preferences);
          if (!parsed.ok) {
            return res.status(400).json({ success: false, message: parsed.message });
          }
          investor.loan_type_preferences = parsed.value;
        }
        if (loan_term_preferences !== undefined) {
          const parsed = parseLoanTermPreferences(loan_term_preferences);
          if (!parsed.ok) {
            return res.status(400).json({ success: false, message: parsed.message });
          }
          investor.loan_term_preferences = parsed.value;
        }
      }

      await investor.save();

      return res.json({
        success: true,
        message: "Investor profile updated.",
        data: { investor: safeInvestor(investor) },
      });
    } catch (error) {
      console.error("InvestorController.updateInvestor:", error);
      return res.status(500).json({ success: false, message: "Failed to update investor." });
    }
  }

  /**
   * PUT /api/v1/investors/:id/profit-share
   * Admin updates the per-investor negotiated profit-share override.
   * Send null to clear the override and fall back to the platform default.
   */
  async updateProfitShare(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const investor = await Investor.findOne({ _id: id, status: { $ne: "deleted" } });
      if (!investor) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }

      const { profit_share_override } = req.body;

      if (profit_share_override === null || profit_share_override === undefined) {
        investor.profit_share_override = null;
      } else {
        const { two_week, one_month } = profit_share_override;
        if (two_week !== undefined && (two_week < 0 || two_week > 100)) {
          return res.status(400).json({ success: false, message: "two_week must be between 0 and 100." });
        }
        if (one_month !== undefined && (one_month < 0 || one_month > 100)) {
          return res.status(400).json({ success: false, message: "one_month must be between 0 and 100." });
        }
        investor.profit_share_override = { two_week, one_month };
      }

      await investor.save();

      return res.json({
        success: true,
        message: "Profit share override updated.",
        data: { investor: safeInvestor(investor) },
      });
    } catch (error) {
      console.error("InvestorController.updateProfitShare:", error);
      return res.status(500).json({ success: false, message: "Failed to update profit share." });
    }
  }

  /**
   * DELETE /api/v1/investors/:id
   * Soft-deletes an investor. Admin only.
   */
  async deleteInvestor(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      // Prevent admin from deleting themselves
      if (req.investor._id.toString() === id) {
        return res.status(400).json({ success: false, message: "You cannot delete your own account." });
      }

      const investor = await Investor.findOne({ _id: id, status: { $ne: "deleted" } });
      if (!investor) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }

      investor.status = "deleted";
      await investor.save();

      return res.json({ success: true, message: "Investor account deleted.", data: { id } });
    } catch (error) {
      console.error("InvestorController.deleteInvestor:", error);
      return res.status(500).json({ success: false, message: "Failed to delete investor." });
    }
  }

  // ─── COMPANY CLIENTS ───────────────────────────────────────────────────────

  /**
   * GET /api/v1/investors/companies/:companyId/clients
   */
  async listCompanyClients(req, res) {
    try {
      const { companyId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({ success: false, message: "Invalid companyId." });
      }

      const company = await Investor.findOne({ _id: companyId, kind: "company", status: { $ne: "deleted" } });
      if (!company) {
        return res.status(404).json({ success: false, message: "Company investor account not found." });
      }

      const clients = await Investor.find({
        parent_company_id: companyId,
        status: { $ne: "deleted" },
      }).sort({ created_at: -1 });

      return res.json({
        success: true,
        data: { company: safeInvestor(company), clients: clients.map(safeInvestor) },
      });
    } catch (error) {
      console.error("InvestorController.listCompanyClients:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch company clients." });
    }
  }

  // ─── PROFIT SPLIT CONFIG ───────────────────────────────────────────────────

  /**
   * GET /api/v1/investors/profit-split
   * Returns the platform-wide profit split config (or defaults if not seeded yet).
   */
  async getProfitSplit(req, res) {
    try {
      let config = await InvestorProfitSplit.findOne();
      if (!config) {
        config = await InvestorProfitSplit.create({ ...DEFAULT_PROFIT_SPLIT });
      }
      return res.json({ success: true, data: { profit_split: config } });
    } catch (error) {
      console.error("InvestorController.getProfitSplit:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch profit split config." });
    }
  }

  /**
   * PUT /api/v1/investors/profit-split
   * Admin updates platform-wide profit split config.
   * Body: { two_week?: { borrower_rate, investor_share }, one_month?: { borrower_rate, investor_share } }
   */
  async updateProfitSplit(req, res) {
    try {
      const { two_week, one_month } = req.body;

      let config = await InvestorProfitSplit.findOne();
      if (!config) {
        config = await InvestorProfitSplit.create({ ...DEFAULT_PROFIT_SPLIT });
      }

      if (two_week) {
        if (two_week.borrower_rate !== undefined) config.two_week.borrower_rate = Number(two_week.borrower_rate);
        if (two_week.investor_share !== undefined) config.two_week.investor_share = Number(two_week.investor_share);
        if (two_week.label) config.two_week.label = two_week.label.trim();
      }
      if (one_month) {
        if (one_month.borrower_rate !== undefined) config.one_month.borrower_rate = Number(one_month.borrower_rate);
        if (one_month.investor_share !== undefined) config.one_month.investor_share = Number(one_month.investor_share);
        if (one_month.label) config.one_month.label = one_month.label.trim();
      }

      config.markModified("two_week");
      config.markModified("one_month");
      await config.save();

      return res.json({
        success: true,
        message: "Profit split config updated.",
        data: { profit_split: config },
      });
    } catch (error) {
      console.error("InvestorController.updateProfitSplit:", error);
      return res.status(500).json({ success: false, message: "Failed to update profit split config." });
    }
  }

  // ─── INVESTOR PORTAL ADMIN BOOTSTRAP ──────────────────────────────────────

  /**
   * POST /api/v1/investors/auth/seed-admin
   * One-time setup: creates the investor portal admin account.
   * Only works if no admin account exists yet.
   */
  async seedAdmin(req, res) {
    try {
      const existingAdmin = await Investor.findOne({ kind: "admin" });
      if (existingAdmin) {
        return res.status(409).json({ success: false, message: "Admin account already exists." });
      }

      const { name, email, password, title } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: "name, email, and password are required." });
      }
      if (password.length < 8) {
        return res.status(400).json({ success: false, message: "Admin password must be at least 8 characters." });
      }

      const password_hash = await hashPassword(password);
      const admin = await Investor.create({
        kind: "admin",
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password_hash,
        avatar_color: "#10b981",
        status: "active",
        committed_capital: 0,
        title: title ? title.trim() : "Investment Manager",
      });

      const token = generateToken(admin);

      return res.status(201).json({
        success: true,
        message: "Investor portal admin created.",
        data: { investor: safeInvestor(admin), token },
      });
    } catch (error) {
      console.error("InvestorController.seedAdmin:", error);
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "An account with this email already exists." });
      }
      return res.status(500).json({ success: false, message: "Failed to create admin." });
    }
  }

  // ─── LOAN ALLOCATIONS ─────────────────────────────────────────────────────────

  /**
   * GET /api/v1/investors/:id/loan-allocations
   * Admin or the investor themselves. Returns full loan + borrower + asset data.
   */
  async getInvestorAllocations(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const { page = 1, limit = 50, status } = req.query;
      const result = await investorAllocationService.getInvestorAllocations(id, { page, limit, status });

      // Shape each allocation for the frontend
      const deployments = result.allocations.map((alloc) => {
        const loan = alloc.loan_id;
        const borrower = loan?.customer_user;
        const asset = loan?.asset;

        // Map loan period type to term key
        const rawPeriod = loan?.loan_period_type || "";
        const termKey = rawPeriod === "two_weeks" ? "two_week" : "one_month";

        // Derive display status for the frontend
        const loanStatus = loan?.status || "active";
        let deploymentStatus = "active";
        if (["redeemed", "defaulted", "written_off", "rolled_over"].includes(loanStatus)) {
          deploymentStatus = "completed";
        } else if (["draft", "pending_approval", "approved"].includes(loanStatus)) {
          deploymentStatus = "expected";
        }

        return {
          id: alloc._id.toString(),
          loanRef: alloc.loan_no || loan?.loan_no || "—",
          termKey,
          principal: alloc.principal_amount,
          borrowerName: borrower
            ? `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim()
            : "Unknown",
          borrowerPhone: borrower?.phone || null,
          borrowerNationalId: borrower?.national_id_number || null,
          borrowerAddress: borrower?.address || null,
          nationalIdImageUrl: borrower?.national_id_image_url || null,
          collateralTitle: asset?.title || null,
          collateralImages: asset?.asset_images || [],
          collateralCategory: alloc.collateral_category || loan?.collateral_category || null,
          startDate: loan?.start_date
            ? new Date(loan.start_date).toISOString().slice(0, 10)
            : new Date(alloc.allocated_at).toISOString().slice(0, 10),
          endDate: loan?.due_date
            ? new Date(loan.due_date).toISOString().slice(0, 10)
            : null,
          status: deploymentStatus,
          loanStatus,
          investorSharePct: alloc.investor_share_pct,
          investorProfit: alloc.investor_profit,
          totalLoanProfit: alloc.total_loan_profit,
          rtcRevenue: alloc.rtc_revenue,
          allocationId: alloc._id.toString(),
          allocationStatus: alloc.status,
        };
      });

      return res.json({
        success: true,
        data: { deployments, pagination: { total: result.total, page: result.page, limit: result.limit, pages: result.pages } },
      });
    } catch (error) {
      console.error("InvestorController.getInvestorAllocations:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch allocations." });
    }
  }

  /**
   * GET /api/v1/investors/:id/portfolio-stats
   * Aggregate portfolio stats for an investor.
   */
  async getInvestorPortfolioStats(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const stats = await investorAllocationService.getInvestorStats(id);
      if (!stats) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }

      return res.json({ success: true, data: { stats } });
    } catch (error) {
      console.error("InvestorController.getInvestorPortfolioStats:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch portfolio stats." });
    }
  }

  /**
   * GET /api/v1/investors/:id/growth-history
   * Monthly portfolio value time-series for charts.
   */
  async getInvestorGrowthHistory(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const growthHistory = await investorAllocationService.getInvestorGrowthHistory(id);
      return res.json({ success: true, data: { growth_history: growthHistory } });
    } catch (error) {
      console.error("InvestorController.getInvestorGrowthHistory:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch growth history." });
    }
  }

  /**
   * GET /api/v1/investors/admin/stats
   * Platform-wide aggregate stats (admin only).
   */
  async getAdminStats(req, res) {
    try {
      const stats = await investorAllocationService.getAdminStats();
      return res.json({ success: true, data: { stats } });
    } catch (error) {
      console.error("InvestorController.getAdminStats:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch admin stats." });
    }
  }

  /**
   * GET /api/v1/investors/admin/loan-allocations
   * All loan allocations across all investors (admin loans ledger).
   */
  async getAdminAllAllocations(req, res) {
    try {
      const { page = 1, limit = 50, status, investor_id } = req.query;
      const result = await investorAllocationService.getAllAllocations({
        page, limit, status, investorId: investor_id,
      });

      const rows = result.allocations.map((alloc) => {
        const loan = alloc.loan_id;
        const borrower = loan?.customer_user;
        const asset = loan?.asset;
        const investor = alloc.investor_id;
        const rawPeriod = loan?.loan_period_type || "";
        const termKey = rawPeriod === "two_weeks" ? "two_week" : "one_month";

        let deploymentStatus = "active";
        const loanStatus = loan?.status || "active";
        if (["redeemed", "defaulted", "written_off", "rolled_over"].includes(loanStatus)) {
          deploymentStatus = "completed";
        } else if (["draft", "pending_approval", "approved"].includes(loanStatus)) {
          deploymentStatus = "expected";
        }

        return {
          id: alloc._id.toString(),
          loanRef: alloc.loan_no || loan?.loan_no || "—",
          termKey,
          principal: alloc.principal_amount,
          borrowerName: borrower
            ? `${borrower.first_name || ""} ${borrower.last_name || ""}`.trim()
            : "Unknown",
          borrowerNationalId: borrower?.national_id_number || null,
          borrowerPhone: borrower?.phone || null,
          collateralTitle: asset?.title || null,
          collateralImages: asset?.asset_images || [],
          startDate: loan?.start_date
            ? new Date(loan.start_date).toISOString().slice(0, 10)
            : new Date(alloc.allocated_at).toISOString().slice(0, 10),
          endDate: loan?.due_date
            ? new Date(loan.due_date).toISOString().slice(0, 10)
            : null,
          status: deploymentStatus,
          loanStatus,
          investorSharePct: alloc.investor_share_pct,
          investorProfit: alloc.investor_profit,
          totalLoanProfit: alloc.total_loan_profit,
          rtcRevenue: alloc.rtc_revenue,
          allocationId: alloc._id.toString(),
          allocationStatus: alloc.status,
          investorId: investor?._id?.toString(),
          investorName: investor?.name,
          investorKind: investor?.kind,
          investorAvatarColor: investor?.avatar_color,
        };
      });

      return res.json({
        success: true,
        data: { deployments: rows, pagination: { total: result.total, page: result.page, limit: result.limit, pages: result.pages } },
      });
    } catch (error) {
      console.error("InvestorController.getAdminAllAllocations:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch loan allocations." });
    }
  }

  /**
   * POST /api/v1/investors/admin/assign-loan/:loanId
   * Manually trigger SWRR assignment for a loan (admin only).
   * Useful for existing loans that were active before this feature was deployed.
   */
  async triggerLoanAssignment(req, res) {
    try {
      const { loanId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(loanId)) {
        return res.status(400).json({ success: false, message: "Invalid loan ID." });
      }

      const result = await investorAllocationService.assignLoan(loanId);

      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }

      return res.json({
        success: true,
        message: `Loan assigned to ${result.investor.name}.`,
        data: { allocation: result.allocation, investor: safeInvestor(result.investor) },
      });
    } catch (error) {
      console.error("InvestorController.triggerLoanAssignment:", error);
      return res.status(500).json({ success: false, message: "Failed to assign loan." });
    }
  }

  // ─── RTC ACCOUNT ──────────────────────────────────────────────────────────────

  // ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/investors/:id/transaction-summary
   * Accounting summary: committed capital, available balances, profit breakdown.
   * Admin or the investor themselves.
   */
  async getTransactionSummary(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }
      const summary = await investorAllocationService.getTransactionSummary(id);
      if (!summary) {
        return res.status(404).json({ success: false, message: "Investor not found." });
      }
      return res.json({ success: true, data: { summary } });
    } catch (error) {
      console.error("InvestorController.getTransactionSummary:", error);
      return res.status(500).json({ success: false, message: "Failed to compute transaction summary." });
    }
  }

  /**
   * GET /api/v1/investors/:id/transactions
   * Transaction history (newest first). Admin or self.
   */
  async getTransactions(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }
      const { page, limit } = req.query;
      const result = await investorAllocationService.getTransactions(id, { page, limit });
      return res.json({
        success: true,
        data: {
          transactions: result.transactions.map((t) => ({
            id: t._id,
            type: t.type,
            amount: t.amount,
            notes: t.notes,
            recorded_by: t.recorded_by
              ? { name: t.recorded_by.name, email: t.recorded_by.email }
              : null,
            committed_capital_before: t.committed_capital_before,
            committed_capital_after: t.committed_capital_after,
            created_at: t.created_at,
          })),
          total: result.total,
        },
      });
    } catch (error) {
      console.error("InvestorController.getTransactions:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch transactions." });
    }
  }

  /**
   * POST /api/v1/investors/:id/transactions
   * Admin records a deposit, profit withdrawal, or capital withdrawal.
   * Body: { type, amount, notes? }
   */
  async recordTransaction(req, res) {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid investor ID." });
      }

      const { type, amount, notes } = req.body;
      if (!type) {
        return res.status(400).json({ success: false, message: "type is required." });
      }
      const parsedAmount = parseFloat(amount);
      if (!parsedAmount || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: "amount must be a positive number." });
      }

      const result = await investorAllocationService.recordTransaction(id, {
        type,
        amount: parsedAmount,
        notes,
        recordedById: req.investor._id,
        actorInfo: req.actorInfo || null,
      });

      return res.status(201).json({
        success: true,
        message: `Transaction recorded: ${type} of $${parsedAmount.toFixed(2)}.`,
        data: {
          transaction: {
            id: result.transaction._id,
            type: result.transaction.type,
            amount: result.transaction.amount,
            notes: result.transaction.notes,
            recorded_by: result.transaction.recorded_by
              ? { name: result.transaction.recorded_by.name, email: result.transaction.recorded_by.email }
              : null,
            committed_capital_before: result.transaction.committed_capital_before,
            committed_capital_after: result.transaction.committed_capital_after,
            created_at: result.transaction.created_at,
          },
          investor: safeInvestor(result.investor),
        },
      });
    } catch (error) {
      console.error("InvestorController.recordTransaction:", error);
      if (error.message && !error.message.includes("InvestorController")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      return res.status(500).json({ success: false, message: "Failed to record transaction." });
    }
  }

  // ─── RTC ACCOUNT ──────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/investors/admin/rtc-account
   * Returns (or auto-creates) the RTC internal investor account.
   */
  async getRtcAccount(req, res) {
    try {
      const account = await investorAllocationService.getRtcAccount();
      return res.json({
        success: true,
        data: { investor: safeInvestor(account) },
      });
    } catch (error) {
      console.error("InvestorController.getRtcAccount:", error);
      return res.status(500).json({ success: false, message: "Failed to retrieve RTC account." });
    }
  }

  /**
   * PATCH /api/v1/investors/admin/rtc-account/capital
   * Set the amount of capital RTC has committed as an investor.
   * Body: { committed_capital: number }
   */
  async updateRtcCapital(req, res) {
    try {
      const { committed_capital } = req.body;
      if (committed_capital === undefined || Number.isNaN(Number(committed_capital)) || Number(committed_capital) < 0) {
        return res.status(400).json({ success: false, message: "committed_capital must be a number >= 0." });
      }
      const account = await investorAllocationService.updateRtcCapital(Number(committed_capital));
      return res.json({
        success: true,
        message: "RTC committed capital updated.",
        data: { investor: safeInvestor(account) },
      });
    } catch (error) {
      console.error("InvestorController.updateRtcCapital:", error);
      return res.status(500).json({ success: false, message: "Failed to update RTC capital." });
    }
  }
}

module.exports = new InvestorController();
