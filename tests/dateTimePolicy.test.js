const assert = require('assert');
const { getTimeOfDay } = require('../src/lib/timeOfDay');

// ISO-8601 UTC strings in the canonical format sort chronologically.
const values = [
  '2026-09-21T12:00:00.000Z',
  '2026-09-21T12:00:01.000Z',
  '2026-09-21T13:00:00.000Z',
];
assert.deepStrictEqual([...values].sort(), values);

assert.strictEqual(getTimeOfDay(new Date('2026-09-21T00:00:00.000Z'), 'Asia/Kolkata'), 'morning');
assert.strictEqual(getTimeOfDay(new Date('2026-09-21T07:00:00.000Z'), 'Asia/Kolkata'), 'afternoon');
assert.strictEqual(getTimeOfDay(new Date('2026-09-21T12:00:00.000Z'), 'Asia/Kolkata'), 'evening');
assert.strictEqual(getTimeOfDay(new Date('2026-09-21T18:00:00.000Z'), 'Asia/Kolkata'), 'night');

console.log('date/time policy tests passed');
