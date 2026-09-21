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

  test('JSON object-key query accepts only application UUID lead IDs', () => {
    expect(repo).toContain('[db.claimAutoDialLead] invalid lead id');
  });
});
