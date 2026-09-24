"use strict";

const { getLogger } = require("../observability/logger");
const log = getLogger("scheduler.callbackScheduler");

function getCallbackScheduler() {
  const provider = String(process.env.SCHEDULER_PROVIDER || "bullmq").toLowerCase();

  switch (provider) {
    case "bullmq":
      return require("./providers/bullmqCallbackScheduler").createBullMqCallbackScheduler();
    case "eventbridge":
      throw new Error("[callback-scheduler] eventbridge provider is not installed yet; use SCHEDULER_PROVIDER=bullmq until the AWS adapter is deployed.");
    case "local":
      throw new Error("[callback-scheduler] local cron provider has been retired. Use SCHEDULER_PROVIDER=bullmq.");
    default:
      throw new Error(`[callback-scheduler] unknown provider "${provider}". Supported: bullmq, eventbridge`);
  }
}

async function startCallbackScheduler() {
  const scheduler = getCallbackScheduler();
  await scheduler.start();
  log.info(`Callback scheduler provider started: ${scheduler.provider}`);
  return scheduler;
}

module.exports = { getCallbackScheduler, startCallbackScheduler };
