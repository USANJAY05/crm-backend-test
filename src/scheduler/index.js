const { startLocalScheduler } = require("./localScheduler");

function startScheduler() {
  const provider = (process.env.SCHEDULER_PROVIDER || "local").toLowerCase();
  if (provider === "local") return startLocalScheduler();
  if (provider === "eventbridge" || provider === "aws_eventbridge") {
    throw new Error("AWS EventBridge scheduler provider is reserved for production; deploy the EventBridge trigger instead of starting a local scheduler container.");
  }
  throw new Error(`[scheduler] unknown SCHEDULER_PROVIDER: ${provider}`);
}

module.exports = { startScheduler };
