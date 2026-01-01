const mongoose = require("mongoose");

const DebtorRecordSchema = new mongoose.Schema(
  {
    source: { type: String, default: "Debtors_list_final.csv" },
    source_period_label: { type: String }, // e.g. "JUNE 2023-NOVEMBER 2025"

    asset_no: { type: String, index: true, trim: true },
    client_name: { type: String, index: true, trim: true },

    principal: { type: Number },
    interest: { type: Number },
    period: { type: String },

    amount_due: { type: Number },
    penalties: { type: Number },
    total_due: { type: Number },
    profit_loss_on_sale: { type: Number },

    date_of: { type: Date },     // "DATE OF" column in sheet (meaning depends on sheet)
    due_date: { type: Date },

    asset: { type: String },     // item type/name
    specs: { type: String },
    asset_code: { type: String },
    reg_or_serial_no: { type: String, index: true, sparse: true },

    account_status: { type: String }, // e.g. PAID/UNPAID/DEFAULT etc
    contact_details: { type: String },
    branch: { type: String },

    // If you want to link matching customer later:
    matched_user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Keep original row data for traceability
    raw: { type: mongoose.Schema.Types.Mixed },
    imported_at: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

DebtorRecordSchema.index({ client_name: 1, reg_or_serial_no: 1 });

module.exports = mongoose.model("DebtorRecord", DebtorRecordSchema);
