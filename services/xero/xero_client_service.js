"use strict";

const { XeroClient } = require("xero-node");
const crypto = require("crypto");
const XeroConnection = require("../../models/xero/xero_connection.model");
const tokenCrypto = require("../../utils/xero_token_crypto");

const SCOPES = (process.env.XERO_SCOPES || "").trim().split(/\s+/).filter(Boolean);

function baseClient() {
  return new XeroClient({
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUris: [process.env.XERO_REDIRECT_URI],
    scopes: SCOPES,
  });
}

// In-memory CSRF state store for the connect->callback round trip.
// A single super-admin-only "Connect to Xero" flow, short-lived (a few minutes) —
// no need for a DB table for this.
const pendingStates = new Map(); // state -> { userId, createdAt }

function createConnectState(userId) {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { userId, createdAt: Date.now() });
  // Expire stray states after 10 minutes so the map never grows unbounded.
  setTimeout(() => pendingStates.delete(state), 10 * 60 * 1000).unref();
  return state;
}

function consumeConnectState(state) {
  const entry = pendingStates.get(state);
  if (entry) pendingStates.delete(state);
  return entry || null;
}

async function getAuthUrl(userId) {
  const client = baseClient();
  await client.initialize();
  const state = createConnectState(userId);
  return client.buildConsentUrl(state);
}

function tokenSetFromConnection(conn) {
  return {
    access_token: tokenCrypto.decrypt(conn.access_token_enc),
    refresh_token: tokenCrypto.decrypt(conn.refresh_token_enc),
    id_token: conn.id_token_enc ? tokenCrypto.decrypt(conn.id_token_enc) : undefined,
    token_type: "Bearer",
    expires_at: Math.floor(new Date(conn.expires_at).getTime() / 1000),
    scope: (conn.scopes || []).join(" "),
  };
}

async function persistTokenSet(conn, tokenSet) {
  conn.access_token_enc = tokenCrypto.encrypt(tokenSet.access_token);
  conn.refresh_token_enc = tokenCrypto.encrypt(tokenSet.refresh_token);
  conn.id_token_enc = tokenSet.id_token ? tokenCrypto.encrypt(tokenSet.id_token) : null;
  conn.expires_at = new Date(
    (tokenSet.expires_at ? tokenSet.expires_at * 1000 : Date.now() + 30 * 60 * 1000),
  );
  conn.status = "connected";
  conn.last_error = null;
  await conn.save();
}

// Exchanges the authorization code (full callback URL) for tokens, resolves the
// connected tenant, and stores/updates the singleton XeroConnection document.
async function handleCallback(fullCallbackUrl, state) {
  const entry = consumeConnectState(state);
  if (!entry) {
    throw new Error("Invalid or expired Xero connect session — please click Connect to Xero again.");
  }

  const client = baseClient();
  await client.initialize();
  const tokenSet = await client.apiCallback(fullCallbackUrl);
  await client.updateTenants(false);

  const tenant = client.tenants && client.tenants[0];
  if (!tenant) {
    throw new Error("No Xero organisation was authorised for this app.");
  }

  let conn = await XeroConnection.findOne({});
  if (!conn) conn = new XeroConnection({});

  conn.tenant_id = tenant.tenantId;
  conn.tenant_name = tenant.tenantName;
  conn.scopes = SCOPES;
  conn.connected_by = entry.userId;
  conn.connected_at = new Date();
  conn.disconnected_at = null;

  await persistTokenSet(conn, tokenSet);
  return conn;
}

// Returns { accountingApi, tenantId } with a guaranteed-fresh access token.
// Every sync/service function should call this right before making a Xero API call.
async function getAuthenticatedClient() {
  const conn = await XeroConnection.findOne({ status: "connected" });
  if (!conn) {
    throw new Error("Xero is not connected. Connect it from Super Admin > Xero Integration first.");
  }

  const client = baseClient();
  await client.initialize();
  client.setTokenSet(tokenSetFromConnection(conn));

  const current = client.readTokenSet();
  if (current.expired()) {
    try {
      const refreshed = await client.refreshWithRefreshToken(
        process.env.XERO_CLIENT_ID,
        process.env.XERO_CLIENT_SECRET,
        current.refresh_token,
      );
      client.setTokenSet(refreshed);
      await persistTokenSet(conn, refreshed);
    } catch (err) {
      conn.status = "error";
      conn.last_error = `Token refresh failed: ${err.message}`;
      await conn.save();
      throw new Error("Xero connection has expired and could not refresh automatically. Please reconnect.");
    }
  }

  return { accountingApi: client.accountingApi, tenantId: conn.tenant_id };
}

async function getConnectionStatus() {
  const conn = await XeroConnection.findOne({}).populate("connected_by", "first_name last_name email");
  if (!conn) return { connected: false };
  return {
    connected: conn.status === "connected",
    status: conn.status,
    tenant_name: conn.tenant_name,
    connected_by: conn.connected_by,
    connected_at: conn.connected_at,
    last_error: conn.last_error,
  };
}

async function disconnect() {
  const conn = await XeroConnection.findOne({});
  if (!conn) return;
  try {
    const client = baseClient();
    await client.initialize();
    client.setTokenSet(tokenSetFromConnection(conn));
    await client.revokeToken();
  } catch (err) {
    console.error("Xero revokeToken failed (continuing local disconnect):", err.message);
  }
  conn.status = "disconnected";
  conn.disconnected_at = new Date();
  await conn.save();
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getAuthenticatedClient,
  getConnectionStatus,
  disconnect,
};
