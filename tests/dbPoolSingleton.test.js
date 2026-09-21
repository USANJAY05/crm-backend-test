describe("database pool singleton", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.MYSQL_URL = "mysql://test:test@localhost:3306/test";
  });

  test("creates exactly one MySQL pool for the process", () => {
    const pools = [];
    jest.mock("mysql2/promise", () => ({
      createPool: jest.fn(() => {
        const p = { query: jest.fn(), getConnection: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
        pools.push(p); return p;
      })
    }));
    const first = require("../src/db/pool");
    const second = require("../src/db/pool");
    expect(first.pool).toBe(second.pool);
    expect(pools).toHaveLength(1);
  });

  test("closePool is idempotent", async () => {
    const end = jest.fn().mockResolvedValue(undefined);
    jest.mock("mysql2/promise", () => ({ createPool: jest.fn(() => ({ query: jest.fn(), getConnection: jest.fn(), end })) }));
    const { closePool } = require("../src/db/pool");
    await closePool();
    await closePool();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
