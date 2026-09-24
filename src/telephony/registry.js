const { getLogger } = require("../observability/logger");
const log = getLogger("telephony.registry");
// src/telephony/registry.js — telephony connector registry
//
// Connectors register here once at startup. After that, server.js
// calls handleUpgrade() for all WebSocket upgrades, and routes/index.js
// mounts buildRouter() for all HTTP endpoints. Neither file needs to know
// which providers are active — that's entirely contained here.

const connectors = new Map(); // name → connector

function register(connector) {
  if (!connector.name || !connector.wsPaths || !connector.handleUpgrade || !connector.getRouter) {
    throw new Error(`[telephony/registry] connector "${connector.name || "?"}" is missing required fields (name, wsPaths, handleUpgrade, getRouter)`);
  }
  connectors.set(connector.name, connector);
  log.info(`📡 Registered telephony connector: ${connector.label || connector.name} (ws: ${connector.wsPaths.join(", ")})`);
}

function get(name) {
  return connectors.get(name);
}

function all() {
  return [...connectors.values()];
}

// Called from server.js's "upgrade" event handler.
// Returns true if a connector claimed the path, false if the socket should be destroyed.
function handleUpgrade(request, socket, head, pathname) {
  for (const connector of connectors.values()) {
    if (connector.wsPaths.includes(pathname)) {
      connector.handleUpgrade(request, socket, head, pathname);
      return true;
    }
  }
  return false;
}

// Returns a single Express Router that mounts every registered connector's routes.
// Called once from src/routes/index.js.
function buildRouter() {
  const router = require("express").Router();
  for (const connector of connectors.values()) {
    router.use("/", connector.getRouter());
  }
  return router;
}

function findConnector(name) {
  if (!name) return null;
  const direct = connectors.get(name);
  if (direct) return direct;
  const key = String(name).trim().toLowerCase();
  for (const [slug, connector] of connectors.entries()) {
    if (slug.toLowerCase() === key || (connector.label && connector.label.toLowerCase() === key)) {
      return connector;
    }
    if (key.includes(slug.toLowerCase()) || slug.toLowerCase().includes(key)) {
      return connector;
    }
  }
  return null;
}

function supportsOutbound(providerName) {
  const connector = findConnector(providerName);
  return typeof connector?.triggerOutboundCall === "function";
}

async function triggerOutboundCall(providerName, orgId, phoneNumber, options = {}) {
  const connector = findConnector(providerName);
  if (!connector || typeof connector.triggerOutboundCall !== "function") {
    throw new Error(`[telephony/registry] Telephony provider "${providerName}" is not registered or does not support outbound calls.`);
  }
  return connector.triggerOutboundCall(orgId, phoneNumber, options);
}

async function hangupCall(providerName, callSid, orgId) {
  const connector = findConnector(providerName);
  if (!connector || typeof connector.hangupCall !== "function") {
    log.warn(`⚠️ [telephony/registry] Cannot hang up call ${callSid}: provider "${providerName}" has no hangupCall implementation.`);
    return;
  }
  return connector.hangupCall(callSid, orgId);
}

// ── Register built-in connectors ─────────────────────────────────────────────
// To add a new telephony provider: create src/telephony/connectors/<name>.js
// and add a register() call here. Nothing else needs to change.
register(require("./connectors/gemini"));
register(require("./connectors/vobiz"));

module.exports = {
  register,
  get,
  all,
  handleUpgrade,
  buildRouter,
  findConnector,
  supportsOutbound,
  triggerOutboundCall,
  hangupCall,
};
