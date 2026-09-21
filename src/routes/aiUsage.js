// src/routes/aiUsage.js — /api/ai-usage
//
// Read-only reporting over ai_session_usage (see
// src/ai/geminiUsageTracker.js, which is the only writer). Every query is
// scoped by req.orgId from requireAuth — never a client-supplied org/admin
// id — so an admin can only ever see their own organization's usage,
// matching the tenant-isolation pattern every other route in this
// codebase already follows.
//
// Deliberately minimal: this is the backend foundation, not a billing
// dashboard. list + two aggregate summaries is what "cost per call, cost
// per admin, usage over time" reporting needs; the frontend can build a
// UI against this whenever that's actually wanted.

const { safeErrorMessage } = require("../observability/safeError");
const router = require("express").Router();
const { requireAuth } = require("../middleware/auth");
const db = require("../db/repository");
const { parsePagination } = require("../lib/pagination");

// GET /api/ai-usage — paginated list of this org's Gemini Live usage
// sessions, newest first (db.list's default ordering).
router.get("/", requireAuth, async (req, res) => {
  try {
    const pagination = parsePagination(req.query);
    const result = await db.list("aisessionusage", req.orgId, pagination || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// GET /api/ai-usage/summary — total calls/sessions/tokens/estimated cost
// for the org, optionally bounded by ?from=&to= (ISO dates). Every figure
// here is an application-level ESTIMATE (see docs/ai-usage-tracking.md) —
// never the authoritative Google Cloud invoice amount.
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const summary = await db.getAiUsageSummary(req.orgId, { fromIso: from || null, toIso: to || null });
    res.json({ ...summary, estimated: true });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

// GET /api/ai-usage/by-admin — same aggregate, broken down per admin_id —
// "cost per admin" reporting.
router.get("/by-admin", requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const rows = await db.getAiUsageByAdmin(req.orgId, { fromIso: from || null, toIso: to || null });
    res.json({ rows, estimated: true });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err) });
  }
});

module.exports = router;
