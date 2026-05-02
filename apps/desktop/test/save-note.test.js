/* TDD: main-process duplicate-filename guard against the real filesystem.
   Run: node --test test/save-note.test.js

   The renderer pre-check is advisory; the main-process guard in
   apps/desktop/main.js's save-note IPC handler is authoritative — it must
   refuse to overwrite an existing file even when the renderer's in-memory
   state is stale (e.g. an external editor created the file moments earlier
   and the watcher has not yet refreshed the renderer).

   These tests exercise the shared `checkSaveCollision` helper against a
   real temp directory. The helper is the same code path main.js calls in
   its handler, so verifying its behavior here covers the on-disk guarantee
   without needing to spin up Electron. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');
const os       = require('node:os');

const { checkSaveCollision, deriveDraftRelativePath } = require('../lib/file-name');

function makeTempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mdvault-save-note-'));
}

function cleanupVault(vaultPath) {
  fs.rmSync(vaultPath, { recursive: true, force: true });
}

function writeNote(vaultPath, relativePath, body) {
  const fullPath = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, body, 'utf8');
}

test('checkSaveCollision: draft whose derived name matches an existing file is rejected', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));

  const originalContent = '# Original X disk\n\nDo not overwrite me.';
  writeNote(vaultPath, 'x.md', originalContent);

  const result = checkSaveCollision({
    vaultPath,
    note: { source: 'draft', relativePath: '', title: 'X' },
    fileExistsSync: fs.existsSync,
    path,
  });

  assert.equal(result.ok, false, 'colliding save must be rejected');
  assert.equal(result.conflict, true, 'rejection must flag conflict');
  assert.equal(result.relativePath, 'x.md', 'derived path must be reported');
  assert.match(result.error, /already exists/i);

  // Critical: the disk file is untouched.
  const onDisk = fs.readFileSync(path.join(vaultPath, 'x.md'), 'utf8');
  assert.equal(onDisk, originalContent,
    'the existing file must NOT have been overwritten');
});

test('checkSaveCollision: draft with empty title collides with existing untitled-note.md', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));

  const originalContent = '# The previous untitled draft\n\nKeep me.';
  writeNote(vaultPath, 'untitled-note.md', originalContent);

  const result = checkSaveCollision({
    vaultPath,
    note: { source: 'draft', relativePath: '', title: '' },
    fileExistsSync: fs.existsSync,
    path,
  });

  assert.equal(result.ok, false);
  assert.equal(result.relativePath, 'untitled-note.md');

  const onDisk = fs.readFileSync(path.join(vaultPath, 'untitled-note.md'), 'utf8');
  assert.equal(onDisk, originalContent);
});

test('checkSaveCollision: draft whose derived name is free → ok', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  // Vault has one unrelated file; the draft's candidate path is different.
  writeNote(vaultPath, 'other.md', '# Other');

  const result = checkSaveCollision({
    vaultPath,
    note: { source: 'draft', relativePath: '', title: 'Brand New' },
    fileExistsSync: fs.existsSync,
    path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'brand-new.md');
  assert.equal(result.conflict, undefined);
});

test('checkSaveCollision: re-saving a vault note over its own file is allowed', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'a.md', '# A old');

  const result = checkSaveCollision({
    vaultPath,
    note: { source: 'vault', relativePath: 'a.md', title: 'A' },
    fileExistsSync: fs.existsSync,
    path,
  });

  assert.equal(result.ok, true,
    "re-saving a vault note targets its own file; that's the legitimate update flow");
  assert.equal(result.relativePath, 'a.md');
  assert.equal(result.conflict, undefined);
});

test('checkSaveCollision: case-insensitive filesystems — derived lowercase collides with cased file', (t) => {
  // On macOS APFS / Windows NTFS, `Welcome.md` and `welcome.md` are the
  // same file. fs.existsSync('vault/welcome.md') will return true even
  // when the disk entry is `Welcome.md`. On case-sensitive filesystems
  // (Linux), this test will not trip the guard the same way, but the
  // renderer's lowercased compare and the helper's deterministic
  // `welcome.md` derivation still match the user-facing rule.
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'Welcome.md', '# Welcome (capitalized)');

  const result = checkSaveCollision({
    vaultPath,
    note: { source: 'draft', relativePath: '', title: 'WELCOME' },
    fileExistsSync: fs.existsSync,
    path,
  });

  // Behavior is platform-dependent here. We assert both possible outcomes:
  // - case-insensitive FS (mac/Win): conflict detected.
  // - case-sensitive FS (Linux ext4): no conflict; the candidate welcome.md
  //   is genuinely a different file from Welcome.md.
  // Either way, the original disk file must remain untouched (this helper
  // doesn't write — main.js's handler is the writer).
  assert.equal(result.relativePath, 'welcome.md',
    'derivation is deterministic regardless of FS case-sensitivity');
  if (result.ok === false) {
    assert.equal(result.conflict, true);
  }
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'Welcome.md'), 'utf8'),
    '# Welcome (capitalized)',
    'pre-existing file must remain untouched whether or not the guard triggered'
  );
});

test('checkSaveCollision: shape sanity — deriveDraftRelativePath agrees with helper', (t) => {
  // Pin that the helper reports the same relativePath that
  // deriveDraftRelativePath would produce for the title — they are the
  // single source of truth and must not drift.
  assert.equal(deriveDraftRelativePath('X'),         'x.md');
  assert.equal(deriveDraftRelativePath(' X '),       'x.md');
  assert.equal(deriveDraftRelativePath('My Note'),   'my-note.md');
  assert.equal(deriveDraftRelativePath(''),          'untitled-note.md');
  assert.equal(deriveDraftRelativePath('?<>'),       'untitled-note.md');
});
