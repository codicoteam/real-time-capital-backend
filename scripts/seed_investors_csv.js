"use strict";

/**
 * Seed script: ROI, Cranbrook, Mucheke investor portfolio (CSV data – Aug 2026).
 *
 * What it does:
 *   1. Looks up (or creates) the ROI, Cranbrook, Mucheke investor accounts.
 *   2. Creates their capital deposit transaction records if missing.
 *   3. Creates InvestorLoanAllocation records for every loan in the CSV tables.
 *      - ROI-funded loans  → one allocation for ROI (48%) + one co-investor alloc for Cranbrook (12%)
 *      - Cranbrook own     → one allocation for Cranbrook (60%)
 *      - Mucheke loans     → one allocation for Mucheke (60%)
 *   4. Creates TitleDeed records for TD1/110226/T (Cranbrook) and TD1/300726/T (Mucheke).
 *
 * The script is idempotent — it checks for existing records before inserting.
 *
 * Run from the backend root:
 *   node scripts/seed_investors_csv.js
 *
 * IMPORTANT: Before running for the first time on an existing database, drop the
 * old unique index on loan_id if it still exists:
 *   db.investorloanallocations.dropIndex("loan_id_1")
 */

require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const Investor = require("../models/investor/investor.model");
const InvestorLoanAllocation = require("../models/investor/investor_loan_allocation.model");
const InvestorTransaction = require("../models/investor/investor_transaction.model");
const TitleDeed = require("../models/investor/title_deed.model");

// ─── Investor definitions ────────────────────────────────────────────────────

const INVESTORS = [
  {
    key: "roi",
    name: "ROI",
    email: "roi@rtcapital.co.zw",
    kind: "individual",
    committed_capital: 50350,
    title: "ROI Capital",
    deposits: [
      // Multiple tranches in 2026 totalling $50,350
      { amount: 50350, notes: "Opening capital – ROI (multiple tranches 2026, seeded)" },
    ],
  },
  {
    key: "cranbrook",
    name: "Cranbrook",
    email: "cranbrook@rtcapital.co.zw",
    kind: "company",
    committed_capital: 54816,
    title: "Cranbrook Capital",
    deposits: [
      { amount: 54816, notes: "Opening capital – Cranbrook (multiple tranches 2026, seeded)" },
    ],
  },
  {
    key: "mucheke",
    name: "Mucheke",
    email: "mucheke@rtcapital.co.zw",
    kind: "individual",
    committed_capital: 30000,
    title: "Mucheke Capital",
    deposits: [
      { amount: 15000, notes: "Deposit tranche 1 – 30 Jul 2026" },
      { amount:  5000, notes: "Deposit tranche 2 – 4 Aug 2026"  },
      { amount: 10000, notes: "Deposit tranche 3 – 7 Aug 2026"  },
    ],
  },
];

// ─── ROI-funded loan allocations ─────────────────────────────────────────────
// ROI=48%, Cranbrook co-investor=12%, RTC=40%

const ROI_LOANS = [
  {
    loan_no: "MV1/110326/T",
    borrower_name: "Takunda Togarepi",
    collateral_description: "Volvo XC60 - AGX 9697",
    loan_date: "2026-03-12",
    maturity_date: "2026-04-12",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    roi_share_pct: 48,
    roi_profit: 660,
    cranbrook_share_pct: 12,
    cranbrook_profit: 165,
    rtc_revenue: 550,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/120326/T",
    borrower_name: "Tinashe Chingweya",
    collateral_description: "Toyota RACTI - AHI 1137",
    loan_date: "2026-03-18",
    maturity_date: "2026-04-18",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 3500,
    total_interest_receivable: 875,
    roi_share_pct: 48,
    roi_profit: 420,
    cranbrook_share_pct: 12,
    cranbrook_profit: 105,
    rtc_revenue: 350,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/180326/T",
    borrower_name: "Ivy Chiwanza",
    collateral_description: "Nissan Note - AGY 7185",
    loan_date: "2026-03-20",
    maturity_date: "2026-04-20",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2500,
    total_interest_receivable: 625,
    roi_share_pct: 48,
    roi_profit: 300,
    cranbrook_share_pct: 12,
    cranbrook_profit: 75,
    rtc_revenue: 250,
    loan_status_override: "Paid",
    collateral_category: "motor_vehicle",
  },
  {
    // Reuben Dziya first tranche (3 months)
    loan_no: "MV1/200326/T",
    borrower_name: "Reuben Dziya",
    collateral_description: "Title deed Avonlea property",
    loan_date: "2026-03-23",
    maturity_date: "2026-04-23",
    loan_term_months: 3,
    monthly_interest_rate: 20,
    principal_amount: 13000,
    total_interest_receivable: 9464,
    roi_share_pct: 48,
    roi_profit: 4542.72,
    cranbrook_share_pct: 12,
    cranbrook_profit: 1135.68,
    rtc_revenue: 3785.60,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    // Reuben Dziya second tranche (2 months)
    loan_no: "MV1/200326/T-b",
    borrower_name: "Reuben Dziya (2nd tranche)",
    collateral_description: "Title deed Avonlea property",
    loan_date: "2026-04-23",
    maturity_date: "2026-05-23",
    loan_term_months: 2,
    monthly_interest_rate: 20,
    principal_amount: 5200,
    total_interest_receivable: 2288,
    roi_share_pct: 48,
    roi_profit: 1098.24,
    cranbrook_share_pct: 12,
    cranbrook_profit: 274.56,
    rtc_revenue: 915.20,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/240326/T",
    borrower_name: "Clodius Mudzudza",
    collateral_description: "Nissan Extrail - AGW 9838",
    loan_date: "2026-03-24",
    maturity_date: "2026-04-24",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 880,
    total_interest_receivable: 220,
    roi_share_pct: 48,
    roi_profit: 105.60,
    cranbrook_share_pct: 12,
    cranbrook_profit: 26.40,
    rtc_revenue: 88,
    loan_status_override: "Paid",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "TD1/230326/T",
    borrower_name: "Takudzwa Mashumba",
    collateral_description: "Howo Tipper",
    loan_date: "2026-03-30",
    maturity_date: "2026-04-30",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 17000,
    total_interest_receivable: 4250,
    roi_share_pct: 48,
    roi_profit: 2040,
    cranbrook_share_pct: 12,
    cranbrook_profit: 510,
    rtc_revenue: 1700,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/210426/T",
    borrower_name: "Sasha Chaparadza",
    collateral_description: "BMW 320i - AEW 7150",
    loan_date: "2026-04-21",
    maturity_date: "2026-05-21",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2500,
    total_interest_receivable: 625,
    roi_share_pct: 48,
    roi_profit: 300,
    cranbrook_share_pct: 12,
    cranbrook_profit: 75,
    rtc_revenue: 250,
    loan_status_override: "Auctioned",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/240626/T",
    borrower_name: "Anold Chaeruka",
    collateral_description: "Isuzu FVR900 - ABP 7051",
    loan_date: "2026-06-24",
    maturity_date: "2026-07-24",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 4500,
    total_interest_receivable: 1125,
    roi_share_pct: 48,
    roi_profit: 540,
    cranbrook_share_pct: 12,
    cranbrook_profit: 135,
    rtc_revenue: 450,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/310726/T",
    borrower_name: "Oren Rukwava",
    collateral_description: "Front loader Komatsu",
    loan_date: "2026-07-31",
    maturity_date: "2026-08-31",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 10000,
    total_interest_receivable: 2500,
    roi_share_pct: 48,
    roi_profit: 1200,
    cranbrook_share_pct: 12,
    cranbrook_profit: 300,
    rtc_revenue: 1000,
    loan_status_override: "Paid",
    collateral_category: "motor_vehicle",
  },
  {
    // Cranbrook's share from 14.5K collection (balance)
    loan_no: "MV1/240626/T-cb",
    borrower_name: "Cranbrook (balance from 14.5K collection)",
    collateral_description: "(Balance from 14.5K collection)",
    loan_date: "2026-06-24",
    maturity_date: "2026-07-24",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    roi_share_pct: 48,
    roi_profit: 660,
    cranbrook_share_pct: 12,
    cranbrook_profit: 165,
    rtc_revenue: 550,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/040826/T",
    borrower_name: "Farai Muchenjekwa",
    collateral_description: "BMW 730LiT - AGH 5281",
    loan_date: "2026-08-04",
    maturity_date: "2026-09-04",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 4000,
    total_interest_receivable: 1000,
    roi_share_pct: 48,
    roi_profit: 480,
    cranbrook_share_pct: 12,
    cranbrook_profit: 120,
    rtc_revenue: 400,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1070826/T",
    borrower_name: "Loveness Jumbe",
    collateral_description: "Honda CRV AEP 3140",
    loan_date: "2026-07-07",
    maturity_date: "2026-08-07",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 1650,
    total_interest_receivable: 412.50,
    roi_share_pct: 48,
    roi_profit: 198,
    cranbrook_share_pct: 12,
    cranbrook_profit: 49.50,
    rtc_revenue: 165,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
];

// ─── Cranbrook-own loan allocations ──────────────────────────────────────────
// Cranbrook=60%, RTC=40%

const CRANBROOK_OWN_LOANS = [
  {
    loan_no: "TD1/110226/T",
    borrower_name: "Archibald Wejeyi Sadza",
    collateral_description: "Borrowdale Property (title deed)",
    loan_date: "2026-03-13",
    maturity_date: "2026-04-13",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 30000,
    total_interest_receivable: 7500,
    investor_share_pct: 60,
    investor_profit: 4500,
    rtc_revenue: 3000,
    loan_status_override: "Defaulted",
    collateral_category: "motor_vehicle",
  },
  {
    // Court Order entry for ARCHIBALD (separate contractual interest)
    loan_no: "TD1/110226/T-court",
    borrower_name: "Archibald Wejeyi Sadza (Court Order)",
    collateral_description: "Borrowdale Property (court order interest)",
    loan_date: "2026-03-13",
    maturity_date: "2026-08-13",
    loan_term_months: 5,
    monthly_interest_rate: 0,
    principal_amount: 0,
    total_interest_receivable: 42000,
    investor_share_pct: 60,
    investor_profit: 25200,
    rtc_revenue: 16800,
    loan_status_override: "Court Order",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/030226/T",
    borrower_name: "Tapera Boulton",
    collateral_description: "Mercedes Benz E200",
    loan_date: "2026-08-04",
    maturity_date: "2026-09-04",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 8500,
    total_interest_receivable: 2125,
    investor_share_pct: 60,
    investor_profit: 1275,
    rtc_revenue: 850,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/180226/T",
    borrower_name: "Miriam Chimatira",
    collateral_description: "Mitsubishi Pajero AEE 2462",
    loan_date: "2026-07-20",
    maturity_date: "2026-08-20",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2731,
    total_interest_receivable: 682.75,
    investor_share_pct: 60,
    investor_profit: 409.65,
    rtc_revenue: 273.10,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/180326/T-cb",
    borrower_name: "Tinashe Chingweya",
    collateral_description: "Toyota Racti AHI 1137",
    loan_date: "2026-07-18",
    maturity_date: "2026-08-18",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 3024,
    total_interest_receivable: 756,
    investor_share_pct: 60,
    investor_profit: 453.60,
    rtc_revenue: 302.40,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV2/300326/T",
    borrower_name: "Effort Nyakurerwa Murwisi",
    collateral_description: "Rigid Truck MAN AHF 0112",
    loan_date: "2026-07-30",
    maturity_date: "2026-08-30",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    investor_share_pct: 60,
    investor_profit: 825,
    rtc_revenue: 550,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV3/300326/T",
    borrower_name: "Effort Nyakurerwa Murwisi",
    collateral_description: "Rigid Truck IVECO AHF 0113",
    loan_date: "2026-07-30",
    maturity_date: "2026-08-30",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 5500,
    total_interest_receivable: 1375,
    investor_share_pct: 60,
    investor_profit: 825,
    rtc_revenue: 550,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
];

// ─── Mucheke loan allocations ─────────────────────────────────────────────────
// Mucheke=60%, RTC=40%

const MUCHEKE_LOANS = [
  {
    loan_no: "TD1/300726/T",
    borrower_name: "Jemuce",
    collateral_description: "Southerton Property (title deed)",
    loan_date: "2026-07-30",
    maturity_date: "2026-07-30",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 12500,
    total_interest_receivable: 3125,
    investor_share_pct: 60,
    investor_profit: 1875,
    rtc_revenue: 1250,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
  {
    loan_no: "MV1/070826/T",
    borrower_name: "Nyasha Mandeya",
    collateral_description: "Toyota RAV 4 - ADA 7482",
    loan_date: "2026-08-07",
    maturity_date: "2026-08-07",
    loan_term_months: 1,
    monthly_interest_rate: 25,
    principal_amount: 2200,
    total_interest_receivable: 550,
    investor_share_pct: 60,
    investor_profit: 330,
    rtc_revenue: 220,
    loan_status_override: "Outstanding",
    collateral_category: "motor_vehicle",
  },
];

// ─── Title deed records ───────────────────────────────────────────────────────

const TITLE_DEEDS = [
  {
    deed_number: "TD1/110226/T",
    property_name: "Borrowdale Property",
    property_address: "Borrowdale, Harare",
    property_description: "Title deed – Borrowdale property (Archibald Sadza, defaulted)",
    loan_amount: 30000,
    interest_rate: 25,
    loan_term_months: 1,
    start_date: new Date("2026-03-13"),
    end_date:   new Date("2026-04-13"),
    status: "defaulted",
    borrower_name: "Archibald Wejeyi Sadza",
    notes: "Defaulted. Court order obtained. Seeded from CSV Aug 2026.",
    investor_key: "cranbrook",
  },
  {
    deed_number: "TD1/300726/T",
    property_name: "Southerton Property",
    property_address: "Southerton, Harare",
    property_description: "Title deed – Southerton property (Jemuce)",
    loan_amount: 12500,
    interest_rate: 25,
    loan_term_months: 1,
    start_date: new Date("2026-07-30"),
    end_date:   new Date("2026-08-30"),
    status: "active",
    borrower_name: "Jemuce",
    notes: "Seeded from CSV Aug 2026.",
    investor_key: "mucheke",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findOrCreateInvestor(def, adminId) {
  let inv = await Investor.findOne({ name: { $regex: new RegExp(`^${def.name}$`, "i") } });
  if (inv) {
    console.log(`  [FOUND]   ${def.name} (${inv._id})`);
    return inv;
  }
  const password_hash = await bcrypt.hash("RTC@2026temp!", 10);
  inv = await Investor.create({
    kind: def.kind,
    name: def.name,
    email: def.email,
    password_hash,
    avatar_color: "#10b981",
    status: "active",
    committed_capital: def.committed_capital,
    loan_type_preferences: ["small_loans", "motor_vehicle", "jewellery"],
    loan_term_preferences: ["two_week", "one_month"],
    title: def.title,
    notes: "Seeded from CSV – Aug 2026.",
    added_by: adminId || null,
  });
  console.log(`  [CREATED] ${def.name} (${inv._id})`);
  return inv;
}

async function ensureDeposits(investor, deposits, adminId) {
  const existing = await InvestorTransaction.find({
    investor_id: investor._id,
    type: "deposit",
  });
  if (existing.length > 0) {
    console.log(`    Deposits already exist (${existing.length} records) — skipping.`);
    return;
  }
  for (const dep of deposits) {
    await InvestorTransaction.create({
      investor_id: investor._id,
      type: "deposit",
      amount: dep.amount,
      notes: dep.notes,
      recorded_by: adminId || null,
      committed_capital_before: 0,
      committed_capital_after: dep.amount,
    });
    console.log(`    Deposit $${dep.amount} — "${dep.notes}"`);
  }
}

async function createAllocIfMissing(allocData) {
  const existing = await InvestorLoanAllocation.findOne({
    investor_id: allocData.investor_id,
    loan_no: allocData.loan_no,
    loan_date: allocData.loan_date,
  });
  if (existing) {
    console.log(`    [EXISTS] alloc ${allocData.loan_no} for investor ${allocData.investor_id}`);
    return existing;
  }
  const alloc = await InvestorLoanAllocation.create(allocData);
  console.log(`    [CREATED] alloc ${allocData.loan_no} → investor ${allocData.investor_id} (${alloc._id})`);
  return alloc;
}

function allocStatus(overrideStr) {
  if (!overrideStr) return "active";
  if (overrideStr === "Paid" || overrideStr === "Auctioned") return "completed";
  if (overrideStr === "Defaulted" || overrideStr === "Court Order") return "defaulted";
  return "active";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  // Drop the old single-field unique index on loan_id if it still exists.
  // The new schema replaces it with a sparse compound index on {investor_id, loan_no, loan_date}.
  try {
    const collection = mongoose.connection.db.collection("investorloanallocations");
    const indexes = await collection.indexes();
    const oldIdx = indexes.find((i) => i.name === "loan_id_1" && i.unique);
    if (oldIdx) {
      await collection.dropIndex("loan_id_1");
      console.log("Dropped old unique index: loan_id_1\n");
    }
  } catch (err) {
    // Ignore — index doesn't exist or collection doesn't exist yet
    if (err.code !== 27) console.warn("Index migration warning:", err.message);
  }

  // Resolve investor portal admin (used as recorded_by)
  const adminInvestor = await Investor.findOne({ kind: "admin" });
  const adminId = adminInvestor ? adminInvestor._id : null;

  // ── 1. Resolve investor accounts ─────────────────────────────────────────

  console.log("=== Step 1: Investor accounts ===");
  const investors = {};
  for (const def of INVESTORS) {
    console.log(`\n${def.name}:`);
    investors[def.key] = await findOrCreateInvestor(def, adminId);
    await ensureDeposits(investors[def.key], def.deposits, adminId);
  }

  const roiInvestor       = investors.roi;
  const cranbrookInvestor = investors.cranbrook;
  const muchekeInvestor   = investors.mucheke;

  // ── 2. ROI-funded loan allocations ───────────────────────────────────────

  console.log("\n=== Step 2: ROI-funded loan allocations (ROI primary + Cranbrook co-investor) ===");

  for (const loan of ROI_LOANS) {
    console.log(`\n  Loan ${loan.loan_no} — ${loan.borrower_name}:`);

    // ROI primary allocation (48%)
    await createAllocIfMissing({
      investor_id: roiInvestor._id,
      loan_no: loan.loan_no,
      collateral_category: loan.collateral_category,
      loan_period_key: loan.loan_term_months > 1 ? "one_month" : "one_month",
      principal_amount: loan.principal_amount,
      total_loan_profit: loan.total_interest_receivable,
      investor_share_pct: loan.roi_share_pct,
      investor_profit: parseFloat(loan.roi_profit.toFixed(2)),
      rtc_revenue: parseFloat(loan.rtc_revenue.toFixed(2)),
      status: allocStatus(loan.loan_status_override),
      is_co_investor: false,
      borrower_name: loan.borrower_name,
      collateral_description: loan.collateral_description,
      loan_date: new Date(loan.loan_date),
      maturity_date: new Date(loan.maturity_date),
      loan_term_months: loan.loan_term_months,
      monthly_interest_rate: loan.monthly_interest_rate,
      total_interest_receivable: loan.total_interest_receivable,
      loan_status_override: loan.loan_status_override,
      notes: `ROI primary (${loan.roi_share_pct}%) — seeded from CSV Aug 2026`,
    });

    // Cranbrook co-investor allocation (12%)
    await createAllocIfMissing({
      investor_id: cranbrookInvestor._id,
      loan_no: loan.loan_no,
      collateral_category: loan.collateral_category,
      loan_period_key: "one_month",
      principal_amount: loan.principal_amount,
      total_loan_profit: loan.total_interest_receivable,
      investor_share_pct: loan.cranbrook_share_pct,
      investor_profit: parseFloat(loan.cranbrook_profit.toFixed(2)),
      rtc_revenue: 0, // RTC revenue is attributed on the ROI alloc; co-investor just tracks their share
      status: allocStatus(loan.loan_status_override),
      is_co_investor: true,
      borrower_name: loan.borrower_name,
      collateral_description: loan.collateral_description,
      loan_date: new Date(loan.loan_date),
      maturity_date: new Date(loan.maturity_date),
      loan_term_months: loan.loan_term_months,
      monthly_interest_rate: loan.monthly_interest_rate,
      total_interest_receivable: loan.total_interest_receivable,
      loan_status_override: loan.loan_status_override,
      notes: `Cranbrook co-investor (${loan.cranbrook_share_pct}%) on ROI loan — seeded from CSV Aug 2026`,
    });
  }

  // ── 3. Cranbrook-own loan allocations ────────────────────────────────────

  console.log("\n=== Step 3: Cranbrook-own loan allocations (Cranbrook=60%) ===");

  for (const loan of CRANBROOK_OWN_LOANS) {
    console.log(`\n  Loan ${loan.loan_no} — ${loan.borrower_name}:`);

    await createAllocIfMissing({
      investor_id: cranbrookInvestor._id,
      loan_no: loan.loan_no,
      collateral_category: loan.collateral_category,
      loan_period_key: "one_month",
      principal_amount: loan.principal_amount,
      total_loan_profit: loan.total_interest_receivable,
      investor_share_pct: loan.investor_share_pct,
      investor_profit: parseFloat(loan.investor_profit.toFixed(2)),
      rtc_revenue: parseFloat(loan.rtc_revenue.toFixed(2)),
      status: allocStatus(loan.loan_status_override),
      is_co_investor: false,
      borrower_name: loan.borrower_name,
      collateral_description: loan.collateral_description,
      loan_date: new Date(loan.loan_date),
      maturity_date: new Date(loan.maturity_date),
      loan_term_months: loan.loan_term_months,
      monthly_interest_rate: loan.monthly_interest_rate,
      total_interest_receivable: loan.total_interest_receivable,
      loan_status_override: loan.loan_status_override,
      notes: `Cranbrook own loan (${loan.investor_share_pct}%) — seeded from CSV Aug 2026`,
    });
  }

  // ── 4. Mucheke loan allocations ──────────────────────────────────────────

  console.log("\n=== Step 4: Mucheke loan allocations (Mucheke=60%) ===");

  for (const loan of MUCHEKE_LOANS) {
    console.log(`\n  Loan ${loan.loan_no} — ${loan.borrower_name}:`);

    await createAllocIfMissing({
      investor_id: muchekeInvestor._id,
      loan_no: loan.loan_no,
      collateral_category: loan.collateral_category,
      loan_period_key: "one_month",
      principal_amount: loan.principal_amount,
      total_loan_profit: loan.total_interest_receivable,
      investor_share_pct: loan.investor_share_pct,
      investor_profit: parseFloat(loan.investor_profit.toFixed(2)),
      rtc_revenue: parseFloat(loan.rtc_revenue.toFixed(2)),
      status: allocStatus(loan.loan_status_override),
      is_co_investor: false,
      borrower_name: loan.borrower_name,
      collateral_description: loan.collateral_description,
      loan_date: new Date(loan.loan_date),
      maturity_date: new Date(loan.maturity_date),
      loan_term_months: loan.loan_term_months,
      monthly_interest_rate: loan.monthly_interest_rate,
      total_interest_receivable: loan.total_interest_receivable,
      loan_status_override: loan.loan_status_override,
      notes: `Mucheke loan (${loan.investor_share_pct}%) — seeded from CSV Aug 2026`,
    });
  }

  // ── 5. Title deeds ────────────────────────────────────────────────────────

  console.log("\n=== Step 5: Title deeds ===");

  for (const deed of TITLE_DEEDS) {
    const investorDoc = investors[deed.investor_key];
    const existing = await TitleDeed.findOne({ deed_number: deed.deed_number.toUpperCase() });
    if (existing) {
      console.log(`  [EXISTS]  TitleDeed ${deed.deed_number} (${existing._id})`);
      // Update investor_id if needed
      if (existing.investor_id.toString() !== investorDoc._id.toString()) {
        await TitleDeed.findByIdAndUpdate(existing._id, { investor_id: investorDoc._id });
        console.log(`    Updated investor_id to ${deed.investor_key}`);
      }
      continue;
    }
    const deedDoc = await TitleDeed.create({
      deed_number: deed.deed_number,
      investor_id: investorDoc._id,
      property_name: deed.property_name,
      property_address: deed.property_address,
      property_description: deed.property_description,
      loan_amount: deed.loan_amount,
      interest_rate: deed.interest_rate,
      loan_term_months: deed.loan_term_months,
      start_date: deed.start_date,
      end_date: deed.end_date,
      status: deed.status,
      borrower_name: deed.borrower_name,
      documents: [],
      notes: deed.notes,
      created_by: adminId || null,
    });
    console.log(`  [CREATED] TitleDeed ${deedDoc.deed_number} (${deedDoc._id}) investor=${deed.investor_key}`);
  }

  console.log("\n=== Seed complete ===");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("\nScript failed:", err.message);
  console.error(err.stack);
  mongoose.disconnect().finally(() => process.exit(1));
});
