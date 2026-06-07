/* test/ai-preload-badge.test.js
   Stage C update — the badge + AI settings are sourced from the MAIN process
   via ai:get-settings (single source of truth: env > stored > default). The
   preload no longer computes the badge from process.env.

   These tests verify the preload's DELEGATION + surface shape. The actual
   env/stored/default merge and badge derivation are covered main-side by
   ai-settings-ipc.test.js (CS3.*). The original Stage F CF4.B env-computation
   tests were removed along with the inlined preload logic they exercised.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const SRC = () => fs.readFileSync(PRELOAD_PATH, 'utf8');

// ===== CF4.A — source-shape =====

test('CF4.A1 vaultApi exposes getAiBadgeState + getAiSettings + saveAiSettings + testAiConnection', () => {
  const src = SRC();
  assert.match(src, /getAiBadgeState\s*:/);
  assert.match(src, /getAiSettings\s*:/);
  assert.match(src, /saveAiSettings\s*:/);
  assert.match(src, /testAiConnection\s*:/);
});

test('CF4.A1b [QA fix] preload does NOT require any relative module (sandbox-safe)', () => {
  // Electron's sandboxed preload restricts require() to a whitelist; a relative
  // require throws silently and turns every vaultApi button into a no-op.
  const src = SRC();
  const requires = src.match(/require\(['"][^'"]+['"]\)/g) || [];
  const nonAllowed = requires.filter((r) => !/(['"])electron\1/.test(r));
  assert.deepEqual(nonAllowed, [],
    `preload must not require relative modules; found: ${JSON.stringify(nonAllowed)}`);
});

test('CF4.A2 namespace count still === 2 (vaultApi + ai)', () => {
  const src = SRC();
  const matches = src.match(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g) || [];
  const names = matches.map((m) => m.match(/['"]([^'"]+)['"]/)[1]).sort();
  assert.deepEqual(names, ['ai', 'vaultApi']);
});

test('CF4.A3 ai surface still exactly 2 keys (settings live on vaultApi)', () => {
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

// ===== CF4.B — runtime delegation to main =====

function evalPreload(invokeImpl) {
  const exposed = {};
  const calls = [];
  const ipcRenderer = {
    invoke: (channel, payload) => { calls.push({ channel, payload }); return invokeImpl(channel, payload); },
    on: () => {}, removeListener: () => {}, send: () => {},
  };
  const contextBridge = { exposeInMainWorld(name, surface) { exposed[name] = surface; } };
  const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const stripped = src.replace(
    /const\s*\{\s*contextBridge\s*,\s*ipcRenderer\s*\}\s*=\s*require\(['"]electron['"]\)\s*;?/,
    '/* stripped */',
  );
  const wrapped = `(function(contextBridge, ipcRenderer){\n${stripped}\n});`;
  (0, eval)(wrapped)(contextBridge, ipcRenderer); // eslint-disable-line no-eval
  return { exposed, calls };
}

test('CF4.B1 getAiBadgeState invokes ai:get-settings and resolves to .badge', async () => {
  const badge = { isRemote: true, allowRemote: true, hostname: '192.168.1.9' };
  const { exposed, calls } = evalPreload((ch) =>
    ch === 'ai:get-settings' ? Promise.resolve({ effective: {}, envOverridden: {}, badge }) : Promise.resolve());
  assert.deepEqual(await exposed.vaultApi.getAiBadgeState(), badge);
  assert.ok(calls.some((c) => c.channel === 'ai:get-settings'));
});

test('CF4.B2 getAiBadgeState falls back to no-badge when main returns nothing', async () => {
  const { exposed } = evalPreload(() => Promise.resolve(undefined));
  assert.deepEqual(await exposed.vaultApi.getAiBadgeState(),
    { isRemote: false, allowRemote: false, hostname: '' });
});

test('CF4.B3 getAiBadgeState falls back to no-badge when the invoke rejects', async () => {
  const { exposed } = evalPreload(() => Promise.reject(new Error('no channel')));
  assert.deepEqual(await exposed.vaultApi.getAiBadgeState(),
    { isRemote: false, allowRemote: false, hostname: '' });
});

test('CF4.B4 getAiSettings returns the full snapshot from main', async () => {
  const snap = {
    effective: { baseUrl: 'http://localhost:1234/v1', model: 'm', allowRemote: false },
    envOverridden: { baseUrl: false, model: false, allowRemote: false },
    badge: { isRemote: false, allowRemote: false, hostname: 'localhost' },
  };
  const { exposed } = evalPreload((ch) => ch === 'ai:get-settings' ? Promise.resolve(snap) : Promise.resolve());
  assert.deepEqual(await exposed.vaultApi.getAiSettings(), snap);
});

test('CF4.B5 saveAiSettings invokes ai:save-settings with the partial payload', async () => {
  const { exposed, calls } = evalPreload((ch) => ch === 'ai:save-settings' ? Promise.resolve({ ok: true }) : Promise.resolve());
  const res = await exposed.vaultApi.saveAiSettings({ model: 'qwen' });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.find((c) => c.channel === 'ai:save-settings').payload, { model: 'qwen' });
});

test('CF4.B6 testAiConnection invokes ai:test-connection with the pending payload', async () => {
  const { exposed, calls } = evalPreload((ch) => ch === 'ai:test-connection'
    ? Promise.resolve({ ok: true, models: ['a'] }) : Promise.resolve());
  const res = await exposed.vaultApi.testAiConnection({ baseUrl: 'http://localhost:1234/v1', allowRemote: false });
  assert.deepEqual(res, { ok: true, models: ['a'] });
  assert.deepEqual(calls.find((c) => c.channel === 'ai:test-connection').payload,
    { baseUrl: 'http://localhost:1234/v1', allowRemote: false });
});
