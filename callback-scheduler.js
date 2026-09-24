require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const cron = require("node-cron");
const { validateRuntimeConfig } = require("./src/config/runtime");
const { listCallbackSchedules, runSchedule } = require("./src/scheduler/runner");
const db = require("./src/db/repository");
const { getLogger } = require("./src/observability/logger");

validateRuntimeConfig(process.env, { mode: "scheduler" });
const log = getLogger("callback-scheduler.entrypoint");
const provider = String(process.env.SCHEDULER_PROVIDER || "local").toLowerCase();
if (provider !== "local") {
  throw new Error(`[callback-scheduler] provider "${provider}" is managed externally; use the provider-specific trigger instead of starting this local container.`);
}

const schedules = listCallbackSchedules();
if (schedules.length !== 1 || schedules[0].id !== "crm-dialer-retry") {
  throw new Error("[callback-scheduler] expected exactly one callback schedule: crm-dialer-retry");
}

async function start() {
  // The callback schedule itself lives in MySQL call_logs. This readiness
  // gate only controls when polling begins; it never stores schedule state
  // in process memory.
  await db.ready;

  const tasks = schedules.map((definition) => {
    if (!cron.validate(definition.expression)) {
      throw new Error(`[callback-scheduler] invalid cron expression for ${definition.id}: ${definition.expression}`);
    }

    log.info(`Registering durable callback schedule ${definition.id} (${definition.expression})`);
    return cron.schedule(definition.expression, async () => {
      try {
        await runSchedule(definition.id);
      } catch (err) {
        if (err.code === "SCHEDULE_ALREADY_RUNNING") return;
        log.error(`Callback schedule ${definition.id} failed: ${err.message}`);
      }
    }, { name: definition.id, noOverlap: true });
  });

  const shutdown = async (signal) => {
    log.info(`Graceful callback-scheduler shutdown requested (${signal})`);
    tasks.forEach((task) => task.stop());
    try {
      await db.close();
    } catch (err) {
      log.error(`Callback scheduler DB shutdown failed: ${err.message}`);
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  log.info("Durable callback scheduler is running. Schedule state is stored in MySQL; no callback timing state is held in this process.");
}

start().catch((err) => {
  log.error(`Callback scheduler failed to start: ${err.message}`);
  process.exit(1);
});
