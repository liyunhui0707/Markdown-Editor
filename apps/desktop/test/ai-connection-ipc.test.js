/* test/ai-connection-ipc.test.js
   Stage C-2 — CS7: ai:test-connection IPC.

   registerTestConnection(ipc, { provider, env, settingsPath, timeoutMs }) pings
   the endpoint's /models (via provider.listModels) and reports
   { ok, models?, error? }. It applies the SAME loopback/allow-remote gate as
   the request handlers, against the PENDING panel values in the payload
   { baseUrl, allowRemote } (so the user can test before saving). error is
   always app-controlled canned text — provider-supplied messages are never
   echoed (G4). Never throws across IPC.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTestConnection, TEST_CHANNEL } = require('../lib/ai-connection-ipc');
const { REASON_MESSAGES, aiError } = require('../lib/ai-errors');

function harness({ provider, env = {}, settingsPath, timeoutMs } = {}) {
  const handlers = {};
  const ipc = { handle(ch, fn) { handlers[ch] = fn; } };
  registerTestConnection(ipc, { provider, env, settingsPath, timeoutMs });
  return { test: (payload) => handlers[TEST_CHANNEL](null, payload) };
}

function stub(listModels) { return { listModels }; }

test('CS7.1 success returns ok + models for a loopback URL', async () => {
  const h = harness({ provider: stub(async () => ({ models: ['a', 'b'] })) });
  const r = await h.test({ baseUrl: 'http://localhost:1234/v1' });
  assert.deepEqual(r, { ok: true, models: ['a', 'b'] });
});

test('CS7.2 invalid URL is rejected before any provider call', async () => {
  let called = false;
  const h = harness({ provider: stub(async () => { called = true; return { models: [] }; }) });
  const r = await h.test({ baseUrl: 'ftp://nope' });
  assert.equal(r.ok, false);
  assert.match(r.error, /valid/i);
  assert.equal(called, false);
});

test('CS7.3 non-loopback without allow → remote-blocked, no provider call', async () => {
  let called = false;
  const h = harness({ provider: stub(async () => { called = true; return { models: [] }; }) });
  const r = await h.test({ baseUrl: 'http://192.168.1.9:1234/v1', allowRemote: false });
  assert.equal(r.ok, false);
  assert.equal(r.error, REASON_MESSAGES['remote-blocked']);
  assert.equal(called, false);
});

test('CS7.4 non-loopback WITH allow → provider is called', async () => {
  const h = harness({ provider: stub(async () => ({ models: ['x'] })) });
  const r = await h.test({ baseUrl: 'http://192.168.1.9:1234/v1', allowRemote: true });
  assert.deepEqual(r, { ok: true, models: ['x'] });
});

test('CS7.5 loopback URL is allowed even without allowRemote', async () => {
  const h = harness({ provider: stub(async () => ({ models: ['m'] })) });
  const r = await h.test({ baseUrl: 'http://127.0.0.1:1234/v1' });
  assert.deepEqual(r, { ok: true, models: ['m'] });
});

test('CS7.6 provider server-unreachable → canned message', async () => {
  const h = harness({ provider: stub(async () => { throw aiError('server-unreachable', REASON_MESSAGES['server-unreachable']); }) });
  const r = await h.test({ baseUrl: 'http://localhost:1234/v1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, REASON_MESSAGES['server-unreachable']);
});

test('CS7.7 http-error includes the status suffix', async () => {
  const h = harness({ provider: stub(async () => { throw aiError('http-error', REASON_MESSAGES['http-error'], { status: 404 }); }) });
  const r = await h.test({ baseUrl: 'http://localhost:1234/v1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /\(HTTP 404\)$/);
});

test('CS7.8 provider-supplied error text is NOT echoed (G4)', async () => {
  const leak = 'SECRET internal stack trace at 0xdeadbeef';
  const h = harness({ provider: stub(async () => { throw aiError('invalid-response', leak); }) });
  const r = await h.test({ baseUrl: 'http://localhost:1234/v1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, REASON_MESSAGES['invalid-response']);
  assert.doesNotMatch(r.error, /SECRET/);
});

test('CS7.9 a hanging provider resolves to a timeout error', async () => {
  const h = harness({ provider: stub(() => new Promise(() => {})), timeoutMs: 20 });
  const r = await h.test({ baseUrl: 'http://localhost:1234/v1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, REASON_MESSAGES['timeout']);
});
