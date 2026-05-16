const test = require('node:test');
const assert = require('node:assert/strict');

const { ToolError, mapToolErrorToJsonRpc } = require('../lib/tool-error');

test('ToolError carries code, message, and is an Error', () => {
  const err = new ToolError('INVALID_PATH', 'bad path');
  assert.equal(err.code, 'INVALID_PATH');
  assert.equal(err.message, 'bad path');
  assert.equal(err.name, 'ToolError');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ToolError);
});

test('ToolError accepts optional data payload', () => {
  const err = new ToolError('STALE_GUARD', 'mismatch', { expected: 'a', actual: 'b' });
  assert.deepEqual(err.data, { expected: 'a', actual: 'b' });
});

test('mapToolErrorToJsonRpc maps ToolError to invalid-params with data.code', () => {
  const mapped = mapToolErrorToJsonRpc(new ToolError('INVALID_PATH', 'bad path'));
  assert.deepEqual(mapped, {
    code: -32602,
    message: 'bad path',
    data: { code: 'INVALID_PATH' }
  });
});

test('mapToolErrorToJsonRpc merges ToolError data fields into data', () => {
  const err = new ToolError('STALE_GUARD', 'mismatch', { expected: 'a', actual: 'b' });
  const mapped = mapToolErrorToJsonRpc(err);
  assert.deepEqual(mapped, {
    code: -32602,
    message: 'mismatch',
    data: { code: 'STALE_GUARD', expected: 'a', actual: 'b' }
  });
});

test('mapToolErrorToJsonRpc returns null for plain Error (preserves internal-error path)', () => {
  assert.equal(mapToolErrorToJsonRpc(new Error('boom')), null);
});

test('mapToolErrorToJsonRpc returns null for non-Error values', () => {
  assert.equal(mapToolErrorToJsonRpc('string'), null);
  assert.equal(mapToolErrorToJsonRpc(null), null);
  assert.equal(mapToolErrorToJsonRpc(undefined), null);
  assert.equal(mapToolErrorToJsonRpc({ code: 'X' }), null);
});
