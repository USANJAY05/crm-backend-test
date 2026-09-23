// Regression coverage for gating scheduler startup on DB readiness
// (src/scheduler/localScheduler.js). Previously, cron.schedule() ran
// immediately on process boot, with nothing awaiting the db layer's
// schema-migration `ready` promise first — crm-auto-dial's 15-second tick
// could fire (and query tables) while this same process's own schema
// migration was still mid-flight on a separate pooled connection. These
// tests mock node-cron and src/db/repository directly (not MySQL) to
// verify the ordering contract: no cron.schedule() call happens before
// `db.ready` resolves, and a rejected `db.ready` must prevent every
// schedule from registering at all.
describe("localScheduler DB-readiness gate", () => {
  let mockCronSchedule;
  let mockReadyDeferred;

  function makeDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  beforeEach(() => {
    jest.resetModules();

    mockCronSchedule = jest.fn(() => ({ stop: jest.fn() }));
    jest.mock("node-cron", () => ({
      validate: jest.fn(() => true),
      schedule: (...args) => mockCronSchedule(...args),
    }));

    mockReadyDeferred = makeDeferred();
    jest.mock("../src/db/repository", () => ({ ready: mockReadyDeferred.promise }));
  });

  test("does not register any cron schedule until db.ready resolves", async () => {
    const { startLocalScheduler } = require("../src/scheduler/localScheduler");

    const startPromise = startLocalScheduler();

    // Readiness hasn't resolved yet — nothing may be registered.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockCronSchedule).not.toHaveBeenCalled();

    mockReadyDeferred.resolve();
    await startPromise;

    // Both schedules (crm-auto-dial, crm-dialer-retry) are now registered,
    // each with noOverlap still enabled.
    expect(mockCronSchedule).toHaveBeenCalled();
    for (const call of mockCronSchedule.mock.calls) {
      const opts = call[2];
      expect(opts.noOverlap).toBe(true);
    }
    const registeredIds = mockCronSchedule.mock.calls.map((call) => call[2].name);
    expect(registeredIds).toEqual(expect.arrayContaining(["crm-auto-dial", "crm-dialer-retry"]));
  });

  test("registers no cron schedule at all if db.ready rejects", async () => {
    const { startLocalScheduler } = require("../src/scheduler/localScheduler");

    const startPromise = startLocalScheduler();
    mockReadyDeferred.reject(new Error("schema migration failed"));

    await expect(startPromise).rejects.toThrow("schema migration failed");
    expect(mockCronSchedule).not.toHaveBeenCalled();
  });
});
