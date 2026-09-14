const mongoose = require("mongoose");

const BaseAssetSchema = new mongoose.Schema(
  {
    asset_no: { type: String, unique: true, index: true },

    owner_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }, // customer
    submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // staff/customer

    category: {
      type: String,
      required: true,
      enum: ["small_loans", "motor_vehicle", "jewellery"], // matches LoanApplication categories
      index: true,
    },

    title: { type: String, required: true, trim: true }, // e.g. "Dell Laptop", "Toyota Hilux", "Gold Ring"
    description: { type: String, trim: true },
    condition: { type: String, trim: true }, // "good/fair/needs repair"

    // Asset images (derived from collateral_images in LoanApplication)
    asset_images: { type: [String], default: [] }, // array of image URLs

    // Asset status lifecycle (aligned with loan status)
    status: {
      type: String,
      enum: [
        "submitted",      // initially when created from application
        "valuating",      // under valuation
        "pawned",         // active loan, asset held as collateral
        "active",         // alias for pawned
        "overdue",        // loan overdue but asset still held
        "in_repair",      // optional
        "auction",        // loan defaulted → asset moved to auction
        "rtc_owned",      // auction expired with no winning bid — now RTC's own inventory, awaiting disposal decision
        "sold",           // sold — either to an auction winner, or later disposed of by RTC (see disposal_method)
        "retained",       // RTC decided to keep/use the asset internally rather than sell it — terminal, no sale
        "redeemed",       // loan fully paid, asset returned to customer
        "closed",         // final state (redeemed, sold, or retained)
      ],
      default: "submitted",
      index: true,
    },

    storage_location: { type: String, trim: true }, // shelf/bin/vault/yard

    // Valuation lifecycle
    declared_value: { type: Number, min: 0 },
    evaluated_value: { type: Number, min: 0 },
    valuation_notes: { type: String },
    evaluated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    evaluated_at: { type: Date },

    // Link to active loan if pawned
    active_loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },

    // Set when an auction expires with no winning bid — the asset becomes RTC's own
    // inventory rather than returning to the customer or a buyer. Populated by the
    // auction expiry logic (services/auction_service.js / assets_auction_service.js).
    rtc_owned_at: { type: Date, default: null },
    rtc_owned_from_auction: { type: mongoose.Schema.Types.ObjectId, ref: "Auction", default: null },

    // How an RTC-owned asset (status "auction" or "rtc_owned") was eventually disposed
    // of. Set once, by the Super Admin "Record Disposal" action.
    //   sold_externally     — RTC sold the asset outside the normal bidder-wins flow
    //                         (off-platform sale, or a direct sale while still "in
    //                         auction"). disposal_sale_price is required.
    //   retained_internal_use — RTC kept the asset for its own use. No sale, no
    //                         disposal_sale_price, no profit/loss (a balance-sheet
    //                         reclassification, not a P&L event).
    disposal_method: {
      type: String,
      enum: ["sold_externally", "retained_internal_use", null],
      default: null,
    },
    // Snapshot of the defaulted loan's outstanding balance at the time of disposal —
    // what RTC's collateral was actually worth on the books when it stopped being a
    // receivable. The basis profit/loss is measured against.
    disposal_cost_basis: { type: Number, min: 0, default: null },
    disposal_sale_price: { type: Number, min: 0, default: null }, // only for sold_externally
    // sale_price - cost_basis. Only meaningful (non-null) for sold_externally — a
    // positive value is a gain over what was owed, negative is a shortfall.
    disposal_profit_loss: { type: Number, default: null },
    disposal_notes: { type: String, trim: true },
    disposed_by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    disposed_at: { type: Date, default: null },
    // Xero BankTransaction/ManualJournal this disposal sale was posted as (sold_externally only)
    xero_disposal_transaction_id: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    discriminatorKey: "asset_type",
  }
);

// Indexes
BaseAssetSchema.index({ category: 1, status: 1, created_at: -1 });
BaseAssetSchema.index({ storage_location: 1, status: 1 });

const Asset = mongoose.model("Asset", BaseAssetSchema);

// Discriminators for specific asset types (optional – keep for flexibility)
const ElectronicsAssetSchema = new mongoose.Schema(
  {
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    serial_no: { type: String, trim: true, index: true, sparse: true },
    accessories: [{ type: String, trim: true }],
  },
  { _id: false }
);
Asset.discriminator("small_loans", ElectronicsAssetSchema); // category "small_loans"

const VehicleAssetSchema = new mongoose.Schema(
  {
    make: { type: String, trim: true },
    model: { type: String, trim: true },
    registration_no: { type: String, trim: true, index: true, sparse: true },
    engine_no: { type: String, trim: true },
    chassis_no: { type: String, trim: true },
    cc_serial_no: { type: String, trim: true },
  },
  { _id: false }
);
Asset.discriminator("motor_vehicle", VehicleAssetSchema);

const JewelleryAssetSchema = new mongoose.Schema(
  {
    metal_type: { type: String, trim: true },
    purity: { type: String, trim: true },
    weight_grams: { type: Number, min: 0 },
    stone_type: { type: String, trim: true },
    stone_details: { type: String, trim: true },
    certificate_no: { type: String, trim: true, index: true, sparse: true },
  },
  { _id: false }
);
Asset.discriminator("jewellery", JewelleryAssetSchema);

module.exports = Asset;