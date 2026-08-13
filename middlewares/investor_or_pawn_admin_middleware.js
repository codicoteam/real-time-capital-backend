"use strict";

const jwt = require("jsonwebtoken");
const Investor = require("../models/investor/investor.model");
const User = require("../models/user.model");

const PAWN_SUPER_ADMIN_ROLES = new Set(["super_admin_vendor", "super_admin"]);

/**
 * Unified auth middleware for investor admin routes.
 *
 * Accepts two kinds of Bearer tokens:
 *   1. Investor JWT  — issued by /investors/auth/login  (payload: investorId)
 *   2. Pawn super-admin JWT — issued by the pawn system  (payload: userId/sub/id + roles)
 *
 * In both cases req.investor is set to a compatible object with _id, kind, name, email.
 * req.actorInfo is set for use in audit trail fields.
 */
const investorOrPawnAdminMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    // ── Try investor JWT first ────────────────────────────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.INVESTOR_JWT_SECRET || process.env.JWT_SECRET);
    } catch {
      // Try pawn JWT with the pawn secret
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ success: false, message: "Invalid or expired token." });
      }
    }

    if (decoded.investorId) {
      // ── Investor portal token ─────────────────────────────────────────────
      const investor = await Investor.findById(decoded.investorId);
      if (!investor) {
        return res.status(401).json({ success: false, message: "Investor account not found." });
      }
      if (investor.status === "deleted" || investor.status === "suspended") {
        return res.status(403).json({ success: false, message: "Account is not active." });
      }
      req.investor = investor;
      req.actorInfo = {
        id: investor._id.toString(),
        name: investor.name,
        email: investor.email,
        actor_type: "investor_admin",
      };
      return next();
    }

    // ── Pawn system token ─────────────────────────────────────────────────────
    const userId = decoded.userId || decoded.sub || decoded.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Invalid token payload." });
    }

    const pawnUser = await User.findById(userId);
    if (!pawnUser) {
      return res.status(401).json({ success: false, message: "Pawn user not found." });
    }
    if (pawnUser.status === "suspended" || pawnUser.status === "deleted") {
      return res.status(403).json({ success: false, message: "Account is suspended or deleted." });
    }

    const userRoles = Array.isArray(pawnUser.roles) ? pawnUser.roles : [pawnUser.role].filter(Boolean);
    const isSuperAdmin = userRoles.some((r) => PAWN_SUPER_ADMIN_ROLES.has(r));
    if (!isSuperAdmin) {
      return res.status(403).json({ success: false, message: "Access denied. Super admin only." });
    }

    // Synthesise an investor-compatible admin object so all downstream code works unchanged
    req.investor = {
      _id: pawnUser._id,
      kind: "admin",
      name: `${pawnUser.first_name || ""} ${pawnUser.last_name || ""}`.trim() || pawnUser.email,
      email: pawnUser.email,
      status: "active",
    };
    req.actorInfo = {
      id: pawnUser._id.toString(),
      name: req.investor.name,
      email: pawnUser.email,
      actor_type: "pawn_super_admin",
    };

    return next();
  } catch (error) {
    console.error("investorOrPawnAdminMiddleware error:", error);
    return res.status(401).json({ success: false, message: "Authentication failed." });
  }
};

/**
 * Must follow investorOrPawnAdminMiddleware.
 * Permits investor portal admins and pawn super admins; blocks all other investor kinds.
 */
const requireInvestorAdminOrPawnSuperAdmin = (req, res, next) => {
  if (!req.investor || req.investor.kind !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied. Admin only." });
  }
  next();
};

/**
 * Allows admin OR the investor themselves (matched by :id param).
 */
const requireAdminOrSelfUnified = (req, res, next) => {
  if (!req.investor) {
    return res.status(401).json({ success: false, message: "Authentication required." });
  }
  const isAdmin = req.investor.kind === "admin";
  const isSelf = req.investor._id.toString() === req.params.id;
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  next();
};

module.exports = {
  investorOrPawnAdminMiddleware,
  requireInvestorAdminOrPawnSuperAdmin,
  requireAdminOrSelfUnified,
};
