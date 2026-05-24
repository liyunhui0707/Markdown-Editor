/* Stage S2 — main.js wiring for the session-import IPC module.
   Run focused: node --test test/session-viewer/main-wiring.test.js
   Test T-S2-12. Source-shape test: asserts main.js requires the new
   IPC module and registers it, and that loadVaultNotes-side note shaping
   sets a `sessionsImport` flag.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_PATH = path.join(__dirname, '..', '..', 'main.js');

function readMain() {
  return fs.readFileSync(MAIN_PATH, 'utf8');
}

test('S2-12: main.js requires the new session-import-ipc module', () => {
  const src = readMain();
  assert.match(src, /require\(['"]\.\/lib\/session-import-ipc['"]\)/);
});

test('S2-12: main.js calls .register(ipcMain) on the new module', () => {
  const src = readMain();
  assert.match(src, /\.register\(\s*ipcMain\b/);
});

test('S2-12: main.js sets a sessionsImport flag on loaded notes', () => {
  const src = readMain();
  assert.match(src, /sessionsImport/);
  assert.match(src, /isSessionsImport/);
});

test('S2-12: no IPC channel-name collision with existing handlers', () => {
  const src = readMain();
  for (const ch of [
    'choose-vault-folder',
    'watch-vault-folder',
    'unwatch-vault-folder',
    'seed-demo-vault',
    'save-note',
    'delete-note-file',
    'load-vault-notes',
    'open-external-link',
  ]) {
    assert.match(
      src,
      new RegExp(`ipcMain\\.handle\\(['"]${ch}['"]`),
      `existing handler ${ch} preserved`,
    );
  }
});
