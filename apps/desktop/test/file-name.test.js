/* TDD: filename derivation + duplicate-name guard.
   Run: node --test test/file-name.test.js

   The same module is consumed by:
     - the renderer (loaded via <script src="./lib/file-name.js">), which uses
       it to pre-check that a save will not silently overwrite an existing
       note in the in-memory `notes` array.
     - the main process (require('./lib/file-name')), which uses it to refuse
       to overwrite a file already present on disk.

   Both layers must use the same derivation rule, otherwise the renderer's
   advisory check and the main process's authoritative guard will diverge.
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const {
  sanitizeFileName,
  deriveDraftRelativePath,
  deriveRenameRelativePath,
  deriveNoteRelativePath,
  findRelativePathConflict,
  checkSaveCollision,
} = require('../lib/file-name');

// ── sanitizeFileName ───────────────────────────────────────────────────────
test('sanitizeFileName: simple ASCII title', () => {
  assert.equal(sanitizeFileName('X'), 'x');
});

test('sanitizeFileName: trims surrounding whitespace', () => {
  assert.equal(sanitizeFileName(' X '), 'x');
});

test('sanitizeFileName: strips illegal filesystem chars', () => {
  assert.equal(sanitizeFileName('X?'),   'x');
  assert.equal(sanitizeFileName('X*'),   'x');
  assert.equal(sanitizeFileName('A/B'),  'ab');
  assert.equal(sanitizeFileName('A\\B'), 'ab');
  assert.equal(sanitizeFileName('A:B'),  'ab');
  assert.equal(sanitizeFileName('A|B'),  'ab');
  assert.equal(sanitizeFileName('A<B>'), 'ab');
  assert.equal(sanitizeFileName('A"B'),  'ab');
});

test('sanitizeFileName: collapses internal whitespace runs to single hyphen', () => {
  assert.equal(sanitizeFileName('My Note'),    'my-note');
  assert.equal(sanitizeFileName('My  Note'),   'my-note');
  assert.equal(sanitizeFileName('  my note '), 'my-note');
});

test('sanitizeFileName: lowercases mixed-case input', () => {
  assert.equal(sanitizeFileName('Welcome'),     'welcome');
  assert.equal(sanitizeFileName('PROJECT XYZ'), 'project-xyz');
});

test('sanitizeFileName: returns empty string when only illegal chars remain', () => {
  assert.equal(sanitizeFileName('?<>'), '');
  assert.equal(sanitizeFileName('   '), '');
});

// ── deriveDraftRelativePath ────────────────────────────────────────────────
test('deriveDraftRelativePath: simple title', () => {
  assert.equal(deriveDraftRelativePath('X'), 'x.md');
});

test('deriveDraftRelativePath: trims and lowercases', () => {
  assert.equal(deriveDraftRelativePath(' X '),     'x.md');
  assert.equal(deriveDraftRelativePath('X?'),      'x.md');
  assert.equal(deriveDraftRelativePath('My Note'), 'my-note.md');
});

test('deriveDraftRelativePath: empty / illegal-only / falsy → untitled-note.md', () => {
  assert.equal(deriveDraftRelativePath(''),        'untitled-note.md');
  assert.equal(deriveDraftRelativePath('   '),     'untitled-note.md');
  assert.equal(deriveDraftRelativePath('?<>'),     'untitled-note.md');
  assert.equal(deriveDraftRelativePath(null),      'untitled-note.md');
  assert.equal(deriveDraftRelativePath(undefined), 'untitled-note.md');
});

// ── deriveNoteRelativePath ─────────────────────────────────────────────────
// For collision detection, every note (vault or draft) must answer the
// question "what relativePath would you occupy on disk?". Vault notes
// already know — they reuse their stored relativePath. Drafts derive one
// from their current title.
test('deriveNoteRelativePath: vault note reuses its existing relativePath', () => {
  const note = { source: 'vault', relativePath: 'Notes/A.md', title: 'whatever' };
  assert.equal(deriveNoteRelativePath(note), 'Notes/A.md');
});

test('deriveNoteRelativePath: draft derives from title', () => {
  assert.equal(deriveNoteRelativePath({ source: 'draft', title: 'My Note' }), 'my-note.md');
});

test('deriveNoteRelativePath: vault note without relativePath falls back to title-derived', () => {
  // Defensive: a malformed vault note (missing relativePath) should still
  // produce a candidate path so collision detection works.
  assert.equal(
    deriveNoteRelativePath({ source: 'vault', relativePath: '', title: 'Stray' }),
    'stray.md'
  );
});

// ── findRelativePathConflict (renderer pre-check) ──────────────────────────
test('findRelativePathConflict: returns null when no conflict', () => {
  const notes = [
    { id: 'vault:a.md', source: 'vault', relativePath: 'a.md', title: 'A' },
    { id: 'vault:b.md', source: 'vault', relativePath: 'b.md', title: 'B' },
  ];
  assert.equal(
    findRelativePathConflict({ notes, candidateRelativePath: 'c.md', excludeId: 'draft:1' }),
    null,
  );
});

test('findRelativePathConflict: catches exact match against vault note', () => {
  const notes = [
    { id: 'vault:note.md', source: 'vault', relativePath: 'note.md', title: 'Note' },
  ];
  const conflict = findRelativePathConflict({
    notes,
    candidateRelativePath: 'note.md',
    excludeId: 'draft:1',
  });
  assert.ok(conflict, 'expected to find a conflicting note');
  assert.equal(conflict.id, 'vault:note.md');
});

test('findRelativePathConflict: case-insensitive match (macOS APFS reality)', () => {
  const notes = [
    { id: 'vault:Welcome.md', source: 'vault', relativePath: 'Welcome.md', title: 'Welcome' },
  ];
  const conflict = findRelativePathConflict({
    notes,
    candidateRelativePath: 'welcome.md',
    excludeId: 'draft:1',
  });
  assert.ok(conflict, 'WELCOME-vs-welcome must collide on case-insensitive filesystems');
});

test('findRelativePathConflict: catches another draft with same derived path', () => {
  const notes = [
    { id: 'draft:1', source: 'draft', relativePath: '', title: 'X' },
    { id: 'draft:2', source: 'draft', relativePath: '', title: 'X' },
  ];
  const conflict = findRelativePathConflict({
    notes,
    candidateRelativePath: 'x.md',
    excludeId: 'draft:1',
  });
  assert.ok(conflict);
  assert.equal(conflict.id, 'draft:2');
});

test('findRelativePathConflict: ignores excludeId (the saver itself)', () => {
  const notes = [
    { id: 'draft:1', source: 'draft', relativePath: '', title: 'X' },
  ];
  const conflict = findRelativePathConflict({
    notes,
    candidateRelativePath: 'x.md',
    excludeId: 'draft:1',
  });
  assert.equal(conflict, null);
});

// ── checkSaveCollision (main-process guard, dependency-injected fs) ────────
function makeFsMock(existingPaths) {
  const set = new Set(existingPaths);
  return (p) => set.has(p);
}

const fakePath = {
  join: (...parts) => parts.filter(Boolean).join('/'),
};

test('checkSaveCollision: vault note with existing relativePath always passes', () => {
  // Re-saving a vault note targets its own existing file. Even if the path
  // exists on disk (it does — that's its file), this is the legitimate
  // update flow and must not be blocked.
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: { source: 'vault', relativePath: 'a.md', title: 'A' },
    fileExistsSync: makeFsMock(['/vault/a.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'a.md');
  assert.equal(result.conflict, undefined);
});

test('checkSaveCollision: draft whose derived path is free → ok', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: { source: 'draft', relativePath: '', title: 'New Note' },
    fileExistsSync: makeFsMock([]),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'new-note.md');
});

test('checkSaveCollision: draft colliding with existing file is rejected', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: { source: 'draft', relativePath: '', title: 'X' },
    fileExistsSync: makeFsMock(['/vault/x.md']),
    path: fakePath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.relativePath, 'x.md');
  assert.equal(result.conflict, true);
  assert.match(result.error, /already exists/i);
  assert.match(result.error, /x\.md/i);
});

test('checkSaveCollision: empty-title draft collides with existing untitled-note.md', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: { source: 'draft', relativePath: '', title: '' },
    fileExistsSync: makeFsMock(['/vault/untitled-note.md']),
    path: fakePath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.relativePath, 'untitled-note.md');
});

test('checkSaveCollision: draft with whitespace title collides with existing kebab-case file', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: { source: 'draft', relativePath: '', title: 'My Note' },
    fileExistsSync: makeFsMock(['/vault/my-note.md']),
    path: fakePath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.relativePath, 'my-note.md');
});

// ── deriveRenameRelativePath ───────────────────────────────────────────────
// For an existing vault note, rename keeps the same parent directory and
// replaces just the basename via the standard sanitize rule.
test('deriveRenameRelativePath: root-level note', () => {
  assert.equal(deriveRenameRelativePath('a.md', 'B'), 'b.md');
});

test('deriveRenameRelativePath: keeps parent directory', () => {
  assert.equal(deriveRenameRelativePath('Notes/A.md', 'B'),         'Notes/b.md');
  assert.equal(deriveRenameRelativePath('Notes/Sub/A.md', 'New T'), 'Notes/Sub/new-t.md');
});

test('deriveRenameRelativePath: empty / illegal-only title falls back to untitled-note in same dir', () => {
  assert.equal(deriveRenameRelativePath('Notes/A.md', ''),    'Notes/untitled-note.md');
  assert.equal(deriveRenameRelativePath('Notes/A.md', '?<>'), 'Notes/untitled-note.md');
  assert.equal(deriveRenameRelativePath('a.md', ''),          'untitled-note.md');
});

test('deriveRenameRelativePath: lowercased target equals source (case-only target)', () => {
  // The derivation always lowercases. An on-disk file at a.md retitled to
  // 'A' produces 'a.md' — same as the source. Callers compare lowercased to
  // detect this case-only-no-op.
  assert.equal(deriveRenameRelativePath('a.md', 'A'), 'a.md');
});

test('deriveRenameRelativePath: handles missing/empty old path defensively', () => {
  assert.equal(deriveRenameRelativePath('',        'X'), 'x.md');
  assert.equal(deriveRenameRelativePath(null,      'X'), 'x.md');
  assert.equal(deriveRenameRelativePath(undefined, 'X'), 'x.md');
});

test('deriveRenameRelativePath: handles backslash separators (Windows-style relativePaths)', () => {
  assert.equal(deriveRenameRelativePath('Notes\\A.md', 'B'), 'Notes\\b.md');
});

// ── checkSaveCollision: vault rename gate ──────────────────────────────────
// Rename fires only when the user has actually changed the title since the
// note was loaded (note.title !== note.loadedTitle) AND the derived target
// differs from the current relativePath case-insensitively. Pre-existing
// title/filename mismatches stay put on save when the user hasn't touched
// the title.
test('checkSaveCollision: vault note with no title change saves in place even when filename mismatches title', () => {
  // Disk file note-x.md has the parsed title 'Beautiful Title'. The user
  // didn't change the title. Saving must NOT rename despite the mismatch.
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'note-x.md',
      title: 'Beautiful Title',
      loadedTitle: 'Beautiful Title',
    },
    fileExistsSync: makeFsMock(['/vault/note-x.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'note-x.md');
  assert.equal(result.renamed, undefined);
  assert.equal(result.oldRelativePath, undefined);
});

test('checkSaveCollision: vault note title changed to a free target → renamed:true with oldRelativePath', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'Hello world',
      loadedTitle: 'A',
    },
    fileExistsSync: makeFsMock(['/vault/a.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'hello-world.md');
  assert.equal(result.renamed, true);
  assert.equal(result.oldRelativePath, 'a.md');
});

test('checkSaveCollision: vault note rename to a target that already exists → conflict', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'B',
      loadedTitle: 'A',
    },
    fileExistsSync: makeFsMock(['/vault/a.md', '/vault/b.md']),
    path: fakePath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.conflict, true);
  assert.equal(result.relativePath, 'b.md');
  assert.match(result.error, /already exists/i);
  assert.match(result.error, /b\.md/i);
});

test('checkSaveCollision: vault note title changed but derived path equals current (case-only) → no rename', () => {
  // user retypes 'a' (lowercase) where loaded was 'A' (uppercase). Derived
  // 'a.md' equals current 'a.md' — same file on disk. No rename, save in
  // place. The on-file `# Title` line will reflect the new casing.
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'a',
      loadedTitle: 'A',
    },
    fileExistsSync: makeFsMock(['/vault/a.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'a.md');
  assert.equal(result.renamed, undefined);
});

test('checkSaveCollision: subdirectory rename keeps the same parent directory', () => {
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'Notes/A.md',
      title: 'B',
      loadedTitle: 'A',
    },
    fileExistsSync: makeFsMock(['/vault/Notes/A.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.renamed, true);
  assert.equal(result.relativePath, 'Notes/b.md');
  assert.equal(result.oldRelativePath, 'Notes/A.md');
});

test('checkSaveCollision: missing loadedTitle defaults to current title → no rename (defense in depth)', () => {
  // If the renderer omits loadedTitle, main treats title as unchanged. This
  // is the safe default — no silent rename.
  const result = checkSaveCollision({
    vaultPath: '/vault',
    note: {
      source: 'vault',
      relativePath: 'a.md',
      title: 'B',
      // loadedTitle is intentionally omitted
    },
    fileExistsSync: makeFsMock(['/vault/a.md']),
    path: fakePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'a.md');
  assert.equal(result.renamed, undefined);
});
