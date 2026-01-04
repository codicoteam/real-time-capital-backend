const jwt = require("jsonwebtoken");
const User = require("../models/user.model"); // adjust path if needed

/**
 * 🔐 Authentication middleware
 * - Verifies JWT
 * - Loads active user
 * - Attaches user to req.user
 */
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token.",
      });
    }

    const userId = decoded.userId || decoded.sub || decoded.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload.",
      });
    }

    // password_hash is excluded by default (select:false)
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Account is not active.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("authMiddleware error:", error);
    return res.status(401).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

/**
 * 🔐 Role guard middleware factory
 * Usage:
 *   router.post(
 *     "/approve-loan",
 *     authMiddleware,
 *     requireRoles("loan_officer_approval", "super_admin_vendor"),
 *     handler
 *   );
 */
const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];

    const hasRole = userRoles.some((role) =>
      allowedRoles.includes(role)
    );

    if (!hasRole) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of roles: ${allowedRoles.join(
          ", "
        )}.`,
      });
    }

    next();
  };
};

module.exports = {
  authMiddleware,
  requireRoles,
};
