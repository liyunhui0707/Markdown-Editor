/* CA2 — lib/ai-ipc.js `registerRewrite` for 'ai:rewrite-text'
   Run focused: cd apps/desktop && node --test test/ai-ipc-rewrite.test.js

   Mirrors v0.2.0 test/ai-ipc.test.js (T6) shape verbatim — mockIpc + DI.
   The new registerRewrite handler is a DUPLICATE of register (per plan D1),
   differing only in: channel = 'ai:rewrite-text'; prompt built via
   buildRewritePrompt instead of buildSummaryPrompt.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerRewrite, REWRITE_CHANNEL } = require('../lib/ai-ipc');
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

test('CA2.0 REWRITE_CHANNEL is "ai:rewrite-text"', () => {
  assert.equal(REWRITE_CHANNEL, 'ai:rewrite-text');
});

test('CA2.1 happy path: returns { ok:true, summary } with rewrite-prompt messages forwarded', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'rewritten text' }));
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'paragraph to rewrite' });
  assert.deepEqual(r, { ok: true, summary: 'rewritten text' });
  assert.equal(stub.calls, 1);
  // Confirm the rewrite prompt was built (system message references rewriting).
  const sys = stub.lastArgs.messages.find((m) => m.role === 'system');
  assert.ok(sys.content.toLowerCase().includes('rewrit'));
  const usr = stub.lastArgs.messages.find((m) => m.role === 'user');
  assert.ok(usr.content.includes('paragraph to rewrite'));
  assert.ok(usr.content.includes('<text>'));
  assert.ok(usr.content.includes('</text>'));
});

test('CA2.2 empty input → empty-input, provider NOT called, canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: '' });
  assert.deepEqual(r, { ok: false, reason: 'empty-input', message: REASON_MESSAGES['empty-input'] });
  assert.equal(stub.calls, 0);
});

test('CA2.3 whitespace-only → empty-input, provider NOT called', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: '   \n  ' });
  assert.deepEqual(r, { ok: false, reason: 'empty-input', message: REASON_MESSAGES['empty-input'] });
  assert.equal(stub.calls, 0);
});

test('CA2.4 missing text field → empty-input', async () => {
  const ipc = makeMockIpc();
  registerRewrite(ipc, { settings: makeSettings(), provider: provider(async () => ({ summary: 'unused' })) });
  const r = await ipc.invoke('ai:rewrite-text', {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-input');
});

test('CA2.5 input-too-large → no provider call, canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => ({ summary: 'unused' }));
  registerRewrite(ipc, { settings: makeSettings({ maxInputChars: 16 }), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'x'.repeat(17) });
  assert.deepEqual(r, { ok: false, reason: 'input-too-large', message: REASON_MESSAGES['input-too-large'] });
  assert.equal(stub.calls, 0);
});

test('CA2.6 server-unreachable: canned message (G4 — no inner text echoed)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('server-unreachable', 'inner adapter text'); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'server-unreachable', message: REASON_MESSAGES['server-unreachable'] });
});

test('CA2.7 invalid-response: canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('invalid-response', 'inner text'); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'invalid-response', message: REASON_MESSAGES['invalid-response'] });
});

test('CA2.8 provider-driven timeout (signal.aborted)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async (args) => {
    return await new Promise((_, reject) => {
      args.signal.addEventListener('abort', () => reject(aiError('timeout', 'inner text')));
    });
  });
  registerRewrite(ipc, { settings: makeSettings({ timeoutMs: 20 }), provider: stub });
  const start = Date.now();
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  const elapsed = Date.now() - start;
  assert.deepEqual(r, { ok: false, reason: 'timeout', message: REASON_MESSAGES['timeout'] });
  assert.ok(elapsed < 200, 'should resolve within ~200ms');
});

test('CA2.9 signal-ignoring provider: handler still resolves with timeout (F1 regression)', async () => {
  const ipc = makeMockIpc();
  const stub = provider(() => new Promise(() => {})); // never resolves, ignores signal
  registerRewrite(ipc, { settings: makeSettings({ timeoutMs: 20 }), provider: stub });
  const start = Date.now();
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  const elapsed = Date.now() - start;
  assert.deepEqual(r, { ok: false, reason: 'timeout', message: REASON_MESSAGES['timeout'] });
  assert.ok(elapsed < 200, 'handler must time out independently of provider');
});

test('CA2.10 unknown provider error: coerced to "unknown", no leak', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw new Error('boom /Users/me/leak'); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'unknown', message: REASON_MESSAGES['unknown'] });
  noLeak(r.message);
});

test('CA2.11 http-error suffix from err.status', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('http-error', 'whatever', { status: 404 }); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http-error');
  assert.equal(r.message, REASON_MESSAGES['http-error'] + ' (HTTP 404)');
});

test('CA2.12 G4 no-leak invariant: every failure response is clean', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('invalid-response', '/Users/me/leak'); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.ok(!('stack' in r));
  assert.ok(!('cause' in r));
  noLeak(r.message);
});

test('CA2.13 [Q4] provider-error path (unknown provider name)', async () => {
  const ipc = makeMockIpc();
  // No options.provider injected — the selector resolves from settings.provider.
  registerRewrite(ipc, { settings: makeSettings({ provider: 'made-up-thing' }) });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'provider-error', message: REASON_MESSAGES['provider-error'] });
});

test('CA2.14 [Q4] unknown reason coerced', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('some-random-string', 'leak this please'); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'unknown', message: REASON_MESSAGES['unknown'] });
});

test('CA2.15 [Q4] http-error without integer status: bare canned message', async () => {
  const ipc = makeMockIpc();
  const stub = provider(async () => { throw aiError('http-error', 'whatever', { status: 'oops' }); });
  registerRewrite(ipc, { settings: makeSettings(), provider: stub });
  const r = await ipc.invoke('ai:rewrite-text', { text: 'note' });
  assert.deepEqual(r, { ok: false, reason: 'http-error', message: REASON_MESSAGES['http-error'] });
});

test('CA2.payload-shape: undefined payload → empty-input', async () => {
  const ipc = makeMockIpc();
  registerRewrite(ipc, { settings: makeSettings(), provider: provider(async () => ({ summary: 'unused' })) });
  const r = await ipc.invoke('ai:rewrite-text', undefined);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-input');
});
