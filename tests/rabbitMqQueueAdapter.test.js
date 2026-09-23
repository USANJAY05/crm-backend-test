// Regression coverage for the scheduler-publishes / app-consumes split this
// deployment now relies on: scheduler.js only ever calls enqueue() and
// never process() (it owns timing, not workers — see server.js vs
// scheduler.js), which the memory adapter cannot support (each Node
// process gets its own isolated in-memory registry, so a process that
// never registered a handler gets "[queue] no processor registered for
// job type ... — call process() before enqueue()"). The RabbitMQ adapter
// is specifically built to allow this; these tests exercise the real
// adapter against a mocked amqplib, not a fake standing in for it.
describe("rabbitMqQueueAdapter", () => {
  let fakeChannel;
  let fakeConnection;
  let mockConnect;

  beforeEach(() => {
    jest.resetModules();

    fakeChannel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue(undefined),
      bindQueue: jest.fn().mockResolvedValue(undefined),
      prefetch: jest.fn().mockResolvedValue(undefined),
      sendToQueue: jest.fn((queue, body, opts, cb) => cb(null)),
      consume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    fakeConnection = {
      on: jest.fn(),
      createConfirmChannel: jest.fn().mockResolvedValue(fakeChannel),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockConnect = jest.fn().mockResolvedValue(fakeConnection);

    jest.mock("amqplib", () => ({ connect: (...args) => mockConnect(...args) }));
    process.env.RABBITMQ_URL = "amqp://test:test@rabbitmq:5672";
  });

  afterEach(async () => {
    delete process.env.RABBITMQ_URL;
  });

  test("a publisher-only process (scheduler's role) can enqueue without ever calling process()", async () => {
    const { createRabbitMqQueueAdapter } = require("../src/queue/adapters/rabbitMqQueueAdapter");
    const queue = createRabbitMqQueueAdapter();

    await queue.start(); // no process() call anywhere — mirrors scheduler.js

    // Must not throw — this is exactly what breaks under the memory adapter.
    expect(() => queue.enqueue("placeDial", { taskId: "TASK-mucnil3o-ts4f3k", leadId: "L-mucnil3o-ts4f3k" }))
      .not.toThrow();

    // enqueue() publishes asynchronously (fire-and-forget); let the
    // microtask/promise chain settle before asserting the publish happened.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockConnect).toHaveBeenCalledWith("amqp://test:test@rabbitmq:5672");
    expect(fakeChannel.assertQueue).toHaveBeenCalledWith("crm.placeDial", { durable: true });
    expect(fakeChannel.bindQueue).toHaveBeenCalledWith("crm.placeDial", "crm.jobs", "placeDial");
    expect(fakeChannel.sendToQueue).toHaveBeenCalledTimes(1);
    const [queueName, body] = fakeChannel.sendToQueue.mock.calls[0];
    expect(queueName).toBe("crm.placeDial");
    expect(JSON.parse(body.toString("utf8")).data).toEqual({
      taskId: "TASK-mucnil3o-ts4f3k",
      leadId: "L-mucnil3o-ts4f3k",
    });
  });

  test("a consumer process (app's role) registers a durable queue consumer via process()", async () => {
    const { createRabbitMqQueueAdapter } = require("../src/queue/adapters/rabbitMqQueueAdapter");
    const queue = createRabbitMqQueueAdapter();
    const handler = jest.fn().mockResolvedValue(undefined);

    queue.process("placeDial", handler, { concurrency: 5 });
    await queue.start(); // mirrors registerAutoDialWorker() -> server.js

    expect(fakeChannel.assertQueue).toHaveBeenCalledWith("crm.placeDial", { durable: true });
    expect(fakeChannel.assertQueue).toHaveBeenCalledWith("crm.placeDial.dead", { durable: true });
    expect(fakeChannel.bindQueue).toHaveBeenCalledWith("crm.placeDial", "crm.jobs", "placeDial");
    expect(fakeChannel.consume).toHaveBeenCalledWith("crm.placeDial", expect.any(Function), { noAck: false });
  });

  test("registering the same job type twice in one process still throws (no duplicate processors)", async () => {
    const { createRabbitMqQueueAdapter } = require("../src/queue/adapters/rabbitMqQueueAdapter");
    const queue = createRabbitMqQueueAdapter();
    queue.process("placeDial", jest.fn());
    expect(() => queue.process("placeDial", jest.fn())).toThrow(
      '[queue] processor for "placeDial" already registered'
    );
  });
});
