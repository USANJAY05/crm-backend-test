const { safeErrorMessage } = require("../observability/safeError");
"use strict";

const crypto = require("crypto");
const router = require("express").Router();
const { runSchedule, listSchedules } = require("../scheduler/runner");
const { getLogger } = require("../observability/logger");

const log = getLogger("routes.scheduler");

function safeEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireSchedulerSecret(req, res, next) {
  const configured = String(process.env.SCHEDULER_TRIGGER_SECRET || "");
  if (!configured) return res.status(503).json({ error: "Scheduler trigger is not configured" });

  const provided = req.get("x-scheduler-secret") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!safeEqual(provided, configured)) return res.status(401).json({ error: "Invalid scheduler credentials" });
  next();
}

// A managed scheduler (for example OCI Resource Scheduler via OCI Functions) can call this endpoint in production.
// The endpoint only triggers pre-registered jobs; it cannot execute arbitrary code.
router.get("/internal/scheduler", requireSchedulerSecret, (_req, res) => {
  res.json({ schedules: listSchedules() });
});

router.post("/internal/scheduler/:id/run", requireSchedulerSecret, async (req, res) => {
  try {
    const result = await runSchedule(req.params.id);
    res.status(202).json({ accepted: true, ...result });
  } catch (err) {
    if (err.code === "UNKNOWN_SCHEDULE") return res.status(404).json({ error: safeErrorMessage(err) });
    if (err.code === "SCHEDULE_ALREADY_RUNNING") return res.status(409).json({ error: safeErrorMessage(err) });
    log.error(`Scheduler trigger failed for ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: "Scheduler execution failed" });
  }
});

module.exports = router;
