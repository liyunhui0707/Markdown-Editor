/* test/ai-settings-ipc.test.js
   Stage C (settings panel) — CS3: ai:get-settings / ai:save-settings IPC.

   registerSettings(ipc, { env, settingsPath }) installs two handlers that are
   the single source of truth for the renderer's settings panel AND the privacy
   badge:
   - ai:get-settings  -> { effective, envOverridden, badge }
   - ai:save-settings -> validates the partial, persists via ai-settings-store,
     returns { ok, error?, effective, envOverridden, badge }

   effective merges env > stored > default (loadAiSettings). envOverridden flags
   which of baseUrl/model/allowRemote are locked by an env var (so the UI can
   gray them out). badge is derived from effective so it can never disagree with
   what the request layer will actually do.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  registerSettings, GET_CHANNEL, SAVE_CHANNEL,
} = require('../lib/ai-settings-ipc');
const { readStoredSettings } = require('../lib/ai-settings-store');
const { DEFAULTS } = require('../lib/ai-settings');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-ipc-'));
  return path.join(dir, 'ai-settings.json');
}

// Minimal fake ipcMain that captures handlers and lets the test invoke them.
function harness({ env = {}, settingsPath } = {}) {
  const handlers = {};
  const ipc = { handle(ch, fn) { handlers[ch] = fn; } };
  registerSettings(ipc, { env, settingsPath });
  return {
    get: () => handlers[GET_CHANNEL](null),
    save: (payload) => handlers[SAVE_CHANNEL](null, payload),
  };
}

test('CS3.1 get-settings default (no env, no stored file)', async () => {
  const h = harness({ env: {}, settingsPath: tmpFile() });
  const r = await h.get();
  assert.equal(r.effective.baseUrl, DEFAULTS.baseUrl);
  assert.equal(r.effective.model, DEFAULTS.model);
  assert.equal(r.effective.allowRemote, false);
  assert.deepEqual(r.envOverridden, { baseUrl: false, model: false, allowRemote: false });
  assert.deepEqual(r.badge, { isRemote: false, allowRemote: false, hostname: 'localhost' });
});

test('CS3.2 get-settings reflects stored values', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  await h.save({ baseUrl: 'http://192.168.1.9:1234/v1', allowRemote: true });
  const r = await h.get();
  assert.equal(r.effective.baseUrl, 'http://192.168.1.9:1234/v1');
  assert.equal(r.effective.allowRemote, true);
  assert.deepEqual(r.badge, { isRemote: true, allowRemote: true, hostname: '192.168.1.9' });
});

test('CS3.3 get-settings marks env-overridden fields', async () => {
  const h = harness({ env: { MARKDOWN_AI_MODEL: 'qwen' }, settingsPath: tmpFile() });
  const r = await h.get();
  assert.equal(r.effective.model, 'qwen');
  assert.equal(r.envOverridden.model, true);
  assert.equal(r.envOverridden.baseUrl, false);
});

test('CS3.4 save persists and round-trips', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  const res = await h.save({ baseUrl: 'http://localhost:5000/v1', model: 'm', allowRemote: false });
  assert.equal(res.ok, true);
  assert.equal(res.effective.baseUrl, 'http://localhost:5000/v1');
  assert.deepEqual(readStoredSettings(f), { baseUrl: 'http://localhost:5000/v1', model: 'm', allowRemote: false });
});

test('CS3.5 save rejects an invalid baseUrl, persists nothing', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  const res = await h.save({ baseUrl: 'ftp://nope' });
  assert.equal(res.ok, false);
  assert.match(res.error, /baseUrl/i);
  assert.deepEqual(readStoredSettings(f), {});
});

test('CS3.6 save rejects a non-boolean allowRemote', async () => {
  const h = harness({ env: {}, settingsPath: tmpFile() });
  const res = await h.save({ allowRemote: 'yes' });
  assert.equal(res.ok, false);
  assert.match(res.error, /allowRemote/i);
});

test('CS3.7 save partial merges with existing', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  await h.save({ baseUrl: 'http://localhost:1234/v1', model: 'm1', allowRemote: true });
  const res = await h.save({ model: 'm2' });
  assert.equal(res.ok, true);
  assert.deepEqual(readStoredSettings(f), { baseUrl: 'http://localhost:1234/v1', model: 'm2', allowRemote: true });
});

test('CS3.8 save ignores non-whitelisted keys', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  const res = await h.save({ provider: 'evil', model: 'm' });
  assert.equal(res.ok, true);
  assert.deepEqual(readStoredSettings(f), { model: 'm' });
});

test('CS3.9 badge tracks saved remote + allow toggle', async () => {
  const f = tmpFile();
  const h = harness({ env: {}, settingsPath: f });
  await h.save({ baseUrl: 'http://10.0.0.5:1234/v1', allowRemote: true });
  assert.deepEqual((await h.get()).badge, { isRemote: true, allowRemote: true, hostname: '10.0.0.5' });
  await h.save({ allowRemote: false });
  assert.deepEqual((await h.get()).badge, { isRemote: true, allowRemote: false, hostname: '10.0.0.5' });
});

test('CS3.10 env wins over stored end-to-end (effective + badge)', async () => {
  const f = tmpFile();
  const h = harness({ env: { MARKDOWN_AI_BASE_URL: 'http://localhost:1234/v1' }, settingsPath: f });
  await h.save({ baseUrl: 'http://10.0.0.5:1234/v1', allowRemote: true });
  const r = await h.get();
  assert.equal(r.effective.baseUrl, 'http://localhost:1234/v1');
  assert.equal(r.envOverridden.baseUrl, true);
  assert.equal(r.badge.isRemote, false);
});
