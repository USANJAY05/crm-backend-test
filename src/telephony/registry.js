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

// ── Register built-in connectors ─────────────────────────────────────────────
// To add a new telephony provider: create src/telephony/connectors/<name>.js
// and add a register() call here. Nothing else needs to change.
register(require("./connectors/gemini"));
register(require("./connectors/vobiz"));

module.exports = { register, get, all, handleUpgrade, buildRouter };
