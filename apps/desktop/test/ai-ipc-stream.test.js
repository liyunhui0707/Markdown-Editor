/* test/ai-ipc-stream.test.js
   CB4 + CB5 — Stage B: streaming IPC handler + registerCancel.

   Contract (plan §6 D2/D6/D7/D9 + §"Modified production" entry for ai-ipc.js):
   - `register` / `registerRewrite` take the STREAMING branch when:
       payload.chunkChannel != null
       && (settings.streaming ?? true) is truthy
       && typeof provider.streamSummarize === 'function'.
     Otherwise the v0.3.0 non-streaming path is taken byte-for-byte (T6/CA2).
   - Streaming branch wraps provider.streamSummarize with
     streamWithStallTimeout({ stallTimeoutMs, run }), pushes each chunk via
     event.sender.send(chunkChannel, { text }), and calls progress() BEFORE
     each send (F1 stall-timer reset).
   - chunkChannelControllers (module-scope Map<string, AbortController>) keyed
     by composite ${event.sender.id}:${chunkChannel}. Two senders with the
     same chunkChannel don't collide. (D7)
   - registerCancel(ipc) installs 'ai:cancel' listener; composite-key lookup;
     unknown chunkChannel is no-op. Idempotent.
   - G4 strict equality: every failure response has
     message === REASON_MESSAGES[reason] (+ ' (HTTP n)' for http-error).
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { register, registerRewrite, CHANNEL, REWRITE_CHANNEL } = require('../lib/ai-ipc');
const AiIpc = require('../lib/ai-ipc');
const { aiError, REASON_MESSAGES } = require('../lib/ai-errors');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeIpc() {
  const handlers = new Map();
  const onListeners = new Map();
  return {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, handler) {
      if (!onListeners.has(channel)) onListeners.set(channel, []);
      onListeners.get(channel).push(handler);
    },
    removeAllListeners(channel) { onListeners.delete(channel); },
    invoke(channel, event, payload) {
      const h = handlers.get(channel);
      if (!h) throw new Error('no handler for ' + channel);
      return h(event, payload);
    },
    send(channel, event, payload) {
      const listeners = onListeners.get(channel) || [];
      for (const l of listeners) l(event, payload);
    },
    _handlers: handlers,
    _onListeners: onListeners,
  };
}

let senderIdCounter = 0;
function makeFakeSender() {
  const sent = [];
  return {
    sender: {
      id: ++senderIdCounter,
      send(channel, payload) { sent.push({ channel, payload }); },
    },
    sent,
  };
}

const BASE_SETTINGS = {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  model: 'local',
  temperature: 0.2,
  maxTokens: 256,
  timeoutMs: 100,
  maxInputChars: 48000,
};

// ===== CB4 — streaming branch detection =====

test('CB4.1 streaming branch: chunks pushed + final summary returned', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => { throw new Error('non-streaming path taken in streaming case'); },
    streamSummarize: async ({ onChunk }) => {
      onChunk('Hel');
      onChunk('lo');
      return { summary: 'Hello' };
    },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(reply, { ok: true, summary: 'Hello' });
  assert.deepEqual(sender.sent, [
    { channel: 'ai:chunk:1', payload: { text: 'Hel' } },
    { channel: 'ai:chunk:1', payload: { text: 'lo' } },
  ]);
});

test('CB4.2 NO chunkChannel in payload → non-streaming path (T6 preserved)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'non-stream' }),
    streamSummarize: async () => { throw new Error('streaming path taken in non-streaming case'); },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi' });
  assert.deepEqual(reply, { ok: true, summary: 'non-stream' });
  assert.equal(sender.sent.length, 0);
});

test('CB4.3 settings.streaming === false + chunkChannel present → non-streaming path (opt-out)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'non-stream' }),
    streamSummarize: async () => { throw new Error('streaming path taken with opt-out'); },
  };
  register(ipc, { settings: { ...BASE_SETTINGS, streaming: false }, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:9' });
  assert.deepEqual(reply, { ok: true, summary: 'non-stream' });
  assert.equal(sender.sent.length, 0);
});

test('CB4.4 settings.streaming === true (explicit) → streaming branch', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'non-stream' }),
    streamSummarize: async ({ onChunk }) => { onChunk('s'); return { summary: 's' }; },
  };
  register(ipc, { settings: { ...BASE_SETTINGS, streaming: true }, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(reply, { ok: true, summary: 's' });
  assert.equal(sender.sent.length, 1);
});

test('CB4.5 provider lacks streamSummarize → non-streaming path (defensive)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'fallback' }),
    // streamSummarize intentionally missing
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(reply, { ok: true, summary: 'fallback' });
  assert.equal(sender.sent.length, 0);
});

test('CB4.6 Rewrite channel: streaming branch also works', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => { throw new Error('non-streaming taken'); },
    streamSummarize: async ({ onChunk }) => { onChunk('rew'); onChunk('ritten'); return { summary: 'rewritten' }; },
  };
  registerRewrite(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(REWRITE_CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(reply, { ok: true, summary: 'rewritten' });
  assert.deepEqual(sender.sent, [
    { channel: 'ai:chunk:1', payload: { text: 'rew' } },
    { channel: 'ai:chunk:1', payload: { text: 'ritten' } },
  ]);
});

test('CB4.7 stream provider throws aiError → typed failure (G4 strict equality)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async () => { throw aiError('invalid-response', REASON_MESSAGES['invalid-response']); },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'invalid-response');
  assert.equal(reply.message, REASON_MESSAGES['invalid-response']);
});

test('CB4.8 http-error from stream provider includes status suffix', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async () => { throw aiError('http-error', REASON_MESSAGES['http-error'], { status: 503 }); },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'http-error');
  assert.equal(reply.message, REASON_MESSAGES['http-error'] + ' (HTTP 503)');
});

test('CB4.9 G4 strict equality: provider throws non-aiError → unknown reason + canned message', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async () => { throw new Error('SUPER SECRET PROVIDER MESSAGE'); },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.equal(reply.reason, 'unknown');
  assert.equal(reply.message, REASON_MESSAGES['unknown']);
  assert.equal(reply.message.includes('SECRET'), false);
});

test('CB4.10 stall timeout: stream provider never yields → timeout', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const stuck = deferred();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async () => stuck.promise, // never resolves
  };
  register(ipc, { settings: { ...BASE_SETTINGS, timeoutMs: 30 }, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'timeout');
  assert.equal(reply.message, REASON_MESSAGES['timeout']);
  // Allow the hung provider promise to settle without unhandled rejection.
  stuck.resolve({ summary: '' });
});

test('CB4.11 mid-stream stall: one chunk then nothing for timeoutMs → timeout', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async ({ onChunk }) => {
      onChunk('first');
      // never resolves and never yields again
      return new Promise(() => {});
    },
  };
  register(ipc, { settings: { ...BASE_SETTINGS, timeoutMs: 30 }, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.equal(reply.reason, 'timeout');
  // The one chunk that did arrive was pushed.
  assert.equal(sender.sent.length, 1);
});

test('CB4.12 progressive stream (chunk every ~10ms) does NOT timeout when stall window is 100ms', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async ({ onChunk }) => {
      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => setTimeout(r, 10));
        onChunk('.');
      }
      return { summary: '.....' };
    },
  };
  register(ipc, { settings: { ...BASE_SETTINGS, timeoutMs: 100 }, provider });
  const reply = await ipc.invoke(CHANNEL, sender, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(reply, { ok: true, summary: '.....' });
  assert.equal(sender.sent.length, 5);
});

test('CB4.13 empty-input / input-too-large guards apply BEFORE streaming branch decision', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async () => { throw new Error('should not get here'); },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  const empty = await ipc.invoke(CHANNEL, sender, { text: '   ', chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(empty, { ok: false, reason: 'empty-input', message: REASON_MESSAGES['empty-input'] });
  const tooLong = await ipc.invoke(CHANNEL, sender, { text: 'x'.repeat(BASE_SETTINGS.maxInputChars + 1), chunkChannel: 'ai:chunk:1' });
  assert.deepEqual(tooLong, { ok: false, reason: 'input-too-large', message: REASON_MESSAGES['input-too-large'] });
});

test('CB4.14 streaming branch passes correct args to provider.streamSummarize (model, messages, etc.)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  let captured = null;
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async (args) => { captured = args; return { summary: 'ok' }; },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  await ipc.invoke(CHANNEL, sender, { text: 'note text', chunkChannel: 'ai:chunk:1' });
  assert.equal(captured.baseUrl, BASE_SETTINGS.baseUrl);
  assert.equal(captured.model, BASE_SETTINGS.model);
  assert.equal(captured.temperature, BASE_SETTINGS.temperature);
  assert.equal(captured.maxTokens, BASE_SETTINGS.maxTokens);
  assert.equal(typeof captured.signal, 'object');
  assert.equal(typeof captured.onChunk, 'function');
  assert.ok(Array.isArray(captured.messages));
});

// ===== CB5 — registerCancel + composite key =====

test('CB5.1 registerCancel installs ai:cancel handler', () => {
  const ipc = makeIpc();
  assert.equal(typeof AiIpc.registerCancel, 'function');
  AiIpc.registerCancel(ipc);
  assert.ok(ipc._onListeners.has('ai:cancel'));
});

test('CB5.2 ai:cancel aborts the in-flight stream → resolves with timeout', async () => {
  const ipc = makeIpc();
  const senderA = makeFakeSender();
  let capturedSignal = null;
  const startSignal = deferred();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async ({ signal, onChunk }) => {
      capturedSignal = signal;
      onChunk('partial');
      startSignal.resolve();
      // Wait until signal aborts, then throw timeout-like error.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(aiError('timeout', REASON_MESSAGES['timeout']));
        });
      });
    },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  AiIpc.registerCancel(ipc);
  const inFlight = ipc.invoke(CHANNEL, senderA, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  await startSignal.promise;
  // Now send cancel from the SAME sender id.
  ipc.send('ai:cancel', { sender: senderA.sender }, { chunkChannel: 'ai:chunk:1' });
  const reply = await inFlight;
  assert.equal(reply.ok, false);
  assert.equal(reply.reason, 'timeout');
  assert.ok(capturedSignal && capturedSignal.aborted);
});

test('CB5.3 composite key: cancel from sender A does NOT affect sender B', async () => {
  const ipc = makeIpc();
  const senderA = makeFakeSender();
  const senderB = makeFakeSender();
  const startedA = deferred();
  const startedB = deferred();
  const provider = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async ({ signal, onChunk }) => {
      // Identify the in-flight request by which sender's onChunk goes
      // through (different sender objects → different sent[] arrays).
      onChunk('go');
      const isA = signal.__senderTag === 'A';
      (isA ? startedA : startedB).resolve();
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(aiError('timeout', REASON_MESSAGES['timeout']));
        });
        // B never aborts; it completes after a bounded delay if not aborted.
        if (!isA) setTimeout(() => resolve({ summary: 'B-final' }), 80);
      });
    },
  };
  register(ipc, { settings: BASE_SETTINGS, provider });
  AiIpc.registerCancel(ipc);

  // Tag the signals by patching event.sender.send to know who we are
  // when the provider's streamSummarize runs. Crude but effective for
  // identifying which controller belongs to whom inside the provider.
  // We do this by wrapping invoke to mark a tag on the captured signal.
  const origInvokeHandler = ipc._handlers.get(CHANNEL);
  ipc._handlers.set(CHANNEL, async (event, payload) => {
    return origInvokeHandler({
      ...event,
      sender: {
        ...event.sender,
        send: (...args) => event.sender.send(...args),
      },
    }, payload);
  });

  // Actually simpler: rely on chunkChannel uniqueness per invoke. Both
  // senders use the SAME chunkChannel name 'ai:chunk:1' to exercise the
  // composite-key disambiguation; the registerCancel handler must key by
  // event.sender.id + chunkChannel.

  // We need the provider to identify which sender's stream is running.
  // Switch strategy: use the onChunk callback's identity (it's a fresh
  // closure per invoke, capturing event.sender). We can't directly tag
  // the signal, so we'll just trust the composite-key contract and verify
  // by behavior: when we cancel A, B's invoke still resolves with summary.

  // Restore the provider to a version that doesn't depend on a tag.
  const provider2 = {
    summarize: async () => ({ summary: 'x' }),
    streamSummarize: async ({ signal, onChunk }) => {
      onChunk('go');
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(aiError('timeout', REASON_MESSAGES['timeout']));
        });
        // Fallback for unaborted streams: complete after 80ms.
        setTimeout(() => resolve({ summary: 'final' }), 80);
      });
    },
  };
  // Re-register with provider2 by setting up a fresh ipc for this case:
  const ipc2 = makeIpc();
  register(ipc2, { settings: { ...BASE_SETTINGS, timeoutMs: 500 }, provider: provider2 });
  AiIpc.registerCancel(ipc2);

  const flightA = ipc2.invoke(CHANNEL, senderA, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  const flightB = ipc2.invoke(CHANNEL, senderB, { text: 'hi', chunkChannel: 'ai:chunk:1' });
  // Give both invokes a tick to register their controllers.
  await new Promise((r) => setTimeout(r, 10));

  // Cancel A (composite key sender.id=A:ai:chunk:1).
  ipc2.send('ai:cancel', { sender: senderA.sender }, { chunkChannel: 'ai:chunk:1' });

  const [replyA, replyB] = await Promise.all([flightA, flightB]);
  assert.equal(replyA.reason, 'timeout', 'sender A should be aborted');
  assert.deepEqual(replyB, { ok: true, summary: 'final' }, 'sender B should complete normally');
});

test('CB5.4 ai:cancel for an unknown chunkChannel → no-op (no throw)', () => {
  const ipc = makeIpc();
  AiIpc.registerCancel(ipc);
  const senderX = makeFakeSender();
  // Should not throw; the controller map has no entry for this channel.
  assert.doesNotThrow(() => {
    ipc.send('ai:cancel', { sender: senderX.sender }, { chunkChannel: 'ai:chunk:does-not-exist' });
  });
});

test('CB5.5 registerCancel is idempotent (calling twice does not double-listen)', () => {
  const ipc = makeIpc();
  AiIpc.registerCancel(ipc);
  AiIpc.registerCancel(ipc);
  const listeners = ipc._onListeners.get('ai:cancel') || [];
  assert.equal(listeners.length, 1);
});

test('CB5.6 module exports registerCancel', () => {
  assert.equal(typeof AiIpc.registerCancel, 'function');
});

// ===== CB4 final: confirm non-streaming + Rewrite parity =====

test('CB4.15 non-streaming Rewrite (no chunkChannel) still works (CA2 preserved)', async () => {
  const ipc = makeIpc();
  const sender = makeFakeSender();
  const provider = {
    summarize: async () => ({ summary: 'rewrite-result' }),
    streamSummarize: async () => { throw new Error('streaming taken'); },
  };
  registerRewrite(ipc, { settings: BASE_SETTINGS, provider });
  const reply = await ipc.invoke(REWRITE_CHANNEL, sender, { text: 'orig' });
  assert.deepEqual(reply, { ok: true, summary: 'rewrite-result' });
});
