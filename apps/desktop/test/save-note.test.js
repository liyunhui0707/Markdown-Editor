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

const {
  checkSaveCollision,
  deriveDraftRelativePath,
  deriveRenameRelativePath,
  performSaveNote,
} = require('../lib/file-name');

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

// ── performSaveNote: real-disk rename and overwrite-protection guarantees ──
// Disk semantics must use no-overwrite create (`flag: 'wx'` → O_CREAT | O_EXCL)
// for any path the operation would create. There is no fs.renameSync; the
// existence pre-check is fast feedback, not the safety mechanism. If a file
// appears at the new target between the check and the write, the kernel-level
// EXCL flag still prevents the overwrite.

test('performSaveNote: vault note with no title change saves in place (legacy mismatch preserved)', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  // Disk file note-x.md with title-not-matching-filename. User opened it and
  // is saving with NO title change (title === loadedTitle).
  writeNote(vaultPath, 'note-x.md', '# Beautiful Title\n\nold body');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'note-x.md',
      title: 'Beautiful Title',
      loadedTitle: 'Beautiful Title',
      body: 'new body',
      frontmatter: { tags: [], source: '' },
    },
    content: '# Beautiful Title\n\nnew body',
    fs,
    path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'note-x.md');
  assert.equal(result.renamed, undefined);

  // The legacy path holds the new content; no derived-name file appeared.
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'note-x.md'), 'utf8'),
    '# Beautiful Title\n\nnew body',
  );
  assert.equal(fs.existsSync(path.join(vaultPath, 'beautiful-title.md')), false);
});

test('performSaveNote: vault note with title change is renamed (wx create + unlink old)', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'a.md', '# A\n\nold body');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'B',
      loadedTitle: 'A',
      body: 'new body',
      frontmatter: { tags: [], source: '' },
    },
    content: '# B\n\nnew body',
    fs,
    path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.renamed, true);
  assert.equal(result.relativePath, 'b.md');
  assert.equal(result.oldRelativePath, 'a.md');

  // Old gone; new has new content.
  assert.equal(fs.existsSync(path.join(vaultPath, 'a.md')), false);
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'b.md'), 'utf8'),
    '# B\n\nnew body',
  );
});

test('performSaveNote: rename target already exists → wx EEXIST, both files untouched', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'a.md', '# A\n\nA-disk');
  writeNote(vaultPath, 'b.md', '# B\n\nB-disk');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'B',
      loadedTitle: 'A',
      body: 'A-disk',
      frontmatter: { tags: [], source: '' },
    },
    content: '# B\n\nshould-not-be-written',
    fs,
    path,
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.relativePath, 'b.md');
  assert.match(result.error, /already exists/i);

  // CRITICAL: both files byte-for-byte unchanged. The wx create must NOT have
  // overwritten b.md, and a.md must NOT have been unlinked.
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'a.md'), 'utf8'),
    '# A\n\nA-disk',
  );
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'b.md'), 'utf8'),
    '# B\n\nB-disk',
  );
});

test('performSaveNote: subdirectory rename — file moves within the same dir', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'Notes/A.md', '# A\n\nbody');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'Notes/A.md',
      title: 'New Note',
      loadedTitle: 'A',
      body: 'body',
      frontmatter: { tags: [], source: '' },
    },
    content: '# New Note\n\nbody',
    fs,
    path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.renamed, true);
  assert.equal(result.relativePath, path.join('Notes', 'new-note.md'));
  assert.equal(result.oldRelativePath, 'Notes/A.md');

  assert.equal(fs.existsSync(path.join(vaultPath, 'Notes/A.md')), false);
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'Notes', 'new-note.md'), 'utf8'),
    '# New Note\n\nbody',
  );
});

test('performSaveNote: draft new file uses wx — refuses to overwrite a colliding existing file', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  // Pre-existing file the renderer's pre-check might have missed.
  writeNote(vaultPath, 'plan.md', '# Plan disk\n\nimportant');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'draft',
      relativePath: '',
      title: 'Plan',
      body: 'should-not-be-written',
      frontmatter: { tags: [], source: '' },
    },
    content: '# Plan\n\nshould-not-be-written',
    fs,
    path,
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.relativePath, 'plan.md');

  // Existing file untouched.
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'plan.md'), 'utf8'),
    '# Plan disk\n\nimportant',
  );
});

test('performSaveNote: vault save-in-place overwrites the same path (legitimate update flow)', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'a.md', '# A\n\nold');

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'A',
      loadedTitle: 'A',
      body: 'new body',
      frontmatter: { tags: [], source: '' },
    },
    content: '# A\n\nnew body',
    fs,
    path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'a.md');
  assert.equal(result.renamed, undefined);
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'a.md'), 'utf8'),
    '# A\n\nnew body',
  );
});

test('performSaveNote: unlink failure after wx success → ok:false, both files preserved (no target overwrite)', (t) => {
  const vaultPath = makeTempVault();
  t.after(() => cleanupVault(vaultPath));
  writeNote(vaultPath, 'a.md', '# A\n\nold body');

  // Wrap fs to make unlinkSync fail, while preserving everything else. The
  // wx-write to b.md must already have completed; the unlink-of-a.md must
  // throw. Assertion: helper returns ok:false with a clear error mentioning
  // both filenames; b.md exists with the new content (not lost) and a.md
  // remains intact at the OLD content (not partially modified).
  const wrappedFs = Object.assign(Object.create(fs), {
    unlinkSync(p) {
      throw Object.assign(new Error('simulated unlink failure'), { code: 'EBUSY' });
    },
  });

  const result = performSaveNote({
    vaultPath,
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'B',
      loadedTitle: 'A',
      body: 'new body',
      frontmatter: { tags: [], source: '' },
    },
    content: '# B\n\nnew body',
    fs: wrappedFs,
    path,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /a\.md/);
  assert.match(result.error, /b\.md/);
  // Both files exist:
  //   - new content at b.md (the wx create did succeed before unlink failed)
  //   - the original at a.md is unchanged (we never touched a.md before unlink)
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'a.md'), 'utf8'),
    '# A\n\nold body',
    "a.md must remain intact when unlink fails — no data loss",
  );
  assert.equal(
    fs.readFileSync(path.join(vaultPath, 'b.md'), 'utf8'),
    '# B\n\nnew body',
    "b.md must contain the new content (the wx create succeeded before unlink failed)",
  );
});
