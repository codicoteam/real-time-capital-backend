// services/user_service.js
const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { 
  sendVerificationEmail, 
  sendAdminCreatedAccountEmail,
  sendPasswordResetEmail,
  sendDeleteAccountEmail,
  generateOTP 
} = require("../utils/emails_util");

class UserService {
  /**
   * Generate JWT token for user
   */
  generateToken(user) {
    return jwt.sign(
      {
        userId: user._id,
        email: user.email,
        roles: user.roles,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
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
   * Register a new user with role-based logic
   */
  async registerUser(userData, createdByAdmin = false) {
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

    // Set full name
    user.full_name = `${first_name} ${last_name}`.trim();

    // Handle password if provided
    if (password) {
      user.password_hash = await this.hashPassword(password);
    }

    // Role-based logic
    const isCustomer = roles.includes("customer");
    const isSuperAdmin = roles.includes("super_admin_vendor");

    if (isCustomer && !createdByAdmin) {
      // For self-registered customers: generate OTP and set pending
      user.status = "pending";
      user.email_verification_otp = generateOTP();
      user.email_verification_expires_at = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    } else if (createdByAdmin && !isCustomer && !isSuperAdmin) {
      // For admin-created staff: set active immediately
      user.status = "active";
      user.email_verified = true;
    } else if (isSuperAdmin) {
      // For super admin: set active, no OTP
      user.status = "active";
      user.email_verified = true;
    }

    // Save user
    await user.save();

    // Send appropriate emails
    if (isCustomer && !createdByAdmin) {
      await sendVerificationEmail({
        to: email,
        fullName: user.full_name,
        otp: user.email_verification_otp,
      });
    } else if (createdByAdmin && !isCustomer && !isSuperAdmin) {
      await sendAdminCreatedAccountEmail({
        to: email,
        fullName: user.full_name,
      });
    }

    // Don't send OTP for super admin

    return user;
  }

  /**
   * Verify email with OTP
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
    return user;
  }

  /**
   * Resend verification OTP
   */
  async resendVerificationOtp(email) {
    const user = await User.findOne({ email });
    
    if (!user) {
      throw { status: 404, message: "User not found" };
    }

    if (user.email_verified) {
      throw { status: 400, message: "Email already verified" };
    }

    // Generate new OTP
    user.email_verification_otp = generateOTP();
    user.email_verification_expires_at = new Date(Date.now() + 15 * 60 * 1000);
    
    await user.save();

    // Send email
    await sendVerificationEmail({
      to: email,
      fullName: user.full_name,
      otp: user.email_verification_otp,
    });

    return user;
  }

  /**
   * Login user
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
        message: `Account is ${user.status}. Please contact support.` 
      };
    }

    // Verify password
    const isValidPassword = await this.comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      throw { status: 401, message: "Invalid credentials" };
    }

    // Generate token
    const token = this.generateToken(user);

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

    return { message: "OTP sent to email" };
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
      "profile_pic_url"
    ];

    // Update allowed fields
    allowedUpdates.forEach(field => {
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
   * Get all users (for admin)
   */
  async getAllUsers(filters = {}, page = 1, limit = 20) {
    const query = {};

    // Apply filters
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
      doc => doc._id.toString() !== documentId
    );
    
    await user.save();
    return { message: "Document removed successfully" };
  }
}

module.exports = new UserService();