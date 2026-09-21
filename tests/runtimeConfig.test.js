const { validateRuntimeConfig } = require("../src/config/runtime");

describe("runtime configuration", () => {
  test("requires MYSQL_URL", () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: "development", QUEUE_PROVIDER: "memory" }, { mode: "api" }))
      .toThrow(/MYSQL_URL is required/);
  });

  test("requires RabbitMQ URL when RabbitMQ is selected", () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: "development", MYSQL_URL: "mysql://x", QUEUE_PROVIDER: "rabbitmq" }, { mode: "api" }))
      .toThrow(/RABBITMQ_URL is required/);
  });

  test("rejects local scheduler in production", () => {
    expect(() => validateRuntimeConfig({ NODE_ENV: "production", MYSQL_URL: "mysql://x", QUEUE_PROVIDER: "rabbitmq", RABBITMQ_URL: "amqp://x", ALLOWED_ORIGINS: "https://crm.example.com", SCHEDULER_PROVIDER: "local" }, { mode: "scheduler" }))
      .toThrow(/not allowed in production/);
  });

  test("accepts production EventBridge configuration", () => {
    expect(validateRuntimeConfig({ NODE_ENV: "production", MYSQL_URL: "mysql://x", QUEUE_PROVIDER: "rabbitmq", RABBITMQ_URL: "amqp://x", ALLOWED_ORIGINS: "https://crm.example.com", SCHEDULER_PROVIDER: "eventbridge" }, { mode: "scheduler" }).schedulerProvider)
      .toBe("eventbridge");
  });
});
