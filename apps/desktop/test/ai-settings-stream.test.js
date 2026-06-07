/* test/ai-settings-stream.test.js
   CB1 — Stage B: MARKDOWN_AI_STREAMING env var.

   Contract D9: when the env key is ABSENT (including empty string), the
   returned settings object does NOT contain a `streaming` field. This
   preserves the v0.2.0 T1.1 deepEqual invariant against the 7-field
   default shape. When the env key is present and non-empty, the field is
   added: 'false' (case-insensitive) → false; anything else → true.
   Consumer pattern is `settings.streaming ?? true` (default ON).
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAiSettings } = require('../lib/ai-settings');

test('CB1.1 empty env: streaming field is ABSENT (T1.1 deepEqual preserved)', () => {
  const s = loadAiSettings({ env: {} });
  assert.equal('streaming' in s, false);
  assert.equal(s.streaming, undefined);
});

test('CB1.2 explicit "true": streaming === true', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: 'true' } });
  assert.equal(s.streaming, true);
});

test('CB1.3 explicit "false": streaming === false', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: 'false' } });
  assert.equal(s.streaming, false);
});

test('CB1.4 forgiving non-"false": any other non-empty value → true', () => {
  for (const raw of ['yes', '1', 'TRUE', 'on', '0', 'no']) {
    const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: raw } });
    assert.equal(s.streaming, true, `expected true for ${JSON.stringify(raw)}`);
  }
});

test('CB1.5 case-insensitive "false": FALSE / False / fAlSe → false', () => {
  for (const raw of ['FALSE', 'False', 'fAlSe']) {
    const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: raw } });
    assert.equal(s.streaming, false, `expected false for ${JSON.stringify(raw)}`);
  }
});

test('CB1.6 empty-string env: field ABSENT (treated as unset, matches CB1.1)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: '' } });
  assert.equal('streaming' in s, false);
  assert.equal(s.streaming, undefined);
});

test('CB1.7 whitespace-only env: field ABSENT (treated as unset)', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: '   ' } });
  assert.equal('streaming' in s, false);
});

test('CB1.8 env around "false" with surrounding whitespace: trimmed → false', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: '  false  ' } });
  assert.equal(s.streaming, false);
});

test('CB1.9 setting streaming does not perturb other 7 default fields', () => {
  const base = loadAiSettings({ env: {} });
  const withStreaming = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: 'true' } });
  for (const key of Object.keys(base)) {
    assert.deepEqual(withStreaming[key], base[key], `field ${key} changed`);
  }
  // and the only new key is `streaming`
  const extraKeys = Object.keys(withStreaming).filter((k) => !(k in base));
  assert.deepEqual(extraKeys, ['streaming']);
});

test('CB1.10 consumer default pattern: settings.streaming ?? true is true when absent', () => {
  const s = loadAiSettings({ env: {} });
  assert.equal(s.streaming ?? true, true);
});

test('CB1.11 consumer default pattern: settings.streaming ?? true is false when env says false', () => {
  const s = loadAiSettings({ env: { MARKDOWN_AI_STREAMING: 'false' } });
  assert.equal(s.streaming ?? true, false);
});
