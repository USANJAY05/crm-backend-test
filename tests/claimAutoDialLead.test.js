describe("db.claimAutoDialLead", () => {
  const ORG_ID = "org-1";
  const TASK_ID = "TASK-mucnil3o-ts4f3k";
  const CLIENT_LEAD_ID = "L-mucnil3o-ts4f3k"; // frontend/src/lib/ids.ts:newClientId shape — not a UUID

  let mockConnection;

  beforeEach(() => {
    jest.resetModules();
    process.env.MYSQL_URL = "mysql://test:test@localhost:3306/test";
    process.env.DB_ADAPTER = "mysql";

    mockConnection = {
      query: jest.fn().mockResolvedValue([[], undefined]),
      release: jest.fn(),
    };
    jest.mock("mysql2/promise", () => ({
      createPool: jest.fn(() => ({
        query: jest.fn().mockResolvedValue([[], undefined]),
        getConnection: jest.fn().mockResolvedValue(mockConnection),
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
    expect(mockConnection.query).not.toHaveBeenCalled();
  });

  test("accepts a client-generated (non-UUID) lead id and scopes the claim to org_id", async () => {
    // UPDATE affects no rows in this fake pool, so the function returns
    // null after the claim attempt — what matters here is that it gets
    // past validation and issues the UPDATE at all, and that org_id is
    // still bound as a query parameter.
    const { claimAutoDialLead } = require("../src/db/repository");
    const result = await claimAutoDialLead(ORG_ID, TASK_ID, CLIENT_LEAD_ID);

    expect(result).toBeNull();
    expect(mockConnection.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockConnection.query.mock.calls[0];
    expect(sql).toContain("UPDATE dialer_tasks");
    expect(params).toEqual([ORG_ID, TASK_ID, CLIENT_LEAD_ID, expect.any(String)]);
  });
});
