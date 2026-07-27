"use strict";

const jwt = require("jsonwebtoken");
const Investor = require("../models/investor/investor.model");

/**
 * Verifies investor JWT and attaches investor doc to req.investor.
 */
const investorAuthMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access denied. No token provided." });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.INVESTOR_JWT_SECRET || process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    const investorId = decoded.investorId;
    if (!investorId) {
      return res.status(401).json({ success: false, message: "Invalid token payload." });
    }

    const investor = await Investor.findById(investorId);
    if (!investor) {
      return res.status(401).json({ success: false, message: "Investor account not found." });
    }
    if (investor.status === "deleted" || investor.status === "suspended") {
      return res.status(403).json({ success: false, message: "Account is not active." });
    }

    req.investor = investor;
    next();
  } catch (error) {
    console.error("investorAuthMiddleware error:", error);
    return res.status(401).json({ success: false, message: "Authentication failed." });
  }
};

/**
 * Restricts route to investor portal admins only.
 * Must come after investorAuthMiddleware.
 */
const requireInvestorAdmin = (req, res, next) => {
  if (!req.investor || req.investor.kind !== "admin") {
    return res.status(403).json({ success: false, message: "Access denied. Investor admin only." });
  }
  next();
};

/**
 * Allows admin OR the investor themselves (matched by :id param).
 * Must come after investorAuthMiddleware.
 */
const requireAdminOrSelf = (req, res, next) => {
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

module.exports = { investorAuthMiddleware, requireInvestorAdmin, requireAdminOrSelf };
