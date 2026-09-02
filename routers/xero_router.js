"use strict";

const express = require("express");
const router = express.Router();
const xeroController = require("../controllers/xero_controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth_middleware");

const superAdminOnly = [authMiddleware, requireRoles("super_admin_vendor")];

// Public (no auth middleware) — Xero's own redirect hits this directly, protected by
// the one-time state token instead of a bearer token.
router.get("/callback", xeroController.callback);

router.get("/connect", ...superAdminOnly, xeroController.getConnectUrl);
router.get("/status", ...superAdminOnly, xeroController.getStatus);
router.post("/disconnect", ...superAdminOnly, xeroController.disconnect);

router.get("/accounts", ...superAdminOnly, xeroController.getAccountMap);
router.post("/accounts/validate", ...superAdminOnly, xeroController.validateAccounts);
router.post("/accounts/create-missing", ...superAdminOnly, xeroController.createMissingAccounts);

router.get("/sync-log", ...superAdminOnly, xeroController.getSyncLog);
router.post("/sync-log/:id/retry", ...superAdminOnly, xeroController.retrySyncLog);

module.exports = router;
