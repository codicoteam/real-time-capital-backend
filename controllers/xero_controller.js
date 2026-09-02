"use strict";

const xeroClientService = require("../services/xero/xero_client_service");
const xeroAccountsService = require("../services/xero/xero_accounts_service");
const XeroSyncLog = require("../models/xero/xero_sync_log.model");

function frontendUrl(path) {
  const base = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

const xeroController = {
  // GET /api/v1/xero/connect — returns the Xero consent URL; the frontend navigates
  // the browser to it. Kept as a JSON response (not a server-side redirect) so the
  // Authorization header on this request can still authenticate the super admin —
  // a raw browser navigation to this endpoint would carry no auth header.
  async getConnectUrl(req, res) {
    try {
      const authUrl = await xeroClientService.getAuthUrl(String(req.user._id));
      res.json({ success: true, authUrl });
    } catch (error) {
      console.error("Xero getConnectUrl error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/v1/xero/callback — hit directly by Xero's browser redirect, no auth header.
  // Protected instead by the one-time `state` value minted in getConnectUrl.
  async callback(req, res) {
    try {
      const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
      await xeroClientService.handleCallback(fullUrl, req.query.state);
      return res.redirect(frontendUrl("/settings/xero?xero=connected"));
    } catch (error) {
      console.error("Xero callback error:", error);
      return res.redirect(frontendUrl(`/settings/xero?xero=error&message=${encodeURIComponent(error.message)}`));
    }
  },

  // GET /api/v1/xero/status
  async getStatus(req, res) {
    try {
      const status = await xeroClientService.getConnectionStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      console.error("Xero getStatus error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/v1/xero/disconnect
  async disconnect(req, res) {
    try {
      await xeroClientService.disconnect();
      res.json({ success: true, message: "Xero disconnected." });
    } catch (error) {
      console.error("Xero disconnect error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/v1/xero/accounts — current state of the account map (seeded on first call)
  async getAccountMap(req, res) {
    try {
      const rows = await xeroAccountsService.getAccountMap();
      res.json({ success: true, accounts: rows });
    } catch (error) {
      console.error("Xero getAccountMap error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/v1/xero/accounts/validate — read-only reconciliation against live Xero accounts
  async validateAccounts(req, res) {
    try {
      const checklist = await xeroAccountsService.validateChartOfAccounts();
      res.json({ success: true, accounts: checklist });
    } catch (error) {
      console.error("Xero validateAccounts error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/v1/xero/accounts/create-missing — explicit, super-admin-triggered creation
  async createMissingAccounts(req, res) {
    try {
      const result = await xeroAccountsService.createMissingAccounts();
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Xero createMissingAccounts error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // GET /api/v1/xero/sync-log?page=1&limit=20&status=failed
  async getSyncLog(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      if (req.query.event_type) filter.event_type = req.query.event_type;

      const [rows, total, pendingCount, failedCount] = await Promise.all([
        XeroSyncLog.find(filter)
          .sort({ created_at: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        XeroSyncLog.countDocuments(filter),
        XeroSyncLog.countDocuments({ status: "pending" }),
        XeroSyncLog.countDocuments({ status: "failed" }),
      ]);

      res.json({
        success: true,
        logs: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: { pending: pendingCount, failed: failedCount },
      });
    } catch (error) {
      console.error("Xero getSyncLog error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // POST /api/v1/xero/sync-log/:id/retry — flags one failed row for immediate retry;
  // picked up by the retry poller (added in a later phase alongside the event hooks).
  async retrySyncLog(req, res) {
    try {
      const row = await XeroSyncLog.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: "Sync log entry not found." });
      row.status = "pending";
      row.next_retry_at = new Date();
      await row.save();
      res.json({ success: true, log: row });
    } catch (error) {
      console.error("Xero retrySyncLog error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
};

module.exports = xeroController;
