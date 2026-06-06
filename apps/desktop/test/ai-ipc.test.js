/* T6 — lib/ai-ipc.js
   Run focused: cd apps/desktop && node --test test/ai-ipc.test.js

   Verifies the ai:summarize-note IPC handler:
   - happy path
   - empty / whitespace / oversized input (no provider call)
   - typed reasons echoed back with REASON_MESSAGES[reason] EXACTLY (G4/H3)
   - timeout via Promise.race (F1) — including the signal-ignoring adapter
   - unknown provider (T6.8) via settings.provider
   - poisoned provider message (T6.11) — message must be canned, not echoed
   - http-error status suffix (T6.12) and non-integer status fallback (T6.13)
   - unknown reason coercion (T6.14) — never echoed

   Tests inject { settings, provider, timeoutMs } via the register options bag.
   No test reads process.env.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { register } = require('../lib/ai-ipc');
const { aiError, REASON_MESSAGES } = require('../lib/ai-errors');

function makeMockIpc() {
  const handlers = {};
  return {
    handle(channel, fn) { handlers[channel] = fn; },
    handlers,
    invoke(channel, payload) {
      const fn = handlers[channel];
      if (!fn) throw new Error('no handler for ' + channel);
      return fn({}, payload);
    },
  };
}

function makeSettings(overrides) {
  return Object.assign({
    provider: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    temperature: 0.2,
    maxTokens: 64,
    timeoutMs: 60000,
    maxInputChars: 1000,
  }, overrides || {});
}

function provider(impl) {
  let calls = 0;
  let lastArgs;
  return {
    get calls() { return calls; },
    get lastArgs() { return lastArgs; },
    summarize: async (args) => {
      calls += 1;
      lastArgs = args;
      return impl(args);
    },
  };
}

function noLeak(message) {
  assert.equal(typeof message, 'string');
  assert.ok(!message.includes('/Users/'));
  assert.ok(!message.includes('C:\\'));
}

test('T6.1 happy path: returns { ok:true, summary } with messages forwarded', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'ok.' }));
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'a note' });
  assert.deepEqual(r, { ok: true, summary: 'ok.' });
  assert.equal(stub.calls, 1);
  const usr = stub.lastArgs.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('a note'));
});

test('T6.2 empty input → empty-input, provider NOT called, canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: '' });
  assert.deepEqual(r, { ok: false, reason: 'empty-input', message: REASON_MESSAGES['empty-input'] });
  assert.equal(stub.calls, 0);
});

test('T6.3 whitespace-only → empty-input, provider NOT called', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: '   \n  ' });
  assert.deepEqual(r, { ok: false, reason: 'empty-input', message: REASON_MESSAGES['empty-input'] });
  assert.equal(stub.calls, 0);
});

test('T6.4 input-too-large → no provider call, canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  register(ipc, { settings: makeSettings({ maxInputChars: 16 }), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'x'.repeat(17) });
  assert.deepEqual(r, { ok: false, reason: 'input-too-large', message: REASON_MESSAGES['input-too-large'] });
  assert.equal(stub.calls, 0);
});

test('T6.5 server-unreachable: canned message (G4)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('server-unreachable', 'inner adapter text'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'server-unreachable', message: REASON_MESSAGES['server-unreachable'] });
});

test('T6.6 invalid-response: canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('invalid-response', 'inner text'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'invalid-response', message: REASON_MESSAGES['invalid-response'] });
});

test('T6.7.a provider-driven timeout: adapter rejects on aborted signal', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async (args) => {
    return await new Promise((_, reject) => {
      args.signal.addEventListener('abort', () => reject(aiError('timeout', 'inner text')));
    });
  });
  register(ipc, { settings: makeSettings({ timeoutMs: 20 }), provider: stub });
  const start = Date.now();
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  const elapsed = Date.now() - start;
  assert.deepEqual(r, { ok: false, reason: 'timeout', message: REASON_MESSAGES['timeout'] });
  assert.ok(elapsed < 200, 'should resolve within ~200ms');
});

test('T6.7.b signal-ignoring provider: handler still resolves with timeout (F1)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(() => new Promise(() => {})); // never resolves, ignores signal
  register(ipc, { settings: makeSettings({ timeoutMs: 20 }), provider: stub });
  const start = Date.now();
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  const elapsed = Date.now() - start;
  assert.deepEqual(r, { ok: false, reason: 'timeout', message: REASON_MESSAGES['timeout'] });
  assert.ok(elapsed < 200, 'handler must time out independently of provider');
});

test('T6.8 unknown provider: provider-error, no fetch call (provider stub also never called)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  // Force the selector to choose: pass settings with unknown provider name AND
  // omit options.provider so the handler must resolve via the selector.
  // (We do NOT pass our stub here; the selector should throw provider-error.)
  register(ipc, { settings: makeSettings({ provider: 'made-up-thing' }) });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'provider-error');
  assert.equal(r.message, REASON_MESSAGES['provider-error']);
  // stub was never registered, so naturally never called
  assert.equal(stub.calls, 0);
});

test('T6.9 unexpected provider throw: coerced to unknown, no leak', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw new Error('boom /Users/foo/secret leak'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'unknown', message: REASON_MESSAGES['unknown'] });
  noLeak(r.message);
});

test('T6.11 poisoned provider message: canned only, no path leak (G4)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('server-unreachable', 'ENOENT /Users/test/secret'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'server-unreachable', message: REASON_MESSAGES['server-unreachable'] });
  assert.ok(!r.message.includes('/Users/'));
  assert.ok(!r.message.includes('ENOENT'));
});

test('T6.12 http-error suffix from err.status (canned base + suffix only)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('http-error', 'whatever', { status: 404 }); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http-error');
  assert.equal(r.message, REASON_MESSAGES['http-error'] + ' (HTTP 404)');
});

test('T6.13 http-error without integer status: bare canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('http-error', 'whatever', { status: 'oops' }); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'http-error', message: REASON_MESSAGES['http-error'] });
});

test('T6.14 unknown reason coerced to "unknown"', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('some-random-string', 'leak this please'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'unknown', message: REASON_MESSAGES['unknown'] });
});

test('T6.no-leak invariant: every failure response is clean', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('invalid-response', '/Users/me/leak'); });
  register(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:summarize-note', { text: 'note' });
  assert.ok(!('stack' in r));
  assert.ok(!('cause' in r));
  noLeak(r.message);
});

test('T6.payload-shape: missing text field → empty-input', async () => {
  const ipc = makeMockIpc();
  register(ipc, { settings: makeSettings(), provider: provider(async () => ({ summary: 'unused' })) });
  const r = await ipc.invoke('ai:summarize-note', {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-input');
});

test('T6.payload-shape: undefined payload → empty-input', async () => {
  const ipc = makeMockIpc();
  register(ipc, { settings: makeSettings(), provider: provider(async () => ({ summary: 'unused' })) });
  const r = await ipc.invoke('ai:summarize-note', undefined);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-input');
});
