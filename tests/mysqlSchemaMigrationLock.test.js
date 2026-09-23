// Regression coverage for the cross-process schema-migration deadlock fix
// (src/db/adapters/mysql.js's createTables()). app and scheduler both
// independently require this module at boot; without serialization, both
// ran the full CREATE TABLE/ALTER TABLE/CREATE INDEX/ADD CONSTRAINT/
// feature-flag-UPDATE sequence concurrently and produced a real MySQL
// "Deadlock found when trying to get lock". createTables() now wraps that
// sequence in GET_LOCK()/RELEASE_LOCK() on a single dedicated connection.
//
// These tests exercise the real module (via its module-load side effect,
// `ready`) against a mocked mysql2 pool — they verify THIS process's own
// acquire -> migrate -> release protocol is correct. They cannot exercise
// MySQL's actual cross-connection lock queuing (that's a real MySQL
// server behavior, not app logic — GET_LOCK's documented semantics are
// trusted, not re-implemented here); the accompanying manual verification
// command in the writeup covers the real cross-process case.
describe("mysql.js schema migration advisory lock", () => {
  let connections;
  let mockGetLockResult; // 1 = acquired, 0 = timed out
  let mockFailOnSql; // optional: a substring that makes that query() call reject

  function mockMakeConnection() {
    const conn = {
      query: jest.fn((sql) => {
        if (typeof sql === "string" && sql.includes("GET_LOCK")) {
          return Promise.resolve([[{ acquired: mockGetLockResult }], undefined]);
        }
        if (mockFailOnSql && typeof sql === "string" && sql.includes(mockFailOnSql)) {
          return Promise.reject(new Error(`simulated failure for: ${mockFailOnSql}`));
        }
        return Promise.resolve([[], undefined]);
      }),
      release: jest.fn(),
    };
    connections.push(conn);
    return conn;
  }

  function callsContaining(fragment) {
    return connections.flatMap((c) => c.query.mock.calls).filter(([sql]) => sql.includes(fragment));
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.MYSQL_URL = "mysql://test:test@localhost:3306/test";
    process.env.DB_ADAPTER = "mysql";
    connections = [];
    mockGetLockResult = 1;
    mockFailOnSql = null;

    jest.mock("mysql2/promise", () => ({
      createPool: jest.fn(() => ({
        query: jest.fn().mockResolvedValue([[], undefined]),
        getConnection: jest.fn(() => Promise.resolve(mockMakeConnection())),
        end: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      })),
    }));
  });

  test("acquires GET_LOCK before any DDL and releases it after successful migration", async () => {
    const client = require("../src/db/adapters/mysql");
    await client.ready;

    const conn = connections[0];
    const calls = conn.query.mock.calls.map(([sql]) => sql);
    const lockIndex = calls.findIndex((sql) => sql.includes("GET_LOCK"));
    const releaseIndex = calls.findIndex((sql) => sql.includes("RELEASE_LOCK"));
    const firstDdlIndex = calls.findIndex((sql) => sql.includes("CREATE TABLE"));

    expect(lockIndex).toBe(0); // GET_LOCK is the very first statement on this connection
    expect(firstDdlIndex).toBeGreaterThan(lockIndex);
    expect(releaseIndex).toBeGreaterThan(firstDdlIndex); // released only after migration work ran
    expect(conn.release).toHaveBeenCalledTimes(1); // pooled connection still returned to the pool
  });

  test("releases the lock even when a migration statement fails, and surfaces the original error", async () => {
    mockFailOnSql = "CREATE TABLE";
    const client = require("../src/db/adapters/mysql");

    await expect(client.ready).rejects.toThrow("simulated failure for: CREATE TABLE");

    const conn = connections[0];
    expect(callsContaining("RELEASE_LOCK")).toHaveLength(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  test("aborts without running any DDL if GET_LOCK cannot be acquired, and does not call RELEASE_LOCK", async () => {
    mockGetLockResult = 0; // simulates another process holding the lock past the timeout
    const client = require("../src/db/adapters/mysql");

    await expect(client.ready).rejects.toThrow(/could not acquire schema migration lock/);

    expect(callsContaining("CREATE TABLE")).toHaveLength(0);
    // Never acquired -> must not attempt to release a lock this connection
    // doesn't hold.
    expect(callsContaining("RELEASE_LOCK")).toHaveLength(0);
    expect(connections[0].release).toHaveBeenCalledTimes(1);
  });
});
