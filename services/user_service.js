const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  sendVerificationEmail,
  sendAdminCreatedAccountEmail,
  sendPasswordResetEmail,
  sendDeleteAccountEmail,
  generateOTP,
} = require("../utils/emails_util");
const { sendSmsWithMessage } = require("../utils/sms_utils");

class UserService {
  /**
   * Generate JWT token for user
   * Only active and email_verified users can get tokens
   */
  generateToken(user) {
    // Check if user is eligible for token
    if (user.status !== "active" || !user.email_verified) {
      return null;
    }

    return jwt.sign(
      {
        full_name: user.full_name,
        userId: user._id,
        email: user.email,
        roles: user.roles,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );
  }

  /**
   * Hash password
   */
  async hashPassword(password) {
    return await bcrypt.hash(password, 10);
  }

  /**
   * Compare password
   */
  async comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }

  /**
   * Register a new user
   * @param {Object} userData - user fields
   * @param {Object} creator - { _id: string, roles: string[] } or null for self‑registration
   */
  async registerUser(userData, creator = null) {
    const {
      email,
      password,
      first_name,
      last_name,
      phone,
      roles = ["customer"],
      ...otherData
    } = userData;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw { status: 409, message: "User already exists" };
    }

    // Prepare user object
    const user = new User({
      email,
      first_name,
      last_name,
      phone,
      roles,
      ...otherData,
    });

    user.full_name = `${first_name} ${last_name}`.trim();
    if (password) {
      user.password_hash = await this.hashPassword(password);
    }

    // Determine creator type
    const isSelfRegistration = !creator;
    const creatorRoles = creator?.roles || [];
    const isAdminCreator = creatorRoles.some((r) =>
      ["super_admin_vendor", "admin_pawn_limited"].includes(r),
    );
    const isStaffCreator = creatorRoles.some((r) =>
      ["agent", "loan_officer_processor", "loan_officer_approval"].includes(r),
    );
    const isTargetCustomer = roles.includes("customer") && roles.length === 1;
    const isTargetStaff = !isTargetCustomer && roles.length > 0;

    // Set added_by if creator exists
    if (creator) {
      user.added_by = creator._id;
    }

    // Status & verification logic
    const isSuperAdmin = roles.includes("super_admin_vendor");

    if (isSuperAdmin) {
      // Super admin created by system or another super admin
      user.status = "active";
      user.email_verified = true;
    } else if (isTargetStaff && isAdminCreator && !isSelfRegistration) {
      // Admin creates staff member → active immediately, no OTP
      user.status = "active";
      user.email_verified = true;
    } else {
      // Customer (self‑registration or staff‑created) → pending + OTP
      user.status = "pending";
      user.email_verification_otp = generateOTP();
      user.email_verification_expires_at = new Date(
        Date.now() + 15 * 60 * 1000,
      );
    }

    await user.save();

    // Send emails / SMS
    if (isSuperAdmin) {
      // No email for super admin creation
    } else if (isTargetStaff && isAdminCreator && !isSelfRegistration) {
      await sendAdminCreatedAccountEmail({
        to: email,
        fullName: user.full_name,
      });
    } else if (isTargetCustomer) {
      await sendVerificationEmail({
        to: email,
        fullName: user.full_name,
        otp: user.email_verification_otp,
      });
      if (user.phone) {
        const smsMessage = `Your Real Time Capital verification code is: ${user.email_verification_otp}. It expires in 15 minutes.`;
        try {
          await sendSmsWithMessage(user.phone, smsMessage);
        } catch (smsErr) {
          console.warn("SMS verification send failed (non-critical):", smsErr.message);
        }
      }
    }

    return user;
  }

  /**
   * Verify email with OTP and return token
   */
  async verifyEmail(email, otp) {
    const user = await User.findOne({ email });

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (user.email_verified) {
      throw { status: 400, message: "Email already verified" };
    }

    if (!user.email_verification_otp || !user.email_verification_expires_at) {
      throw { status: 400, message: "No pending verification" };
    }

    if (user.email_verification_otp !== otp) {
      throw { status: 400, message: "Invalid OTP" };
    }

    if (new Date() > user.email_verification_expires_at) {
      throw { status: 400, message: "OTP expired" };
    }

    // Update user
    user.email_verified = true;
    user.status = "active";
    user.email_verification_otp = null;
    user.email_verification_expires_at = null;

    await user.save();

    // Generate token after successful verification
    const token = this.generateToken(user);

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password_hash;

    return { user: userResponse, token };
  }

  /**
   * Resend verification OTP
   *
   * Behaviour:
   *  1. If a valid OTP exists AND was sent < 60 s ago → silently skip (prevents
   *     the double-send that happens when the frontend calls resend immediately
   *     after registration before the first email arrives).
   *  2. If a valid OTP exists AND cooldown has passed → reuse the SAME OTP
   *     (refresh its expiry so the user gets a full 15 minutes) and send it to
   *     both email and SMS.
   *  3. If no OTP exists or the existing one has expired → generate a fresh OTP,
   *     save it, then send to both email and SMS.
   *
   * In all cases the same OTP is delivered to both channels.
   */
  async resendVerificationOtp(email) {
    const user = await User.findOne({ email });

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (user.email_verified) {
      throw { status: 400, message: "Email already verified" };
    }

    const OTP_VALIDITY_MS = 15 * 60 * 1000; // 15 minutes
    const COOLDOWN_MS     =      60 * 1000; // 60-second minimum between sends

    const now = new Date();
    const hasValidOtp =
      user.email_verification_otp &&
      user.email_verification_expires_at &&
      now < user.email_verification_expires_at;

    if (hasValidOtp) {
      // Estimate when the OTP was originally sent:
      //   sent_at ≈ expires_at − 15 min
      const sentAt      = new Date(user.email_verification_expires_at.getTime() - OTP_VALIDITY_MS);
      const msSinceSent = now.getTime() - sentAt.getTime();

      if (msSinceSent < COOLDOWN_MS) {
        // Too soon after the last send (e.g. the auto-resend right after
        // registration). Return silently — the user already has an email/SMS
        // on the way.
        console.log(`[resendVerificationOtp] Cooldown active for ${email} (${Math.round(msSinceSent / 1000)}s since last send). Skipping duplicate send.`);
        return user;
      }

      // Cooldown passed but OTP still valid — reuse the same OTP, refresh expiry
      user.email_verification_expires_at = new Date(now.getTime() + OTP_VALIDITY_MS);
      await user.save();
    } else {
      // OTP missing or expired — generate a fresh one
      user.email_verification_otp        = generateOTP();
      user.email_verification_expires_at = new Date(now.getTime() + OTP_VALIDITY_MS);
      await user.save();
    }

    // Send the single OTP to both email and SMS
    await sendVerificationEmail({
      to:       email,
      fullName: user.full_name,
      otp:      user.email_verification_otp,
    });

    if (user.phone) {
      const smsMessage = `Your Real Time Capital verification code is: ${user.email_verification_otp}. It expires in 15 minutes.`;
      try {
        await sendSmsWithMessage(user.phone, smsMessage);
      } catch (smsErr) {
        console.warn("SMS resend failed (non-critical):", smsErr.message);
      }
    }

    return user;
  }

  /**
   * Login user - only active and email_verified users can login
   */
  async loginUser(email, password) {
    const user = await User.findOne({ email }).select("+password_hash");

    if (!user) {
      throw { status: 401, message: "Invalid credentials" };
    }

    // Check if account is active
    if (user.status !== "active") {
      throw {
        status: 403,
        message: `Account is ${user.status}. Please contact support.`,
      };
    }

    // Check if email is verified
    if (!user.email_verified) {
      throw {
        status: 403,
        message: "Please verify your email before logging in.",
      };
    }

    // Verify password
    const isValidPassword = await this.comparePassword(
      password,
      user.password_hash,
    );
    if (!isValidPassword) {
      throw { status: 401, message: "Invalid credentials" };
    }

    // Generate token
    const token = this.generateToken(user);

    if (!token) {
      throw {
        status: 403,
        message: "Unable to generate token. Please contact support.",
      };
    }

    // Remove sensitive data
    const userResponse = user.toObject();
    delete userResponse.password_hash;

    return { user: userResponse, token };
  }

  /**
   * Forgot password - send OTP
   */
  async forgotPassword(email) {
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if user exists or not for security
      return { message: "If your email exists, you will receive an OTP" };
    }

    // Generate OTP
    user.reset_password_otp = generateOTP();
    user.reset_password_expires_at = new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    // Send email
    await sendPasswordResetEmail({
      to: email,
      fullName: user.full_name,
      otp: user.reset_password_otp,
    });

    // Send SMS if phone exists
    if (user.phone) {
      const smsMessage = `Your Real Time Capital password reset code is: ${user.reset_password_otp}. It expires in 15 minutes.`;
      try {
        await sendSmsWithMessage(user.phone, smsMessage);
      } catch (smsErr) {
        console.warn("SMS password reset send failed (non-critical):", smsErr.message);
      }
    }

    return { message: "OTP sent to email and SMS (if phone number provided)" };
  }

  /**
   * Reset password with OTP
   */
  async resetPassword(email, otp, newPassword) {
    const user = await User.findOne({ email });

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (!user.reset_password_otp || !user.reset_password_expires_at) {
      throw { status: 400, message: "No password reset requested" };
    }

    if (user.reset_password_otp !== otp) {
      throw { status: 400, message: "Invalid OTP" };
    }

    if (new Date() > user.reset_password_expires_at) {
      throw { status: 400, message: "OTP expired" };
    }

    // Update password
    user.password_hash = await this.hashPassword(newPassword);
    user.reset_password_otp = null;
    user.reset_password_expires_at = null;

    await user.save();

    return { message: "Password reset successful" };
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    return user;
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updateData) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Don't allow updating sensitive fields directly
    const allowedUpdates = [
      "first_name",
      "last_name",
      "phone",
      "date_of_birth",
      "address",
      "location",
      "profile_pic_url",
    ];

    // Update allowed fields
    allowedUpdates.forEach((field) => {
      if (updateData[field] !== undefined) {
        user[field] = updateData[field];
      }
    });

    // Update full name if first or last name changed
    if (updateData.first_name || updateData.last_name) {
      user.full_name = `${user.first_name} ${user.last_name}`.trim();
    }

    await user.save();
    return user;
  }

  /**
   * Update profile picture
   */
  async updateProfilePicture(userId, profilePicUrl) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    user.profile_pic_url = profilePicUrl;
    await user.save();

    return user;
  }

  /**
   * Update next of kin details
   */
  async updateNextOfKin(userId, nextOfKinData) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Allowed next of kin fields
    const allowedFields = [
      "full_name",
      "relationship",
      "phone_number",
      "email",
      "address",
    ];

    if (!user.next_of_kin) {
      user.next_of_kin = {};
    }

    allowedFields.forEach((field) => {
      if (nextOfKinData[field] !== undefined) {
        user.next_of_kin[field] = nextOfKinData[field];
      }
    });

    await user.save();
    return user;
  }

  /**
   * Update KYC documents and details
   */
  async updateKycDetails(userId, kycData) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Allowed KYC fields
    const allowedFields = [
      "national_id_number",
      "date_of_birth",
      "address",
      "location",
      "gender",
      "marital_status",
      "alternative_phone",
      "national_id_image_url",
      "passport_image_url",
      "proof_of_address_url",
      "passport_expiry_date",
      "driving_license_expiry_date",
      "national_id_expiry_date",
      "is_employed",
    ];

    allowedFields.forEach((field) => {
      if (kycData[field] !== undefined) {
        user[field] = kycData[field];
      }
    });

    // Update employment details if provided
    if (kycData.employment_details) {
      if (!user.employment_details) {
        user.employment_details = {};
      }
      const employmentFields = [
        "employer_name",
        "job_title",
        "duration",
        "location",
        "contacts",
      ];
      employmentFields.forEach((field) => {
        if (kycData.employment_details[field] !== undefined) {
          user.employment_details[field] = kycData.employment_details[field];
        }
      });
    }

    await user.save();
    return user;
  }

  /**
   * Update password for logged-in user
   */
  async updatePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId).select("+password_hash");

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Verify current password
    const isValidPassword = await this.comparePassword(
      currentPassword,
      user.password_hash,
    );
    if (!isValidPassword) {
      throw { status: 401, message: "Current password is incorrect" };
    }

    // Hash and update new password
    user.password_hash = await this.hashPassword(newPassword);
    await user.save();

    return { message: "Password updated successfully" };
  }

  /**
   * Update personal details
   */
  async updatePersonalDetails(userId, personalData) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Allowed personal details fields
    const allowedFields = [
      "first_name",
      "last_name",
      "phone",
      "date_of_birth",
      "address",
      "location",
      "gender",
      "marital_status",
      "alternative_phone",
    ];

    allowedFields.forEach((field) => {
      if (personalData[field] !== undefined) {
        user[field] = personalData[field];
      }
    });

    // Update full name if first or last name changed
    if (personalData.first_name || personalData.last_name) {
      user.full_name = `${user.first_name} ${user.last_name}`.trim();
    }

    await user.save();
    return user;
  }

  /**
   * Request account deletion (send OTP)
   */
  async requestAccountDeletion(email) {
    const user = await User.findOne({ email });

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Generate OTP
    user.delete_account_otp = generateOTP();
    user.delete_account_otp_expires_at = new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    // Send email
    await sendDeleteAccountEmail({
      to: email,
      fullName: user.full_name,
      otp: user.delete_account_otp,
    });

    return { message: "Account deletion OTP sent to email" };
  }

  /**
   * Confirm account deletion with OTP
   */
  async confirmAccountDeletion(email, otp) {
    const user = await User.findOne({ email });

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (!user.delete_account_otp || !user.delete_account_otp_expires_at) {
      throw { status: 400, message: "No account deletion requested" };
    }

    if (user.delete_account_otp !== otp) {
      throw { status: 400, message: "Invalid OTP" };
    }

    if (new Date() > user.delete_account_otp_expires_at) {
      throw { status: 400, message: "OTP expired" };
    }

    // Soft delete - mark as deleted
    user.status = "deleted";
    user.email = `deleted_${Date.now()}_${user.email}`; // Anonymize email
    user.phone = user.phone ? `deleted_${Date.now()}_${user.phone}` : null;
    user.national_id_number = null;
    user.delete_account_otp = null;
    user.delete_account_otp_expires_at = null;

    await user.save();

    return { message: "Account deleted successfully" };
  }

  /**
   * Admin delete user - hard delete or soft delete without notifying customer
   */
  async adminDeleteUser(userId, adminId) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Prevent deleting super admin
    if (user.roles.includes("super_admin_vendor")) {
      throw { status: 403, message: "Cannot delete super admin user" };
    }

    // Soft delete - mark as deleted and anonymize
    user.status = "deleted";
    user.email = `deleted_${Date.now()}_${user.email}`;
    user.phone = user.phone ? `deleted_${Date.now()}_${user.phone}` : null;
    user.national_id_number = null;
    user.password_hash = null;
    user.email_verified = false;

    // Clear all OTPs
    user.email_verification_otp = null;
    user.email_verification_expires_at = null;
    user.delete_account_otp = null;
    user.delete_account_otp_expires_at = null;
    user.reset_password_otp = null;
    user.reset_password_expires_at = null;

    await user.save();

    return { message: "User deleted successfully" };
  }

  /**
   * Get all users (for admin)
   * Now populates 'added_by' with first_name, last_name, email
   */
  async getAllUsers(filters = {}, page = 1, limit = 20) {
    const query = {};

    // Apply filters - exclude deleted users by default unless specifically requested
    if (filters.includeDeleted !== true) {
      query.status = { $ne: "deleted" };
    }

    if (filters.status) query.status = filters.status;
    if (filters.role) query.roles = { $in: [filters.role] };
    if (filters.search) {
      query.$or = [
        { email: { $regex: filters.search, $options: "i" } },
        { first_name: { $regex: filters.search, $options: "i" } },
        { last_name: { $regex: filters.search, $options: "i" } },
        { phone: { $regex: filters.search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .populate("added_by", "first_name last_name email")
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update user status (for admin)
   */
  async updateUserStatus(userId, status, updatedBy) {
    const validStatuses = ["pending", "active", "suspended", "deleted"];

    if (!validStatuses.includes(status)) {
      throw { status: 400, message: "Invalid status" };
    }

    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Prevent modifying super admin status
    if (user.roles.includes("super_admin_vendor") && status !== "active") {
      throw { status: 403, message: "Cannot modify super admin status" };
    }

    user.status = status;
    await user.save();

    return user;
  }

  /**
   * Upload document
   */
  async uploadDocument(userId, documentData) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    const document = {
      ...documentData,
      uploaded_at: new Date(),
    };

    user.documents.push(document);
    await user.save();

    return user.documents[user.documents.length - 1];
  }

  /**
   * Remove document
   */
  async removeDocument(userId, documentId) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    user.documents = user.documents.filter(
      (doc) => doc._id.toString() !== documentId,
    );

    await user.save();
    return { message: "Document removed successfully" };
  }

  /**
   * Add FCM token for push notifications
   */
  async addFcmToken(userId, fcmToken) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (!user.fcm_tokens) {
      user.fcm_tokens = [];
    }

    // Add token if not already present
    if (!user.fcm_tokens.includes(fcmToken)) {
      user.fcm_tokens.push(fcmToken);
      await user.save();
    }

    return { message: "FCM token added successfully" };
  }

  /**
   * Remove FCM token (on logout or token invalidation)
   */
  async removeFcmToken(userId, fcmToken) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (user.fcm_tokens && fcmToken) {
      user.fcm_tokens = user.fcm_tokens.filter((t) => t !== fcmToken);
      await user.save();
    }

    return { message: "FCM token removed successfully" };
  }

  /**
   * Remove all FCM tokens for a user (on logout all devices)
   */
  async removeAllFcmTokens(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    user.fcm_tokens = [];
    await user.save();

    return { message: "All FCM tokens removed successfully" };
  }
  /**
   * Get users added by a specific agent/staff member
   * @param {string} addedByUserId - The ID of the agent/staff who added the users
   * @param {Object} filters - Optional filters
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   */
  async getUsersAddedByStaff(
    addedByUserId,
    filters = {},
    page = 1,
    limit = 20,
  ) {
    const query = {
      added_by: addedByUserId,
    };

    // Apply filters - exclude deleted users by default unless specifically requested
    if (filters.includeDeleted !== true) {
      query.status = { $ne: "deleted" };
    }

    if (filters.status) query.status = filters.status;
    if (filters.role) query.roles = { $in: [filters.role] };
    if (filters.search) {
      query.$or = [
        { email: { $regex: filters.search, $options: "i" } },
        { first_name: { $regex: filters.search, $options: "i" } },
        { last_name: { $regex: filters.search, $options: "i" } },
        { phone: { $regex: filters.search, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .populate("added_by", "first_name last_name email roles")
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user by ID with permission check (only if user was added by the requesting staff)
   */
  async getUserByIdForStaff(userId, staffUserId) {
    const user = await User.findOne({
      _id: userId,
      added_by: staffUserId,
    }).populate("added_by", "first_name last_name email roles");

    if (!user) {
      throw {
        status: 404,
        message:
          "User not found or you don't have permission to access this user",
      };
    }

    return user;
  }

  /**
   * Update KYC verification status
   * When status is set to "verified", automatically sets user status to "active"
   * @param {string} userId - User ID to update
   * @param {string} kycStatus - New KYC status (unverified, pending, verified, rejected)
   * @param {string} verifiedByUserId - ID of the admin/staff who verified
   */
  async updateKycVerificationStatus(userId, kycStatus, verifiedByUserId) {
    // Validate KYC status
    const validKycStatuses = ["unverified", "pending", "verified", "rejected"];
    if (!validKycStatuses.includes(kycStatus)) {
      throw { status: 400, message: "Invalid KYC verification status" };
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    // Check if user is deleted
    if (user.status === "deleted") {
      throw {
        status: 400,
        message: "Cannot update KYC status for deleted user",
      };
    }

    // Update KYC verification status
    user.kyc_verification_status = kycStatus;
    user.kyc_verified_by = verifiedByUserId;
    user.kyc_verified_at = new Date();

    // If KYC status is "verified", automatically set user status to "active"
    if (kycStatus === "verified") {
      user.status = "active";
    }

    await user.save();

    // Return user without sensitive data
    const userResponse = user.toObject();
    delete userResponse.password_hash;

    return userResponse;
  }
}

module.exports = new UserService();
