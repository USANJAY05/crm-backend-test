const cron = require("node-cron");
const { schedules } = require("./definitions");
const { runSchedule } = require("./runner");
const { getLogger } = require("../observability/logger");
const log = getLogger("scheduler.local");

async function startLocalScheduler() {
  // app and scheduler both independently trigger schema migration on
  // require (see src/db/adapters/mysql.js's createTables()); this process
  // requires the db layer here — rather than only lazily inside
  // definitions.js's per-schedule run() closures — specifically so
  // migration starts as soon as the scheduler boots, and so every cron
  // schedule can be held off below until it has actually finished. Without
  // this, crm-auto-dial's 15-second tick could fire, and query tables,
  // while this same process's own schema migration was still mid-flight
  // on a separate pooled connection — a second, same-process source of
  // the lock contention this gate exists to close off (see
  // src/db/adapters/mysql.js's GET_LOCK/RELEASE_LOCK for the cross-process
  // half of the fix).
  const db = require("../db/repository");
  try {
    await db.ready;
  } catch (err) {
    log.error(`[scheduler] DB schema initialization failed — refusing to start cron schedules: ${err.message}`);
    throw err;
  }
  log.info("[scheduler] DB ready — registering cron schedules");

  const tasks = schedules.map((definition) => {
    if (!cron.validate(definition.expression)) {
      throw new Error(`[scheduler] invalid cron expression for ${definition.id}: ${definition.expression}`);
    }
    const task = cron.schedule(definition.expression, async () => {
      try {
        await runSchedule(definition.id);
      } catch (err) {
        if (err.code === "SCHEDULE_ALREADY_RUNNING") return;
        log.error(`Schedule ${definition.id} failed: ${err.message}`);
      }
    }, { name: definition.id, noOverlap: true });
    log.info(`Schedule registered: ${definition.id} (${definition.expression})`);
    return task;
  });

  const stop = () => tasks.forEach((task) => task.stop());
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return { stop };
}

module.exports = { startLocalScheduler };
