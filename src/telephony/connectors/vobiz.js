// src/telephony/connectors/vobiz.js — Vobiz.ai telephony connector
//
// Handles:
//   HTTP  /api/vobiz/incoming, /api/vobiz/machine-detection,
//         /api/vobiz/call, /api/vobiz/hangup
//   WS    /vobiz/stream          (production pipeline)
//         /vobiz/stream-cascaded (experimental, only when CASCADED_PIPELINE_TEST_NUMBER is set)

const { WebSocketServer } = require("ws");
const { incrementSessions, decrementSessions } = require("../../shared");
const { handleVobizSession, verifyVobizStreamToken, triggerVobizOutboundCall, hangupVobizCall } = require("../vobizProxy");
const { handleVobizSessionCascaded } = require("../vobizPipelineCascaded");
const { getLogger } = require("../../observability/logger");
const log = getLogger("telephony.connectors.vobiz");

// ── WebSocket servers ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
const wssCascaded = new WebSocketServer({ noServer: true });

function reject(socket, status = 401, message = "Unauthorized") {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function authorizeStream(request) {
  try {
    const url = new URL(request.url, "http://localhost");
    const context = verifyVobizStreamToken(url.searchParams.get("stream_token"));
    if (!context) return false;
    request.vobizCallId = context.callId;
    request.vobizOrgId = context.orgId;
    return !!context.orgId;
  } catch { return false; }
}

wss.on("connection", (ws, req) => {
  incrementSessions();
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  log.info(`📞 [vobiz] call connected from ${ip} | Active: ${require("../../shared").getActiveSessionsCount()}`);
  Promise.resolve(handleVobizSession(ws, req.vobizStreamContext)).catch((err) => {
    log.error("❌ [vobiz] stream initialization failed:", err.message);
    try { ws.close(1011, "Stream initialization failed"); } catch {}
  });
  ws.on("close", () => {
    decrementSessions();
    log.info(`📞 [vobiz] call disconnected | Active: ${require("../../shared").getActiveSessionsCount()}`);
  });
});

wssCascaded.on("connection", (ws, req) => {
  log.info("🧪 [vobiz] cascaded-pipeline test call connected");
  handleVobizSessionCascaded(ws, req.vobizStreamContext);
});

// ── Connector interface ──────────────────────────────────────────────────────

module.exports = {
  name: "vobiz",
  label: "Vobiz.ai",
  wsPaths: ["/vobiz/stream", "/vobiz/stream-cascaded"],

  handleUpgrade(request, socket, head, pathname) {
    if (!authorizeStream(request)) return reject(socket);
    request.vobizStreamContext = { callId: request.vobizCallId, orgId: request.vobizOrgId };
    if (pathname === "/vobiz/stream") {
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    } else if (pathname === "/vobiz/stream-cascaded") {
      wssCascaded.handleUpgrade(request, socket, head, (ws) => wssCascaded.emit("connection", ws, request));
    }
  },

  getRouter() {
    const router = require("express").Router();
    router.use("/api/vobiz", require("../../routes/vobiz"));
    return router;
  },

  async triggerOutboundCall(orgId, phoneNumber, options = {}) {
    return triggerVobizOutboundCall(orgId, phoneNumber, options);
  },

  async hangupCall(callSid, orgId) {
    return hangupVobizCall(callSid, orgId);
  },
};
