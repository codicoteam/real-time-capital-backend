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
        "sold",           // sold at auction
        "redeemed",       // loan fully paid, asset returned to customer
        "closed",         // final state (either redeemed or sold)
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