const assert = require('node:assert/strict');
const { normalizeSql } = require('../src/db/pool');

describe('MySQL concurrency claim invariants', () => {
  test('auto-dial claim SQL contains tenant-safe lead ownership check', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../src/db/repository'), 'utf8');
    assert.match(src, /EXISTS \(SELECT 1 FROM leads AS l WHERE l\.id = \$3 AND l\.org_id = \$1\)/);
    assert.match(src, /current_lead_id IS NULL/);
    assert.match(src, /affectedRows.*rowCount/);
  });

  test('retry claim uses compare-and-set semantics', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../src/db/repository'), 'utf8');
    assert.match(src, /c\.retry_status = 'pending'/);
    assert.match(src, /affectedRows.*rowCount/);
  });

  test('transaction placeholders remain deterministic', () => {
    const q = normalizeSql('UPDATE x SET a=$2 WHERE id=$1', ['id-1', 'value']);
    assert.equal(q.sql, 'UPDATE x SET a=? WHERE id=?');
    assert.deepEqual(q.params, ['value', 'id-1']);
  });
});
