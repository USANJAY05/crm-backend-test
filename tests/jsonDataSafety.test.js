const fs = require('fs');
const path = require('path');

describe('MySQL JSON data safety', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/db/adapters/mysql.js'), 'utf8');
  const repo = fs.readFileSync(path.join(__dirname, '..', 'src/db/repository.js'), 'utf8');

  test('JSON deserialization does not silently swallow malformed values', () => {
    expect(source).toContain('Invalid JSON in ${type} column');
    expect(source).not.toContain('catch (_) {}');
  });

  test('array columns enforce array values', () => {
    expect(source).toContain('JSON array column requires an array value');
  });

  test('JSON object-key query still rejects an empty/missing lead id', () => {
    // See tests/claimAutoDialLead.test.js for full behavioral coverage —
    // lead ids are client-generated (frontend/src/lib/ids.ts:newClientId),
    // not UUIDs, so this only guards against an empty leadId reaching the
    // JSON_EXTRACT path built via CONCAT('$.', $3, '.status').
    expect(repo).toContain('[db.claimAutoDialLead] invalid lead id');
    expect(repo).not.toMatch(/0-9a-f.*[1-5]\[0-9a-f\].*89ab/);
  });
});
