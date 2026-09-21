require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { validateRuntimeConfig } = require("./src/config/runtime");
validateRuntimeConfig(process.env, { mode: "scheduler" });
// Dedicated scheduler process. It owns timing only; API/worker processes
// never start cron timers.
const { startScheduler } = require("./src/scheduler");

startScheduler();
