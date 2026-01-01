const mongoose = require("mongoose");

const BaseAssetSchema = new mongoose.Schema(
  {
    asset_no: { type: String, unique: true, index: true },

    owner_user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }, // customer
    submitted_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // staff/customer

    category: {
      type: String,
      required: true,
      enum: ["electronics", "vehicle", "jewellery"],
      index: true,
    },

    title: { type: String, required: true, trim: true }, // e.g. "Dell Laptop", "Toyota Hilux", "Gold Ring"
    description: { type: String, trim: true },

    condition: { type: String, trim: true }, // "good/fair/needs repair"
    status: {
      type: String,
      enum: ["submitted", "valuating", "pawned", "active", "overdue", "in_repair", "auction", "sold", "redeemed", "closed"],
      default: "submitted",
      index: true,
    },

    storage_location: { type: String, trim: true }, // shelf/bin/vault/yard etc

    // Valuation lifecycle
    declared_value: { type: Number, min: 0 },
    evaluated_value: { type: Number, min: 0 },
    valuation_notes: { type: String },
    evaluated_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    evaluated_at: { type: Date },

    // Attach photos/docs
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],

    // Link to active loan if pawned
    active_loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, discriminatorKey: "asset_type" }
);

// Helpful indexes for asset tracking & reporting
BaseAssetSchema.index({ category: 1, status: 1, created_at: -1 });
BaseAssetSchema.index({ storage_location: 1, status: 1 });

const Asset = mongoose.model("Asset", BaseAssetSchema);

// ELECTRONICS / SMALL LOANS
const ElectronicsAssetSchema = new mongoose.Schema(
  {
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    serial_no: { type: String, trim: true, index: true, sparse: true },
    accessories: [{ type: String, trim: true }],
  },
  { _id: false }
);
Asset.discriminator("ElectronicsAsset", ElectronicsAssetSchema);

// VEHICLES
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
Asset.discriminator("VehicleAsset", VehicleAssetSchema);

// JEWELLERY
const JewelleryAssetSchema = new mongoose.Schema(
  {
    metal_type: { type: String, trim: true }, // gold/silver/platinum
    purity: { type: String, trim: true },     // e.g. 18K
    weight_grams: { type: Number, min: 0 },
    stone_type: { type: String, trim: true }, // diamond etc
    stone_details: { type: String, trim: true },
    certificate_no: { type: String, trim: true, index: true, sparse: true },
  },
  { _id: false }
);
Asset.discriminator("JewelleryAsset", JewelleryAssetSchema);

module.exports = Asset;
