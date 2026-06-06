/* test/ai-ipc-remote-blocked.test.js
   Stage F — CF3: IPC pre-flight refuses non-loopback baseUrl without
   explicit MARKDOWN_AI_ALLOW_REMOTE=true opt-in.

   Contract:
   - Both 'ai:summarize-note' and 'ai:rewrite-text' return
     { ok:false, reason:'remote-blocked', message: <canned> } before any
     provider call when baseUrl is non-loopback AND allowRemote is not true.
   - When baseUrl is loopback (default), no pre-flight effect — works as v0.4.0.
   - When non-loopback AND allowRemote=true, request proceeds normally.
   - The provider must NEVER be invoked on the blocked path — verified by
     a provider stub that throws if called.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { register, registerRewrite, CHANNEL, REWRITE_CHANNEL } = require('../lib/ai-ipc');
const { REASON_MESSAGES } = require('../lib/ai-errors');

function makeIpc() {
  const handlers = new Map();
  return {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() {},
    invoke(channel, event, payload) {
      return handlers.get(channel)(event, payload);
    },
  };
}

let senderIdCounter = 0;
function makeFakeSender() {
  return { sender: { id: ++senderIdCounter, send() {} } };
}

const LOOPBACK_SETTINGS = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local',
  temperature: 0.2,
  maxTokens: 256,
  timeoutMs: 100,
  maxInputChars: 48000,
};

const REMOTE_SETTINGS = {
  ...LOOPBACK_SETTINGS,
  baseUrl: 'http://192.168.1.50:1234/v1',
};

const NEVER_CALL_PROVIDER = {
  summarize: async () => { throw new Error('provider must NOT be called on the remote-blocked path'); },
  streamSummarize: async () => { throw new Error('provider stream must NOT be called'); },
};

const HAPPY_PROVIDER = {
  summarize: async () => ({ summary: 'ok' }),
  streamSummarize: async () => ({ summary: 'ok-stream' }),
};

// ===== CF3.1 — Summarize pre-flight =====

test('CF3.1 non-loopback + no allowRemote → remote-blocked, no provider call', async () => {
  const ipc = makeIpc();
  register(ipc, { settings: REMOTE_SETTINGS, provider: NEVER_CALL_PROVIDER });
  const reply = await ipc.invoke(CHANNEL, makeFakeSender(), { text: 'note' });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'remote-blocked');
  assert.equal(reply.message, REASON_MESSAGES['remote-blocked']);
});

test('CF3.2 non-loopback + allowRemote=true → request proceeds (provider IS called)', async () => {
  const ipc = makeIpc();
  register(ipc, {
    settings: { ...REMOTE_SETTINGS, allowRemote: true },
    provider: HAPPY_PROVIDER,
  });
  const reply = await ipc.invoke(CHANNEL, makeFakeSender(), { text: 'note' });
  assert.deepEqual(reply, { ok: true, summary: 'ok' });
});

test('CF3.3 loopback (default) → no pre-flight effect (v0.4.0 behavior preserved)', async () => {
  const ipc = makeIpc();
  register(ipc, { settings: LOOPBACK_SETTINGS, provider: HAPPY_PROVIDER });
  const reply = await ipc.invoke(CHANNEL, makeFakeSender(), { text: 'note' });
  assert.deepEqual(reply, { ok: true, summary: 'ok' });
});

test('CF3.4 loopback + allowRemote=true → unchanged (flag is no-op when already local)', async () => {
  const ipc = makeIpc();
  register(ipc, {
    settings: { ...LOOPBACK_SETTINGS, allowRemote: true },
    provider: HAPPY_PROVIDER,
  });
  const reply = await ipc.invoke(CHANNEL, makeFakeSender(), { text: 'note' });
  assert.deepEqual(reply, { ok: true, summary: 'ok' });
});

test('CF3.5 non-loopback + allowRemote=false (explicit) → blocked', async () => {
  const ipc = makeIpc();
  register(ipc, {
    settings: { ...REMOTE_SETTINGS, allowRemote: false },
    provider: NEVER_CALL_PROVIDER,
  });
  const reply = await ipc.invoke(CHANNEL, makeFakeSender(), { text: 'note' });
  assert.equal(reply.reason, 'remote-blocked');
});

test('CF3.6 remote-blocked applies BEFORE empty-input check (defense order)', async () => {
  // Even with valid text, blocked. Even with empty text on a loopback URL,
  // not blocked. Verify both orderings.
  const ipc1 = makeIpc();
  register(ipc1, { settings: REMOTE_SETTINGS, provider: NEVER_CALL_PROVIDER });
  // Pick an order: empty-input on remote → should still emit some failure;
  // policy decision: remote-blocked wins because we don't want a remote
  // call attempted regardless of input shape. (No info leakage.)
  const blockedOnEmpty = await ipc1.invoke(CHANNEL, makeFakeSender(), { text: '' });
  assert.equal(blockedOnEmpty.reason, 'remote-blocked');
});

// ===== CF3.7 — Rewrite pre-flight (same shape) =====

test('CF3.7 Rewrite non-loopback + no allowRemote → remote-blocked', async () => {
  const ipc = makeIpc();
  registerRewrite(ipc, { settings: REMOTE_SETTINGS, provider: NEVER_CALL_PROVIDER });
  const reply = await ipc.invoke(REWRITE_CHANNEL, makeFakeSender(), { text: 'note' });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'remote-blocked');
});

test('CF3.8 Rewrite non-loopback + allowRemote=true → proceeds', async () => {
  const ipc = makeIpc();
  registerRewrite(ipc, {
    settings: { ...REMOTE_SETTINGS, allowRemote: true },
    provider: HAPPY_PROVIDER,
  });
  const reply = await ipc.invoke(REWRITE_CHANNEL, makeFakeSender(), { text: 'note' });
  assert.deepEqual(reply, { ok: true, summary: 'ok' });
});

// ===== CF3.9 — Canned message + isKnownReason =====

test('CF3.9 remote-blocked is a KNOWN_REASON with a canned message', () => {
  const { isKnownReason } = require('../lib/ai-errors');
  assert.equal(isKnownReason('remote-blocked'), true);
  assert.equal(typeof REASON_MESSAGES['remote-blocked'], 'string');
  assert.equal(REASON_MESSAGES['remote-blocked'].length > 0, true);
  // G4: message must NOT contain the user's baseUrl (no leak via canned).
  assert.equal(REASON_MESSAGES['remote-blocked'].includes('192.168'), false);
  assert.equal(REASON_MESSAGES['remote-blocked'].includes('http'), false);
});
