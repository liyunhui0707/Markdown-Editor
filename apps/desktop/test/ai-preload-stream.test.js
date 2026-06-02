/* test/ai-preload-stream.test.js
   CB6 — Stage B: preload.js streaming wrapper.

   Two sections:

   Section A — SOURCE-SHAPE regex over preload.js:
     - 'ai:cancel' string appears in source.
     - summarizeNote and rewriteText accept (text, options) shape.
     - exposeInMainWorld namespaces: exactly 2 (vaultApi + ai).
     - T8.2 + CA3.2 direct-invoke regex STILL match.
     - T8.3 key count STILL === 2.

   Section B — RUNTIME with stubbed contextBridge + ipcRenderer:
     - Non-streaming call (no onChunk) returns a bare Promise; one
       ipcRenderer.invoke recorded; chunkChannel value is null.
     - Streaming call (with onChunk + signal) returns a bare Promise;
       ORDER: ipcRenderer.on(chunkChannel, listener) BEFORE
       ipcRenderer.invoke(channel, {text, chunkChannel: <captured>}).
     - Listener receives a chunk → onChunk called with the text.
     - Listener removed after invoke resolves AND after rejects.
     - signal.abort() → ipcRenderer.send('ai:cancel', {chunkChannel}).
     - Two streaming calls in a row → distinct chunkChannels; independent
       cleanup.
     - rewriteText routes to 'ai:rewrite-text' with the same shape.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const SRC = () => fs.readFileSync(PRELOAD_PATH, 'utf8');

// ===== Section A — source-shape regex =====

test('CB6.A1 source mentions ai:cancel', () => {
  assert.match(SRC(), /['"]ai:cancel['"]/);
});

test('CB6.A1b source mentions registerAbort (the contextBridge-safe cancel hook)', () => {
  assert.match(SRC(), /registerAbort/);
});

test('CB6.A2 summarizeNote arrow accepts (text, options) shape', () => {
  // Allow whitespace and optional default. The shape we require is two
  // arg names; tolerant of either `(text, options)` or `(text, options = {})`.
  assert.match(
    SRC(),
    /summarizeNote\s*:\s*\(\s*text\s*,\s*options[^)]*\)\s*=>/,
  );
});

test('CB6.A3 rewriteText arrow accepts (text, options) shape', () => {
  assert.match(
    SRC(),
    /rewriteText\s*:\s*\(\s*text\s*,\s*options[^)]*\)\s*=>/,
  );
});

test('CB6.A4 T8.2 regex still matches (summarizeNote → ipcRenderer.invoke direct)', () => {
  // Same regex as v0.2.0 T8.2. With Stage B the body becomes
  // `=> ipcRenderer.invoke('ai:summarize-note', { text, chunkChannel: ... })...`
  // Match ends at the literal 'text' so the trailing extras don't matter.
  assert.match(
    SRC(),
    /summarizeNote\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]ai:summarize-note['"]\s*,\s*\{?\s*text/,
  );
});

test('CB6.A5 CA3.2 regex still matches (rewriteText → ipcRenderer.invoke direct)', () => {
  assert.match(
    SRC(),
    /rewriteText\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]ai:rewrite-text['"]\s*,\s*\{?\s*text/,
  );
});

test('CB6.A6 exposeInMainWorld namespaces: exactly 2 (vaultApi + ai)', () => {
  const src = SRC();
  const matches = src.match(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g) || [];
  const names = matches.map((m) => m.match(/['"]([^'"]+)['"]/)[1]).sort();
  assert.deepEqual(names, ['ai', 'vaultApi']);
});

test('CB6.A7 T8.3 key count still === 2 on the ai surface', () => {
  const src = SRC();
  const re = /exposeInMainWorld\(\s*['"]ai['"]\s*,\s*(\{[\s\S]*?\})\s*\)\s*;/m;
  const m = src.match(re);
  assert.ok(m, 'ai block must be present');
  const stripped = m[1]
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const keys = (stripped.match(/\b[A-Za-z_][A-Za-z_0-9]*\s*:/g) || [])
    .map((k) => k.match(/[A-Za-z_][A-Za-z_0-9]*/)[0])
    .sort();
  assert.deepEqual(keys, ['rewriteText', 'summarizeNote']);
});

test('CB6.A8 no raw ipcRenderer / electron surface exposed', () => {
  const src = SRC();
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]ipcRenderer['"]/);
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]electron['"]/);
});

// ===== Section B — runtime with stubs =====

// Helper: evaluate preload.js with a stubbed `electron` module so we can
// capture the exposed surfaces and the IPC calls.
function evalPreloadWithStubs() {
  const exposedSurfaces = {};
  const invokes = []; // { channel, payload }
  const onListeners = new Map(); // channel → [listener]
  const sentMessages = []; // { channel, payload }
  const invokeDeferreds = []; // pending Promise resolvers per invoke

  const ipcRenderer = {
    invoke(channel, payload) {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      invokes.push({ channel, payload, resolve, reject, promise });
      invokeDeferreds.push({ resolve, reject });
      return promise;
    },
    on(channel, listener) {
      if (!onListeners.has(channel)) onListeners.set(channel, []);
      onListeners.get(channel).push(listener);
    },
    removeListener(channel, listener) {
      const arr = onListeners.get(channel);
      if (!arr) return;
      const i = arr.indexOf(listener);
      if (i !== -1) arr.splice(i, 1);
      if (arr.length === 0) onListeners.delete(channel);
    },
    send(channel, payload) {
      sentMessages.push({ channel, payload });
    },
  };
  const contextBridge = {
    exposeInMainWorld(name, surface) { exposedSurfaces[name] = surface; },
  };

  const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
  // Strip the `require('electron')` destructuring; provide our stubs via
  // wrapper function args instead.
  const stripped = src.replace(
    /const\s*\{\s*contextBridge\s*,\s*ipcRenderer\s*\}\s*=\s*require\(['"]electron['"]\)\s*;?/,
    '/* electron require stripped for test */',
  );
  // Wrap in a function so `contextBridge` and `ipcRenderer` are in scope.
  const wrappedSrc = `(function(contextBridge, ipcRenderer) {\n${stripped}\n});`;
  const fn = (0, eval)(wrappedSrc); // eslint-disable-line no-eval
  fn(contextBridge, ipcRenderer);

  return {
    ai: exposedSurfaces.ai,
    vaultApi: exposedSurfaces.vaultApi,
    invokes,
    onListeners,
    sentMessages,
    pushChunk(channel, payload) {
      const arr = onListeners.get(channel) || [];
      for (const l of arr) l({}, payload);
    },
    resolveInvoke(index, value) { invokes[index].resolve(value); },
    rejectInvoke(index, err) { invokes[index].reject(err); },
  };
}

test('CB6.B1 ai surface has exactly summarizeNote + rewriteText', () => {
  const env = evalPreloadWithStubs();
  const keys = Object.keys(env.ai).sort();
  assert.deepEqual(keys, ['rewriteText', 'summarizeNote']);
});

test('CB6.B2 non-streaming call: returns Promise, single invoke, no listener registered', async () => {
  const env = evalPreloadWithStubs();
  const p = env.ai.summarizeNote('hi'); // no options
  assert.ok(p && typeof p.then === 'function');
  assert.equal(env.invokes.length, 1);
  assert.equal(env.invokes[0].channel, 'ai:summarize-note');
  assert.equal(env.invokes[0].payload.text, 'hi');
  // chunkChannel may be present with value null OR absent — either way no listener registered.
  assert.equal(env.invokes[0].payload.chunkChannel, null);
  assert.equal(env.onListeners.size, 0);
  // Resolve so the promise settles cleanly.
  env.resolveInvoke(0, { ok: true, summary: 'x' });
  await p;
});

test('CB6.B3 streaming call: returns Promise, listener registered BEFORE invoke', async () => {
  const env = evalPreloadWithStubs();
  const onChunkCalls = [];
  let abortFn = null;
  const p = env.ai.summarizeNote('hello', {
    onChunk: (t) => onChunkCalls.push(t),
    registerAbort: (fn) => { abortFn = fn; },
  });
  assert.ok(p && typeof p.then === 'function');
  assert.equal(env.invokes.length, 1);
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  assert.equal(typeof chunkChannel, 'string');
  assert.match(chunkChannel, /^ai:chunk:\d+$/);
  // registerAbort must have been called synchronously with a function.
  assert.equal(typeof abortFn, 'function');
  // The listener must exist at the time invoke was called — verifiable
  // because the listener is still registered now (resolve hasn't fired).
  assert.ok(env.onListeners.has(chunkChannel));
  // Push a chunk and ensure onChunk receives it.
  env.pushChunk(chunkChannel, { text: 'tok1' });
  env.pushChunk(chunkChannel, { text: 'tok2' });
  assert.deepEqual(onChunkCalls, ['tok1', 'tok2']);
  // Resolve invoke; listener must be removed.
  env.resolveInvoke(0, { ok: true, summary: 'tok1tok2' });
  await p;
  assert.equal(env.onListeners.has(chunkChannel), false);
});

test('CB6.B4 streaming call: listener removed even on invoke reject', async () => {
  const env = evalPreloadWithStubs();
  const p = env.ai.summarizeNote('x', {
    onChunk: () => {},
    registerAbort: () => {},
  });
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  assert.ok(env.onListeners.has(chunkChannel));
  env.rejectInvoke(0, new Error('boom'));
  await p.catch(() => {});
  assert.equal(env.onListeners.has(chunkChannel), false);
});

test('CB6.B5 abortFn (provided to registerAbort) sends ai:cancel with the right chunkChannel', () => {
  const env = evalPreloadWithStubs();
  let abortFn = null;
  env.ai.summarizeNote('x', {
    onChunk: () => {},
    registerAbort: (fn) => { abortFn = fn; },
  });
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  assert.equal(typeof abortFn, 'function');
  abortFn();
  assert.deepEqual(
    env.sentMessages.find((m) => m.channel === 'ai:cancel'),
    { channel: 'ai:cancel', payload: { chunkChannel } },
  );
});

test('CB6.B6 two streaming calls get unique chunkChannels and clean up independently', async () => {
  const env = evalPreloadWithStubs();
  const pA = env.ai.summarizeNote('a', { onChunk: () => {}, registerAbort: () => {} });
  const pB = env.ai.summarizeNote('b', { onChunk: () => {}, registerAbort: () => {} });
  const chA = env.invokes[0].payload.chunkChannel;
  const chB = env.invokes[1].payload.chunkChannel;
  assert.notEqual(chA, chB);
  assert.ok(env.onListeners.has(chA));
  assert.ok(env.onListeners.has(chB));
  env.resolveInvoke(0, { ok: true, summary: 'a' });
  await pA;
  assert.equal(env.onListeners.has(chA), false);
  assert.ok(env.onListeners.has(chB));
  env.resolveInvoke(1, { ok: true, summary: 'b' });
  await pB;
  assert.equal(env.onListeners.has(chB), false);
});

test('CB6.B7 rewriteText routes to ai:rewrite-text with the same streaming shape', async () => {
  const env = evalPreloadWithStubs();
  const onChunkCalls = [];
  const p = env.ai.rewriteText('orig', {
    onChunk: (t) => onChunkCalls.push(t),
    registerAbort: () => {},
  });
  assert.equal(env.invokes.length, 1);
  assert.equal(env.invokes[0].channel, 'ai:rewrite-text');
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  assert.match(chunkChannel, /^ai:chunk:\d+$/);
  env.pushChunk(chunkChannel, { text: 'rew' });
  assert.deepEqual(onChunkCalls, ['rew']);
  env.resolveInvoke(0, { ok: true, summary: 'rew' });
  await p;
});

test('CB6.B7b two streaming calls get distinct abort functions targeting distinct chunkChannels', () => {
  const env = evalPreloadWithStubs();
  let abortA = null, abortB = null;
  env.ai.summarizeNote('a', { onChunk: () => {}, registerAbort: (fn) => { abortA = fn; } });
  env.ai.summarizeNote('b', { onChunk: () => {}, registerAbort: (fn) => { abortB = fn; } });
  const chA = env.invokes[0].payload.chunkChannel;
  const chB = env.invokes[1].payload.chunkChannel;
  assert.notEqual(abortA, abortB);
  abortA();
  abortB();
  const cancels = env.sentMessages.filter((m) => m.channel === 'ai:cancel');
  assert.deepEqual(cancels.map((c) => c.payload.chunkChannel).sort(), [chA, chB].sort());
});

test('CB6.B8 onChunk with non-function value is ignored (treated as no-options)', async () => {
  const env = evalPreloadWithStubs();
  const p = env.ai.summarizeNote('x', { onChunk: 'not a function' });
  assert.equal(env.invokes[0].payload.chunkChannel, null);
  assert.equal(env.onListeners.size, 0);
  env.resolveInvoke(0, { ok: true, summary: '' });
  await p;
});

test('CB6.B9 [Codex F2] cleanup works even when options is frozen (no mutation back-write)', async () => {
  // Real Electron contextBridge may freeze/proxy renderer-provided
  // objects. The preload must NOT depend on writing options._chunkChannel
  // back into the caller. With the WeakMap fix, cleanup recovers the
  // channel by object identity instead.
  const env = evalPreloadWithStubs();
  const options = Object.freeze({
    onChunk: () => {},
    registerAbort: () => {},
  });
  const p = env.ai.summarizeNote('x', options);
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  assert.ok(env.onListeners.has(chunkChannel), 'listener registered before invoke');
  env.resolveInvoke(0, { ok: true, summary: 'x' });
  await p;
  assert.equal(env.onListeners.has(chunkChannel), false,
    'listener removed even with frozen options (cleanup did not depend on mutation)');
});

test('CB6.B10 [Codex F2] cleanup works on reject path with frozen options', async () => {
  const env = evalPreloadWithStubs();
  const options = Object.freeze({
    onChunk: () => {},
    registerAbort: () => {},
  });
  const p = env.ai.summarizeNote('x', options);
  const chunkChannel = env.invokes[0].payload.chunkChannel;
  env.rejectInvoke(0, new Error('boom'));
  await p.catch(() => {});
  assert.equal(env.onListeners.has(chunkChannel), false);
});
