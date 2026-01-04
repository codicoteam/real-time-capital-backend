const mongoose = require("mongoose");

const AuthProviderSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["google", "apple", "email"],
      required: true,
    },
    provider_user_id: { type: String, required: true },
    added_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Optional KYC/Document uploads (all optional)
const UserDocumentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["national_id", "passport", "proof_of_address", "other"],
      required: true,
    },
    url: { type: String, required: true, trim: true },
    file_name: { type: String, trim: true },
    mime_type: { type: String, trim: true },
    uploaded_at: { type: Date, default: Date.now },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String,  trim: true },
    password_hash: { type: String, select: false },

    // Roles
    roles: {
      type: [String],
      enum: [
        "super_admin_vendor",
        "admin_pawn_limited",
        "call_centre_support",
        "loan_officer_processor",
        "loan_officer_approval",
        "management",
        "customer",
      ],
      default: ["customer"],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },

    // ✅ Name split
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },

    // Keep for convenience / display (optional auto-fill in service later)
    full_name: { type: String, trim: true },

    status: {
      type: String,
      enum: ["pending", "active", "suspended", "deleted"],
      default: "pending",
    },

    // KYC (minimum set)
    national_id_number: { type: String, sparse: true, trim: true },
    date_of_birth: { type: Date },
    address: { type: String, trim: true },
    location: { type: String, trim: true },
    terms_accepted_at: { type: Date },

    // ✅ Image URLs (optional)
    national_id_image_url: { type: String, trim: true }, // front/back can be stored in documents[] if needed
    profile_pic_url: { type: String, trim: true },

    // ✅ Uploads for passport & proof of address (NOT required)
    documents: { type: [UserDocumentSchema], default: [] },

    // Verification / OTP flows
    email_verified: { type: Boolean, default: false },
    email_verification_otp: { type: String },
    email_verification_expires_at: { type: Date },

    delete_account_otp: { type: String },
    delete_account_otp_expires_at: { type: Date },

    reset_password_otp: { type: String },
    reset_password_expires_at: { type: Date },

    auth_providers: { type: [AuthProviderSchema], default: [] },
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } }
);

UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ roles: 1 });

module.exports = mongoose.model("User", UserSchema);
