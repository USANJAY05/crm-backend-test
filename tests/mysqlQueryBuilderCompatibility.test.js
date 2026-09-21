// Static compatibility contract for the MySQL query-builder shim.
// This test does not require a live MySQL server.
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../src/db/adapters/mysql'), 'utf8');

test('query builder implements repository compatibility operators', () => {
  for (const method of ['eq(', 'neq(', 'is(', 'in(', 'gt(', 'gte(', 'lte(', 'ilike(', 'match(', 'not(', 'filter(', 'or(', 'range(', 'single(', 'maybeSingle(']) {
    expect(src).toContain(method);
  }
});

test('mysql adapter has no PostgreSQL-only SQL operators', () => {
  expect(src).not.toMatch(/\bRETURNING\b|\bILIKE\b|\bON CONFLICT\b|\bANY\s*\(/i);
});
