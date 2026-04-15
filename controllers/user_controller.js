const userService = require("../services/user_service");

class UserController {
  /**
   * Register new user
   * Now passes admin user object to service when an admin creates a user
   */
  async register(req, res) {
    try {
      const userData = req.body;

      // Determine if the request is made by an admin (logged in user with no 'customer' role)
      const isAdminCreating = req.user && !req.user.roles.includes("customer");
      const creator = isAdminCreating ? req.user : null;

      const user = await userService.registerUser(userData, creator);

      let message = "Registration successful";
      if (user.roles.includes("customer") && !isAdminCreating) {
        message =
          "Registration successful. Please check your email for verification OTP.";
      } else if (
        isAdminCreating &&
        !user.roles.includes("customer") &&
        !user.roles.includes("super_admin_vendor")
      ) {
        message =
          "User created successfully. Account details sent to their email.";
      }

      res.status(201).json({
        success: true,
        message,
        data: {
          user: {
            id: user._id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            roles: user.roles,
            status: user.status,
            email_verified: user.email_verified,
            added_by: user.added_by,
          },
          requiresVerification:
            user.roles.includes("customer") && !isAdminCreating,
        },
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Registration failed",
      });
    }
  }

  /**
   * Verify email with OTP
   */
  async verifyEmail(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: "Email and OTP are required",
        });
      }

      const { user, token } = await userService.verifyEmail(email, otp);

      res.json({
        success: true,
        message: "Email verified successfully",
        data: {
          user: {
            id: user._id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            status: user.status,
            email_verified: user.email_verified,
          },
          token: token,
        },
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Email verification failed",
      });
    }
  }

  /**
   * Add a new customer (by agent, loan officer, or admin)
   * Only customer role is allowed.
   */
  async addCustomer(req, res) {
    try {
      const userData = req.body;
      const creator = req.user;

      // Force role to be ["customer"]
      userData.roles = ["customer"];

      const user = await userService.registerUser(userData, creator);

      res.status(201).json({
        success: true,
        message:
          "Customer account created. Verification OTP sent to their email.",
        data: {
          user: {
            id: user._id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            status: user.status,
            email_verified: user.email_verified,
            added_by: user.added_by,
          },
        },
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to create customer",
      });
    }
  }

  /**
   * Resend verification OTP
   */
  async resendVerificationOtp(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      await userService.resendVerificationOtp(email);

      res.json({
        success: true,
        message: "Verification OTP resent successfully",
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to resend OTP",
      });
    }
  }

  /**
   * Login user
   */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required",
        });
      }

      const result = await userService.loginUser(email, password);

      res.json({
        success: true,
        message: "Login successful",
        data: result,
      });
    } catch (error) {
      res.status(error.status || 401).json({
        success: false,
        message: error.message || "Login failed",
      });
    }
  }

  /**
   * Get user profile
   */
  async getProfile(req, res) {
    try {
      const user = await userService.getUserProfile(req.user._id);

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to fetch profile",
      });
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res) {
    try {
      const userId = req.user._id;
      const updateData = req.body;

      const user = await userService.updateUserProfile(userId, updateData);

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: user,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to update profile",
      });
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const result = await userService.forgotPassword(email);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to process forgot password",
      });
    }
  }

  /**
   * Reset password
   */
  async resetPassword(req, res) {
    try {
      const { email, otp, newPassword } = req.body;

      if (!email || !otp || !newPassword) {
        return res.status(400).json({
          success: false,
          message: "Email, OTP and new password are required",
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }

      const result = await userService.resetPassword(email, otp, newPassword);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to reset password",
      });
    }
  }

  /**
   * Request account deletion
   */
  async requestAccountDeletion(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const result = await userService.requestAccountDeletion(email);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to request account deletion",
      });
    }
  }

  /**
   * Confirm account deletion
   */
  async confirmAccountDeletion(req, res) {
    try {
      const { email, otp } = req.body;

      if (!email || !otp) {
        return res.status(400).json({
          success: false,
          message: "Email and OTP are required",
        });
      }

      const result = await userService.confirmAccountDeletion(email, otp);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to delete account",
      });
    }
  }

  /**
   * Get all users (admin only)
   */
  async getAllUsers(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        role,
        search,
        includeDeleted,
      } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (role) filters.role = role;
      if (search) filters.search = search;
      if (includeDeleted === "true") filters.includeDeleted = true;

      const result = await userService.getAllUsers(
        filters,
        parseInt(page),
        parseInt(limit),
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to fetch users",
      });
    }
  }

  /**
   * Update user status (admin only)
   */
  async updateUserStatus(req, res) {
    try {
      const { userId } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          message: "Status is required",
        });
      }

      const user = await userService.updateUserStatus(
        userId,
        status,
        req.user._id,
      );

      res.json({
        success: true,
        message: "User status updated successfully",
        data: user,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to update user status",
      });
    }
  }

  /**
   * Admin delete user - hard delete without notifying customer
   */
  async adminDeleteUser(req, res) {
    try {
      const { userId } = req.params;

      const result = await userService.adminDeleteUser(userId, req.user._id);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to delete user",
      });
    }
  }

  /**
   * Upload document
   */
  async uploadDocument(req, res) {
    try {
      const userId = req.user._id;
      const documentData = req.body;

      if (!documentData.type || !documentData.url) {
        return res.status(400).json({
          success: false,
          message: "Document type and URL are required",
        });
      }

      const document = await userService.uploadDocument(userId, documentData);

      res.status(201).json({
        success: true,
        message: "Document uploaded successfully",
        data: document,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to upload document",
      });
    }
  }

  /**
   * Remove document
   */
  async removeDocument(req, res) {
    try {
      const userId = req.user._id;
      const { documentId } = req.params;

      if (!documentId) {
        return res.status(400).json({
          success: false,
          message: "Document ID is required",
        });
      }

      const result = await userService.removeDocument(userId, documentId);

      res.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to remove document",
      });
    }
  }
}

module.exports = new UserController();
