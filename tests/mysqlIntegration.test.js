/**
 * MySQL 8.4 integration coverage.
 *
 * Run against a disposable/isolated MySQL database only:
 *   MYSQL_URL='mysql://user:password@host:3306/chiefvoice_test' MYSQL_INTEGRATION_TESTS=1 npm run test:mysql
 *
 * The suite deliberately exercises the same adapter surface used by the
 * application rather than mocking mysql2. It covers schema creation,
 * JSON/array serialization, tenant/member writes, filtering/pagination,
 * updates/upserts, and transaction commit/rollback.
 */

const run = process.env.MYSQL_INTEGRATION_TESTS === "1";

(run ? describe : describe.skip)("MySQL 8.4 integration", () => {
  let db;
  let pool;

  const orgId = `itest-org-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const memberId = `itest-member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const leadIds = Array.from({ length: 3 }, (_, i) => `itest-lead-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`);

  beforeAll(async () => {
    if (!process.env.MYSQL_URL) throw new Error("MYSQL_URL is required");
    db = require("../src/db/adapters/mysql");
    pool = require("../src/db/pool").pool;
    await db.ready;
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await pool.query("DELETE FROM leads WHERE org_id = ?", [orgId]);
      await pool.query("DELETE FROM org_members WHERE id = ?", [memberId]);
      await pool.query("DELETE FROM organizations WHERE id = ?", [orgId]);
    } finally {
      await db.close();
    }
  });

  test("creates the expected MySQL schema including org member phone", async () => {
    const [columns] = await require("mysql2/promise").createConnection(process.env.MYSQL_URL).then(async (conn) => {
      try {
        const [rows] = await conn.query(
          "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'org_members' AND COLUMN_NAME = 'phone'"
        );
        return [rows];
      } finally {
        await conn.end();
      }
    });
    expect(columns).toHaveLength(1);
  });

  test("supports tenant-scoped JSON, arrays, member phone, filters and pagination", async () => {
    const organization = await db.from("organizations").insert({
      id: orgId,
      name: `Integration ${orgId}`,
      workspace_name: `Workspace ${orgId}`,
      industry: "insurance",
      subscription_plan: "Starter",
      settings: { callingWindow: { start: "09:00", end: "18:00" } },
      feature_flags: ["leads", "pipeline"],
    }).single();

    expect(organization.error).toBeNull();
    expect(organization.data.settings.callingWindow.start).toBe("09:00");
    expect(organization.data.feature_flags).toEqual(["leads", "pipeline"]);

    const member = await db.from("org_members").insert({
      id: memberId,
      org_id: orgId,
      email: `itest-${Date.now()}@example.com`,
      name: "Integration User",
      phone: "+919999999999",
      role: "Organization Admin",
      feature_flags: ["leads"],
    }).single();

    expect(member.error).toBeNull();
    expect(member.data.phone).toBe("+919999999999");

    for (let i = 0; i < leadIds.length; i += 1) {
      const result = await db.from("leads").insert({
        id: leadIds[i],
        org_id: orgId,
        name: `Lead ${i}`,
        phone: `+919999999${String(900 + i)}`,
        tags: ["integration", `tag-${i}`],
        financial_info: { income: 50000 + i },
      }).single();
      expect(result.error).toBeNull();
    }

    const page = await db.from("leads")
      .select("*")
      .eq("org_id", orgId)
      .order("name", { ascending: true })
      .range(0, 1);

    expect(page.error).toBeNull();
    expect(page.data).toHaveLength(2);
    expect(page.data[0].tags).toEqual(["integration", "tag-0"]);

    const filtered = await db.from("leads")
      .select("*")
      .eq("org_id", orgId)
      .ilike("name", "%Lead 1%");

    expect(filtered.error).toBeNull();
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].name).toBe("Lead 1");
  });

  test("supports update and upsert semantics", async () => {
    const updated = await db.from("leads")
      .update({ status: "qualified", notes: "updated by integration test" })
      .eq("id", leadIds[0])
      .eq("org_id", orgId)
      .single();

    expect(updated.error).toBeNull();
    expect(updated.data.status).toBe("qualified");

    const upserted = await db.from("leads").upsert({
      id: leadIds[0],
      org_id: orgId,
      name: "Lead 0 Updated",
      status: "converted",
    }).single();

    expect(upserted.error).toBeNull();
    expect(upserted.data.name).toBe("Lead 0 Updated");
    expect(upserted.data.status).toBe("converted");
  });

  test("supports transaction commit and rollback", async () => {
    const conn = await pool.connect();
    const rollbackId = `itest-rollback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const commitId = `itest-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      await conn.begin();
      await conn.query(
        "INSERT INTO leads (id, org_id, name) VALUES (?, ?, ?)",
        [rollbackId, orgId, "Should Roll Back"]
      );
      await conn.rollback();

      const rolledBack = await pool.query("SELECT id FROM leads WHERE id = ?", [rollbackId]);
      expect(rolledBack.rows).toHaveLength(0);

      await conn.begin();
      await conn.query(
        "INSERT INTO leads (id, org_id, name) VALUES (?, ?, ?)",
        [commitId, orgId, "Should Commit"]
      );
      await conn.commit();

      const committed = await pool.query("SELECT id FROM leads WHERE id = ?", [commitId]);
      expect(committed.rows).toHaveLength(1);

      await pool.query("DELETE FROM leads WHERE id = ?", [commitId]);
    } finally {
      conn.release();
    }
  });
});
