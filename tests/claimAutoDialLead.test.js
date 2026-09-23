describe("db.claimAutoDialLead", () => {
  const ORG_ID = "org-1";
  const TASK_ID = "TASK-mucnil3o-ts4f3k";
  const CLIENT_LEAD_ID = "L-mucnil3o-ts4f3k"; // frontend/src/lib/ids.ts:newClientId shape — not a UUID

  let connections;

  // Requiring src/db/repository (via src/db/client) triggers
  // src/db/adapters/mysql.js's createTables() in the background at
  // require time — it opens its own single pool.connect() connection and
  // runs many CREATE TABLE/ALTER TABLE queries on it, unrelated to
  // anything this suite exercises. A shared mock connection object would
  // let that unrelated traffic pollute this test's query-call
  // assertions, so getConnection() here hands out a fresh, independent
  // connection each call — claimAutoDialLead's own pool.connect() call
  // gets one nobody else ever touches.
  //
  // createTables() also GET_LOCKs before running any DDL (see
  // tests/mysqlSchemaMigrationLock.test.js) — a generic mock that returns
  // empty rows for every query would make that lock look un-acquired,
  // rejecting the module's top-level `ready` promise with nothing in this
  // file ever awaiting it, which surfaces as an unhandled rejection and
  // can crash the whole Jest run. Answering GET_LOCK realistically here
  // keeps that unrelated migration traffic a harmless no-op, same as it
  // was before the lock existed.
  function mockMakeConnection() {
    const conn = {
      query: jest.fn((sql) => {
        if (typeof sql === "string" && sql.includes("GET_LOCK")) {
          return Promise.resolve([[{ acquired: 1 }], undefined]);
        }
        return Promise.resolve([[], undefined]);
      }),
      release: jest.fn(),
    };
    connections.push(conn);
    return conn;
  }

  function connectionFor(sqlFragment) {
    return connections.find((c) => c.query.mock.calls.some(([sql]) => sql.includes(sqlFragment)));
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.MYSQL_URL = "mysql://test:test@localhost:3306/test";
    process.env.DB_ADAPTER = "mysql";

    connections = [];
    jest.mock("mysql2/promise", () => ({
      createPool: jest.fn(() => ({
        query: jest.fn().mockResolvedValue([[], undefined]),
        getConnection: jest.fn(() => Promise.resolve(mockMakeConnection())),
        end: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
      })),
    }));
  });

  test("rejects an empty/missing lead id without querying the database", async () => {
    const { claimAutoDialLead } = require("../src/db/repository");
    await expect(claimAutoDialLead(ORG_ID, TASK_ID, "")).rejects.toThrow(
      "[db.claimAutoDialLead] invalid lead id"
    );
    await expect(claimAutoDialLead(ORG_ID, TASK_ID, null)).rejects.toThrow(
      "[db.claimAutoDialLead] invalid lead id"
    );
    expect(connectionFor("UPDATE dialer_tasks")).toBeUndefined();
  });

  test("accepts a client-generated (non-UUID) lead id and scopes the claim to org_id", async () => {
    // UPDATE affects no rows in this fake pool, so the function returns
    // null after the claim attempt — what matters here is that it gets
    // past validation and issues the UPDATE at all, and that org_id is
    // still bound as a query parameter.
    const { claimAutoDialLead } = require("../src/db/repository");
    const result = await claimAutoDialLead(ORG_ID, TASK_ID, CLIENT_LEAD_ID);

    expect(result).toBeNull();
    const conn = connectionFor("UPDATE dialer_tasks");
    expect(conn).toBeDefined();
    expect(conn.query).toHaveBeenCalledTimes(1);
    // repository.js writes $1/$2/... placeholders; src/db/pool.js's
    // normalizeSql() rewrites them to native '?' before mysql2 ever sees
    // them, re-expanding each repeated placeholder positionally — org_id
    // ($1) and leadId ($3) each appear more than once in this query, so
    // the flattened params array repeats them accordingly.
    const [sql, params] = conn.query.mock.calls[0];
    expect(sql).toContain("UPDATE dialer_tasks");
    expect(sql).not.toContain("$1");
    expect(sql).not.toContain("$3");
    expect(params).toEqual([
      CLIENT_LEAD_ID, // SET current_lead_id = $3
      TASK_ID,        // WHERE id = $2
      ORG_ID,         // AND org_id = $1
      expect.any(String), // AND next_dial_at <= $4
      CLIENT_LEAD_ID, // EXISTS ... l.id = $3
      ORG_ID,         // AND l.org_id = $1
      CLIENT_LEAD_ID, // JSON_QUOTE($3)
    ]);
  });

  test("builds the call_results JSON path with JSON_QUOTE(?), not raw string concatenation", async () => {
    // Regression test for the "Invalid JSON path expression" failure a
    // hyphenated client-generated lead id (e.g. L-mucnil3o-ts4f3k) used to
    // trigger: CONCAT('$.', <leadId>, '.status') produces an unquoted
    // JSON path member name, which MySQL's JSON path grammar rejects for
    // any id containing '-'. JSON_QUOTE(...) wraps the id as a quoted
    // member name instead, which is valid for any string id.
    const { claimAutoDialLead } = require("../src/db/repository");
    await claimAutoDialLead(ORG_ID, TASK_ID, CLIENT_LEAD_ID);

    const [sql] = connectionFor("UPDATE dialer_tasks").query.mock.calls[0];
    expect(sql).toContain("CONCAT('$.', JSON_QUOTE(?), '.status')");
    expect(sql).not.toContain("CONCAT('$.', ?, '.status')");
  });
});
