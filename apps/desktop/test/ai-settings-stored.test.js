/* test/ai-settings-stored.test.js
   Stage C (settings panel) — CS2: loadAiSettings({ env, stored }) precedence.

   The in-app settings panel persists baseUrl / model / allowRemote (see
   ai-settings-store). loadAiSettings merges them with env vars and defaults at
   this precedence, per field:

       env var  >  stored (settings panel)  >  built-in default

   Fields not in the store (provider, temperature, maxTokens, timeoutMs,
   maxInputChars, streaming) keep their env > default behavior unchanged.
   When neither env nor stored supplies allowRemote, the field stays ABSENT so
   the v0.2.0 default-shape deepEqual (T1.1) still holds.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAiSettings, DEFAULTS } = require('../lib/ai-settings');

test('CS2.1 stored omitted -> unchanged default shape (backward compat)', () => {
  const s = loadAiSettings({ env: {} });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
  assert.equal(s.model, DEFAULTS.model);
  assert.equal('allowRemote' in s, false);
  assert.equal('streaming' in s, false);
});

test('CS2.2 stored baseUrl used when env is absent', () => {
  const s = loadAiSettings({ env: {}, stored: { baseUrl: 'http://192.168.1.9:1234/v1' } });
  assert.equal(s.baseUrl, 'http://192.168.1.9:1234/v1');
});

test('CS2.3 env baseUrl wins over stored', () => {
  const s = loadAiSettings({
    env: { MARKDOWN_AI_BASE_URL: 'http://10.0.0.2:1234/v1' },
    stored: { baseUrl: 'http://192.168.1.9:1234/v1' },
  });
  assert.equal(s.baseUrl, 'http://10.0.0.2:1234/v1');
});

test('CS2.4 model: stored used when env absent; env wins when present', () => {
  assert.equal(loadAiSettings({ env: {}, stored: { model: 'llama3.1' } }).model, 'llama3.1');
  assert.equal(
    loadAiSettings({ env: { MARKDOWN_AI_MODEL: 'qwen' }, stored: { model: 'llama3.1' } }).model,
    'qwen',
  );
});

test('CS2.5 allowRemote: stored boolean used when env absent', () => {
  assert.equal(loadAiSettings({ env: {}, stored: { allowRemote: true } }).allowRemote, true);
  assert.equal(loadAiSettings({ env: {}, stored: { allowRemote: false } }).allowRemote, false);
});

test('CS2.6 allowRemote: env wins over stored', () => {
  const s = loadAiSettings({
    env: { MARKDOWN_AI_ALLOW_REMOTE: 'false' },
    stored: { allowRemote: true },
  });
  assert.equal(s.allowRemote, false);
});

test('CS2.7 allowRemote: absent when neither env nor stored set it', () => {
  const s = loadAiSettings({ env: {}, stored: { baseUrl: 'http://192.168.1.9:1234/v1' } });
  assert.equal('allowRemote' in s, false);
});

test('CS2.8 stored baseUrl that is not http(s) falls back to default', () => {
  const s = loadAiSettings({ env: {}, stored: { baseUrl: 'ftp://nope' } });
  assert.equal(s.baseUrl, DEFAULTS.baseUrl);
});

test('CS2.9 stored only influences baseUrl/model/allowRemote', () => {
  // junk / non-whitelisted stored keys never leak into other fields
  const s = loadAiSettings({
    env: {},
    stored: { provider: 'evil', maxTokens: 7, temperature: 9 },
  });
  assert.equal(s.provider, DEFAULTS.provider);
  assert.equal(s.maxTokens, DEFAULTS.maxTokens);
  assert.equal(s.temperature, DEFAULTS.temperature);
});

test('CS2.10 full combo: env model + stored baseUrl & allowRemote', () => {
  const s = loadAiSettings({
    env: { MARKDOWN_AI_MODEL: 'qwen' },
    stored: { baseUrl: 'http://192.168.1.9:1234/v1', allowRemote: true },
  });
  assert.equal(s.model, 'qwen');
  assert.equal(s.baseUrl, 'http://192.168.1.9:1234/v1');
  assert.equal(s.allowRemote, true);
});
