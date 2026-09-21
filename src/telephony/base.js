// src/telephony/base.js — Telephony connector interface
//
// Every connector MUST implement the properties and methods marked [required].
// Methods marked [optional] are called only if the connector defines them.
//
// To add a new provider:
//   1. Create src/telephony/connectors/<name>.js implementing this interface.
//   2. require() and register() it in src/telephony/registry.js.
//   That's it — no changes to server.js, routes/index.js, or any other file.
//
// ─────────────────────────────────────────────────────────────────────────────
// Example skeleton:
//
//   const { WebSocketServer } = require("ws");
//   const { incrementSessions, decrementSessions } = require("../shared");
//
//   const wss = new WebSocketServer({ noServer: true });
//   wss.on("connection", (ws, req) => {
//     incrementSessions();
//     // … handle media stream …
//     ws.on("close", decrementSessions);
//   });
//
//   module.exports = {
//     name: "myprovider",                        // [required] unique slug
//     label: "My Provider",                      // [required] human-readable
//     wsPaths: ["/myprovider/stream"],            // [required] WS paths this connector handles
//
//     handleUpgrade(request, socket, head, pathname) {  // [required]
//       wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
//     },
//
//     getRouter() {                               // [required] Express Router
//       const router = require("express").Router();
//       router.post("/api/myprovider/incoming", (req, res) => { … });
//       return router;
//     },
//   };
// ─────────────────────────────────────────────────────────────────────────────

// This file is documentation only — no runtime code exported.
module.exports = {};
