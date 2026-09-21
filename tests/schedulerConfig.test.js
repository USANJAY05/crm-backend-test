const { validateRuntimeConfig } = require("../src/config/runtime");

describe("scheduler production configuration", () => {
  test("requires EventBridge instead of local cron in production", () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: "production",
      MYSQL_URL: "mysql://db",
      QUEUE_PROVIDER: "rabbitmq",
      RABBITMQ_URL: "amqp://rabbit",
      SCHEDULER_PROVIDER: "local",
      ALLOWED_ORIGINS: "https://app.example.com",
      SCHEDULER_TRIGGER_SECRET: "secret"
    }, { mode: "scheduler" })).toThrow(/not allowed in production/);
  });

  test("requires scheduler trigger secret for production API", () => {
    expect(() => validateRuntimeConfig({
      NODE_ENV: "production",
      MYSQL_URL: "mysql://db",
      QUEUE_PROVIDER: "rabbitmq",
      RABBITMQ_URL: "amqp://rabbit",
      ALLOWED_ORIGINS: "https://app.example.com"
    }, { mode: "api" })).toThrow(/SCHEDULER_TRIGGER_SECRET/);
  });
});
