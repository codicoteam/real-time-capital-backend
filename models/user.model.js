const mongoose = require("mongoose");

// Document upload subdocument (for extra files)
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
  { _id: false },
);

// Employment details subdocument
const EmploymentDetailsSchema = new mongoose.Schema(
  {
    employer_name: { type: String, trim: true },
    job_title: { type: String, trim: true },
    duration: { type: String, trim: true }, // e.g. "2 years"
    location: { type: String, trim: true },
    contacts: { type: String, trim: true },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    // Basic account info
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
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
        "agent",
      ],
      default: ["customer"],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },

    // Name fields
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    full_name: { type: String, trim: true }, // optional, can be auto-generated

    // Account status
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "deleted"],
      default: "pending",
    },

    // KYC FIELDS
    national_id_number: { type: String, sparse: true, trim: true },
    date_of_birth: { type: Date },
    address: { type: String, trim: true },
    location: { type: String, trim: true },
    gender: { type: String, trim: true },
    marital_status: { type: String, trim: true },
    alternative_phone: { type: String, trim: true },

    // Document URLs
    national_id_image_url: { type: String, trim: true },
    passport_image_url: { type: String, trim: true },
    proof_of_address_url: { type: String, trim: true },
    profile_pic_url: { type: String, trim: true },

    // Document expiry dates
    passport_expiry_date: { type: Date },
    driving_license_expiry_date: { type: Date },
    national_id_expiry_date: { type: Date },

    // Employment information
    is_employed: { type: Boolean, default: false }, // <-- field to select if user is employed
    employment_details: { type: EmploymentDetailsSchema, default: {} },

    // Next of kin
    next_of_kin: {
      full_name: { type: String, trim: true },
      relationship: { type: String, trim: true },
      phone_number: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      address: { type: String, trim: true },
    },

    // Generic document store
    documents: { type: [UserDocumentSchema], default: [] },

    // KYC verification / profile approval
    kyc_verification_status: {
      type: String,
      enum: ["unverified", "pending", "verified", "rejected"],
      default: "unverified",
    },
    kyc_verified_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    kyc_verified_at: { type: Date },

    // Profile approval (by agent or loan officer processor)
    profile_approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    profile_approved_at: { type: Date },
    
    // FCM tokens for push notifications
    fcm_tokens: {
      type: [String],
      default: [],
      index: true,
    },

    // Terms & conditions
    terms_accepted_at: { type: Date },

    // Verification / OTP flows
    email_verified: { type: Boolean, default: false },
    email_verification_otp: { type: String },
    email_verification_expires_at: { type: Date },
    delete_account_otp: { type: String },
    delete_account_otp_expires_at: { type: Date },
    reset_password_otp: { type: String },
    reset_password_expires_at: { type: Date },

    added_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // ❌ auth_providers removed
  },
  { timestamps: { createdAt: "created_at", updatedAt: "updated_at" } },
);

// Indexes
UserSchema.index({ email: 1 });
UserSchema.index({ phone: 1 });
UserSchema.index({ roles: 1 });
UserSchema.index({ kyc_verification_status: 1 });
UserSchema.index({ fcm_tokens: 1 });

module.exports = mongoose.model("User", UserSchema);