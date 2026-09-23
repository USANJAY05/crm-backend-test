require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { validateRuntimeConfig } = require("./src/config/runtime");
validateRuntimeConfig(process.env, { mode: "scheduler" });
// Dedicated scheduler process. It owns timing only; API/worker processes
// never start cron timers.
const { startScheduler } = require("./src/scheduler");
const { getLogger } = require("./src/observability/logger");
const log = getLogger("scheduler.entrypoint");

// startScheduler() (local provider) now waits on DB schema-migration
// readiness before registering any cron schedule — see
// src/scheduler/localScheduler.js. If that readiness wait itself rejects
// (schema init failed), this process must not silently sit there with no
// jobs running; exit non-zero so the container orchestrator's restart/
// health-check behavior surfaces the failure instead of masking it as a
// scheduler that looks "up" but never dials anything.
startScheduler().catch((err) => {
  log.error(`Scheduler failed to start: ${err.message}`);
  process.exit(1);
});
