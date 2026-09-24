require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const cron = require("node-cron");
const { validateRuntimeConfig } = require("./src/config/runtime");
const { runRetentionCycle } = require("./src/platform/dataRetention");
const { getLogger } = require("./src/observability/logger");

validateRuntimeConfig(process.env, { mode: "scheduler" });
const log = getLogger("retention-worker");

let running = false;

async function run() {
  if (running) {
    log.warn("Retention cycle already running; skipping overlapping run.");
    return;
  }
  running = true;
  try {
    const results = await runRetentionCycle();
    log.info(`Retention cycle completed: organizations=${results.length}`);
  } catch (err) {
    log.error(`Retention cycle failed: ${err.message}`);
  } finally {
    running = false;
  }
}

// Daily cleanup at 03:00 server time. The worker also checks backup requests
// and scheduled backups in the same cycle.
cron.schedule("0 3 * * *", run);
run().catch((err) => log.error(`Initial retention cycle failed: ${err.message}`));

const shutdown = () => {
  log.info("Retention worker shutting down.");
  process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
