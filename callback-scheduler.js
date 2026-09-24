require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const { validateRuntimeConfig } = require("./src/config/runtime");
const { startCallbackScheduler } = require("./src/scheduler/callbackScheduler");
const { getLogger } = require("./src/observability/logger");

validateRuntimeConfig(process.env, { mode: "scheduler" });
const log = getLogger("callback-scheduler.entrypoint");

let scheduler = null;

async function start() {
  scheduler = await startCallbackScheduler();

  const shutdown = async (signal) => {
    log.info(`Graceful callback-scheduler shutdown requested (${signal})`);
    try {
      await scheduler?.stop();
    } catch (err) {
      log.error(`Callback scheduler shutdown failed: ${err.message}`);
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  log.error(`Callback scheduler failed to start: ${err.message}`);
  process.exit(1);
});
