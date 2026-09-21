const cron = require("node-cron");
const { schedules } = require("./definitions");
const { runSchedule } = require("./runner");
const { getLogger } = require("../observability/logger");
const log = getLogger("scheduler.local");

function startLocalScheduler() {
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
