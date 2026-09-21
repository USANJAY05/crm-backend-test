// Central schedule registry. Business logic does not own timers.
// Each definition maps a stable schedule id to a handler function.
const schedules = [
  {
    id: "crm-auto-dial",
    expression: process.env.AUTO_DIAL_SCHEDULE || "*/15 * * * * *",
    run: async () => {
      const { processAutoDialTasks } = require("../crm/autoDialEngine");
      await processAutoDialTasks();
    },
  },
  {
    id: "crm-dialer-retry",
    expression: process.env.DIALER_RETRY_SCHEDULE || "*/5 * * * *",
    run: async () => {
      const { processDueRetries } = require("../crm/dialerRetryEngine");
      await processDueRetries();
    },
  },
];

module.exports = { schedules };
