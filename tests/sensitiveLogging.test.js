const assert = require('assert');
const { redact } = require('../src/observability/logger');
const { safeErrorMessage } = require('../src/observability/safeError');

const input = {
  password: 'super-secret',
  nested: { accessToken: 'jwt-secret', normal: 'ok' },
  authorization: 'Bearer abc.def.ghi',
  array: [{ client_secret: 'client-secret' }],
};
const output = redact(input);
assert.equal(output.password, '[REDACTED]');
assert.equal(output.nested.accessToken, '[REDACTED]');
assert.equal(output.authorization, '[REDACTED]');
assert.equal(output.array[0].client_secret, '[REDACTED]');
assert.equal(output.nested.normal, 'ok');
assert.match(redact('Authorization: Bearer abc.def'), /Bearer \[REDACTED\]/);
assert.equal(safeErrorMessage(new Error('SQL password=supersecret')), 'Internal server error');
assert.equal(safeErrorMessage(Object.assign(new Error('Invalid input'), { statusCode: 400, expose: true })), 'Invalid input');
assert.equal(safeErrorMessage(Object.assign(new Error('secret details'), { statusCode: 400 })), 'Internal server error');
console.log('sensitive logging/error tests passed');
