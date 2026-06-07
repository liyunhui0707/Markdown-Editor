/* test/ai-settings-store.test.js
   Stage C (settings panel) — CS1: persistent store for the in-app AI settings.

   lib/ai-settings-store.js persists the user-editable subset of AI settings to
   a JSON file (the IPC layer supplies Electron's userData path). It is a dumb,
   defensive persistence layer:
   - Only the whitelist baseUrl / model / allowRemote is ever read or written.
   - baseUrl / model are non-empty strings (trimmed); allowRemote is boolean.
   - Anything else (junk keys, wrong types, corrupt JSON, missing file) is
     ignored on read and never written.
   URL validity is NOT enforced here (that is the IPC save layer's job, reusing
   normalizeBaseUrl) — the store only guarantees typed JSON round-trip.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readStoredSettings, writeStoredSettings, STORED_KEYS } = require('../lib/ai-settings-store');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-store-'));
  return path.join(dir, 'ai-settings.json');
}

// ===== CS1.A — read =====

test('CS1.1 read: missing file -> {}', () => {
  const f = tmpFile(); // not created
  assert.deepEqual(readStoredSettings(f), {});
});

test('CS1.2 read: corrupt JSON -> {} (no throw)', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{ not valid json', 'utf8');
  assert.deepEqual(readStoredSettings(f), {});
});

test('CS1.3 read: empty / non-string path -> {}', () => {
  assert.deepEqual(readStoredSettings(''), {});
  assert.deepEqual(readStoredSettings(null), {});
  assert.deepEqual(readStoredSettings(undefined), {});
});

test('CS1.4 read: returns whitelisted fields only', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({
    baseUrl: 'http://192.168.1.9:1234/v1',
    model: 'llama3.1',
    allowRemote: true,
    junk: 'nope',
    provider: 'evil',
    maxTokens: 9999,
  }), 'utf8');
  assert.deepEqual(readStoredSettings(f), {
    baseUrl: 'http://192.168.1.9:1234/v1',
    model: 'llama3.1',
    allowRemote: true,
  });
});

test('CS1.5 read: wrong-typed / empty fields are dropped', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({
    baseUrl: 123,          // not a string
    model: '   ',          // blank after trim
    allowRemote: 'true',   // string, not boolean
  }), 'utf8');
  assert.deepEqual(readStoredSettings(f), {});
});

// ===== CS1.B — write =====

test('CS1.6 write -> read round-trip', () => {
  const f = tmpFile();
  const written = writeStoredSettings(f, {
    baseUrl: 'http://localhost:1234/v1', model: 'm', allowRemote: false,
  });
  assert.deepEqual(written, {
    baseUrl: 'http://localhost:1234/v1', model: 'm', allowRemote: false,
  });
  assert.deepEqual(readStoredSettings(f), written);
});

test('CS1.7 write: ignores non-whitelisted keys', () => {
  const f = tmpFile();
  const written = writeStoredSettings(f, {
    baseUrl: 'http://localhost:1234/v1', provider: 'x', maxTokens: 999,
  });
  assert.deepEqual(written, { baseUrl: 'http://localhost:1234/v1' });
  assert.equal('provider' in readStoredSettings(f), false);
});

test('CS1.8 write: partial update merges with existing', () => {
  const f = tmpFile();
  writeStoredSettings(f, { baseUrl: 'http://localhost:1234/v1', model: 'm1', allowRemote: true });
  const merged = writeStoredSettings(f, { model: 'm2' });
  assert.deepEqual(merged, {
    baseUrl: 'http://localhost:1234/v1', model: 'm2', allowRemote: true,
  });
});

test('CS1.9 write: trims string values', () => {
  const f = tmpFile();
  assert.deepEqual(writeStoredSettings(f, { model: '  spaced  ' }), { model: 'spaced' });
});

test('CS1.10 write: empty / non-string path throws', () => {
  assert.throws(() => writeStoredSettings('', { model: 'm' }), TypeError);
  assert.throws(() => writeStoredSettings(null, { model: 'm' }), TypeError);
});

test('CS1.11 STORED_KEYS is exactly the whitelist', () => {
  assert.deepEqual([...STORED_KEYS].sort(), ['allowRemote', 'baseUrl', 'model']);
});
