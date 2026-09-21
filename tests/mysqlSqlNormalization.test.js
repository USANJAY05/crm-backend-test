const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const source = fs.readFileSync(require.resolve("../src/db/pool.js"), "utf8");
const start = source.indexOf("function normalizeSql");
const end = source.indexOf("\nconst { getLogger }", start);
if (start < 0 || end < 0) throw new Error("normalizeSql function could not be located");
const context = {};
vm.runInNewContext(`${source.slice(start, end)}; globalThis.normalizeSql = normalizeSql;`, context);
const normalizeSql = context.normalizeSql;

const check = (sql, params, expected) => {
  assert.strictEqual(JSON.stringify(normalizeSql(sql, params)), JSON.stringify(expected));
};

check("SELECT $2, $1", ["a", "b"], { sql: "SELECT ?, ?", params: ["b", "a"] });
check("SELECT $1 WHERE x IN (?, ?)", ["org", "a", "b"], { sql: "SELECT ? WHERE x IN (?, ?)", params: ["org", "a", "b"] });
check("SELECT '$1', \"?\", `?`, ?", ["x"], { sql: "SELECT '$1', \"?\", `?`, ?", params: ["x"] });
check("SELECT $1, $1, ?", ["same", "next"], { sql: "SELECT ?, ?, ?", params: ["same", "same", "next"] });
assert.throws(() => normalizeSql("SELECT $2", ["only"]), /no matching parameter/);
assert.throws(() => normalizeSql("SELECT ?", ["a", "b"]), /parameter count mismatch/);

console.log("mysqlSqlNormalization.test.js: PASS");
