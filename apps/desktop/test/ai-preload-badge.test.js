/* test/ai-preload-badge.test.js
   Stage F — CF4: vaultApi.getAiBadgeState() computes badge state at preload
   load time from process.env. Sync, no IPC.

   Contract:
   - Default (no env vars) → { isRemote: false, hostname: '', allowRemote: false }.
     Badge hidden.
   - Non-loopback baseUrl + allowRemote=true → { isRemote: true, hostname:
     <host>, allowRemote: true }. Badge SHOWN.
   - Non-loopback baseUrl + allowRemote NOT true → { isRemote: true,
     hostname: <host>, allowRemote: false }. Badge hidden (request would
     be blocked; badge would lie about actual traffic).
   - Loopback baseUrl + allowRemote=true → { isRemote: false, hostname:
     'localhost'|'...', allowRemote: true }. Badge hidden (no remote traffic).
   - Method added inside vaultApi block. Namespace count stays 2 (vaultApi + ai).
   - No new exposeInMainWorld surface.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const SRC = () => fs.readFileSync(PRELOAD_PATH, 'utf8');

// ===== CF4.A — source-shape =====

test('CF4.A1 vaultApi has getAiBadgeState method (source-shape)', () => {
  assert.match(SRC(), /getAiBadgeState\s*:/);
});

test('CF4.A1b [QA fix] preload does NOT require any relative module (sandbox-safe)', () => {
  // Electron's sandboxed preload restricts require() to a whitelist
  // (electron, events, timers, url). A relative require like
  // `./lib/ai-settings` throws silently and prevents
  // contextBridge.exposeInMainWorld from running — symptom: every
  // vaultApi button becomes a no-op. Inline the helper instead.
  const src = SRC();
  // Allow only the special `require('electron')` line at the top.
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

test('CF4.A3 ai surface still exactly 2 keys', () => {
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

// ===== CF4.B — runtime with env stubs =====

function evalPreloadWithEnv(env) {
  const exposed = {};
  const ipcRenderer = {
    invoke: () => Promise.resolve(),
    on: () => {},
    removeListener: () => {},
    send: () => {},
  };
  const contextBridge = {
    exposeInMainWorld(name, surface) { exposed[name] = surface; },
  };
  const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const stripped = src.replace(
    /const\s*\{\s*contextBridge\s*,\s*ipcRenderer\s*\}\s*=\s*require\(['"]electron['"]\)\s*;?/,
    '/* stripped */',
  );
  // Provide process with the test env; require() resolves relative to this test file's directory.
  // Use eval with the same dirname as preload.js for require() to work.
  const realProcess = global.process;
  const fakeProcess = { ...realProcess, env: env };
  const Module = require('node:module');
  const wrappedSrc = `(function(contextBridge, ipcRenderer, process, require, __dirname, __filename) {\n${stripped}\n});`;
  const fn = (0, eval)(wrappedSrc); // eslint-disable-line no-eval
  fn(
    contextBridge,
    ipcRenderer,
    fakeProcess,
    Module.createRequire(PRELOAD_PATH),
    path.dirname(PRELOAD_PATH),
    PRELOAD_PATH,
  );
  return exposed;
}

test('CF4.B1 default env → { isRemote: false, allowRemote: false } (badge hidden)', () => {
  const env = {};
  const exposed = evalPreloadWithEnv(env);
  assert.equal(typeof exposed.vaultApi.getAiBadgeState, 'function');
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, false);
  assert.equal(state.allowRemote, false);
});

test('CF4.B2 non-loopback baseUrl + ALLOW_REMOTE=true → badge SHOWN', () => {
  const env = {
    MARKDOWN_AI_BASE_URL: 'http://192.168.1.50:1234/v1',
    MARKDOWN_AI_ALLOW_REMOTE: 'true',
  };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, true);
  assert.equal(state.allowRemote, true);
  assert.equal(typeof state.hostname, 'string');
  assert.ok(state.hostname.length > 0);
});

test('CF4.B3 non-loopback baseUrl + NO allow → badge hidden (request would be blocked)', () => {
  const env = { MARKDOWN_AI_BASE_URL: 'http://192.168.1.50:1234/v1' };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, true);
  assert.equal(state.allowRemote, false);
  // Renderer uses (isRemote && allowRemote) to decide; this means badge OFF.
});

test('CF4.B4 loopback baseUrl + ALLOW_REMOTE=true → badge hidden (no actual remote traffic)', () => {
  const env = {
    MARKDOWN_AI_BASE_URL: 'http://127.0.0.1:8080/v1',
    MARKDOWN_AI_ALLOW_REMOTE: 'true',
  };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, false);
  assert.equal(state.allowRemote, true);
});

test('CF4.B5 IPv6 loopback baseUrl → isRemote false', () => {
  const env = { MARKDOWN_AI_BASE_URL: 'http://[::1]:1234/v1' };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, false);
});

test('CF4.B6 LAN IP exposes hostname for badge tooltip (no port leak)', () => {
  const env = {
    MARKDOWN_AI_BASE_URL: 'http://10.0.0.5:8080/v1',
    MARKDOWN_AI_ALLOW_REMOTE: 'true',
  };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.hostname, '10.0.0.5');
  // Port intentionally NOT included — keep the badge tooltip compact.
});

test('CF4.B7 unparseable baseUrl → defensive default (isRemote false)', () => {
  const env = { MARKDOWN_AI_BASE_URL: 'garbage' };
  const exposed = evalPreloadWithEnv(env);
  const state = exposed.vaultApi.getAiBadgeState();
  assert.equal(state.isRemote, false);
});

test('CF4.B8 getAiBadgeState is sync and idempotent', () => {
  const env = {
    MARKDOWN_AI_BASE_URL: 'http://192.168.1.50:1234/v1',
    MARKDOWN_AI_ALLOW_REMOTE: 'true',
  };
  const exposed = evalPreloadWithEnv(env);
  const state1 = exposed.vaultApi.getAiBadgeState();
  const state2 = exposed.vaultApi.getAiBadgeState();
  assert.deepEqual(state1, state2);
});
