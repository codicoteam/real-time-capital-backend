const mongoose = require("mongoose");

const ExpenseSchema = new mongoose.Schema(
  {
    expense_no: { type: String, unique: true, index: true },

    category: {
      type: String,
      enum: [
        "Rent",
        "Electricity",
        "Water",
        "Internet",
        "Salaries",
        "Maintenance",
        "Transport",
        "Office Supplies",
        "Security",
        "Marketing",
        "Other",
      ],
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },

    expense_date: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },

    payment_method: {
      type: String,
      enum: ["cash", "bank_transfer", "mobile_money", "cheque", "other"],
      default: "cash",
    },

    description: { type: String, trim: true },

    // Optional attachment references (if you have an Attachment model)
    images:[String],
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],

    // Status for approval workflow (optional feature)
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved_at: { type: Date },

    notes: { type: String, trim: true },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

module.exports = mongoose.model("Expense", ExpenseSchema);
