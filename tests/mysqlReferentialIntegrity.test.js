const fs = require("fs");
const path = require("path");

describe("MySQL tenant referential integrity", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/db/adapters/mysql.js"), "utf8");

  test("creates tenant foreign keys to organizations", () => {
    expect(source).toContain("REFERENCES organizations(id) ON UPDATE CASCADE ON DELETE CASCADE");
    expect(source).toContain("referential-integrity check failed");
  });

  test("keeps the historical cost archive outside the tenant FK", () => {
    expect(source).toContain('table !== "org_cost_archive"');
  });
});
