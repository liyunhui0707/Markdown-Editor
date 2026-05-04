/* TDD: dirty-state — pure helpers used by Stage 6.1.
   Run: node --test test/dirty-state.test.js

   isNoteDirty(note) is the single source of truth for "this note has
   unsaved work". It's derived from the existing note model:
     - vault notes carry loadedTitle (from main.js parseMarkdownFile) and
       gain a loadedBody snapshot (set by refreshVaultNotes when notes
       are loaded from disk). A vault note is dirty iff body or title
       has diverged from the loaded snapshot.
     - draft notes (source === 'draft') are dirty iff the user has put
       any meaningful content into them: a non-empty body, or a title
       that is something other than the bare 'Untitled note' placeholder.

   summarizeDirty(notes) tallies dirty notes by category. Used by the
   renderer for sidebar counts and (Stage 6.3) the close-time guard.

   Both helpers are total: null / undefined / missing fields are safe.
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { isNoteDirty, summarizeDirty } = require('../lib/dirty-state');

// ── isNoteDirty: defensive ──────────────────────────────────────────

test('isNoteDirty: null/undefined/empty returns false', () => {
  assert.equal(isNoteDirty(null), false);
  assert.equal(isNoteDirty(undefined), false);
  assert.equal(isNoteDirty({}), false);
});

// ── isNoteDirty: drafts ─────────────────────────────────────────────

test('isNoteDirty: empty draft (default placeholder) is NOT dirty', () => {
  const note = { source: 'draft', title: 'Untitled note', body: '' };
  assert.equal(isNoteDirty(note), false);
});

test('isNoteDirty: empty draft with empty title is NOT dirty', () => {
  const note = { source: 'draft', title: '', body: '' };
  assert.equal(isNoteDirty(note), false);
});

test('isNoteDirty: draft with whitespace-only title and body is NOT dirty', () => {
  const note = { source: 'draft', title: '   ', body: '\n\n  \n' };
  assert.equal(isNoteDirty(note), false);
});

test('isNoteDirty: draft with non-empty body IS dirty (even with placeholder title)', () => {
  const note = { source: 'draft', title: 'Untitled note', body: 'Some content.' };
  assert.equal(isNoteDirty(note), true);
});

test('isNoteDirty: draft with non-placeholder title IS dirty (even with empty body)', () => {
  const note = { source: 'draft', title: 'My new idea', body: '' };
  assert.equal(isNoteDirty(note), true);
});

test('isNoteDirty: draft with both title AND body filled IS dirty', () => {
  const note = { source: 'draft', title: 'Idea', body: 'Body text' };
  assert.equal(isNoteDirty(note), true);
});

// ── isNoteDirty: vault notes ────────────────────────────────────────

test('isNoteDirty: pristine vault note (body matches loadedBody, title matches loadedTitle) is NOT dirty', () => {
  const note = {
    source: 'vault',
    title: 'Hello',
    loadedTitle: 'Hello',
    body: '# Hello\n\nworld',
    loadedBody: '# Hello\n\nworld',
  };
  assert.equal(isNoteDirty(note), false);
});

test('isNoteDirty: vault note with body diverged from loadedBody IS dirty', () => {
  const note = {
    source: 'vault',
    title: 'Hello',
    loadedTitle: 'Hello',
    body: '# Hello\n\nedited',
    loadedBody: '# Hello\n\nworld',
  };
  assert.equal(isNoteDirty(note), true);
});

test('isNoteDirty: vault note with title diverged from loadedTitle IS dirty', () => {
  const note = {
    source: 'vault',
    title: 'Hello (renamed)',
    loadedTitle: 'Hello',
    body: '# Hello\n\nworld',
    loadedBody: '# Hello\n\nworld',
  };
  assert.equal(isNoteDirty(note), true);
});

test('isNoteDirty: vault note returning to original body via undo is NOT dirty (strict equality)', () => {
  const original = '# Hello\n\nworld';
  const note = {
    source: 'vault',
    title: 'Hello',
    loadedTitle: 'Hello',
    body: original,        // typed, then untyped back to original
    loadedBody: original,
  };
  assert.equal(isNoteDirty(note), false);
});

// ── isNoteDirty: AI-imported (still vault-source) ───────────────────

test('isNoteDirty: AI-imported vault note follows vault rules (pristine = clean)', () => {
  const note = {
    source: 'vault',
    aiImported: true,
    title: 'Imported',
    loadedTitle: 'Imported',
    body: 'a',
    loadedBody: 'a',
  };
  assert.equal(isNoteDirty(note), false);
});

test('isNoteDirty: edited AI-imported vault note IS dirty', () => {
  const note = {
    source: 'vault',
    aiImported: true,
    title: 'Imported',
    loadedTitle: 'Imported',
    body: 'a edited',
    loadedBody: 'a',
  };
  assert.equal(isNoteDirty(note), true);
});

// ── summarizeDirty ──────────────────────────────────────────────────

test('summarizeDirty: empty/non-array input returns zeros', () => {
  assert.deepEqual(summarizeDirty([]),         { count: 0, hasDraft: false, hasDirtyVault: false });
  assert.deepEqual(summarizeDirty(null),       { count: 0, hasDraft: false, hasDirtyVault: false });
  assert.deepEqual(summarizeDirty(undefined),  { count: 0, hasDraft: false, hasDirtyVault: false });
});

test('summarizeDirty: all-clean vault notes count as zero', () => {
  const notes = [
    { source: 'vault', title: 'A', loadedTitle: 'A', body: 'x', loadedBody: 'x' },
    { source: 'vault', title: 'B', loadedTitle: 'B', body: 'y', loadedBody: 'y' },
  ];
  assert.deepEqual(summarizeDirty(notes), { count: 0, hasDraft: false, hasDirtyVault: false });
});

test('summarizeDirty: counts mixed dirty notes by category', () => {
  const notes = [
    { source: 'vault', title: 'A', loadedTitle: 'A', body: 'x', loadedBody: 'x' },     // clean vault
    { source: 'vault', title: 'B', loadedTitle: 'B', body: 'edited', loadedBody: 'y' },  // dirty vault
    { source: 'draft', title: 'New idea', body: '' },                                   // dirty draft
    { source: 'draft', title: 'Untitled note', body: '' },                              // empty draft (clean)
    { source: 'draft', title: 'Untitled note', body: 'wrote something' },               // dirty draft
  ];
  assert.deepEqual(summarizeDirty(notes), { count: 3, hasDraft: true, hasDirtyVault: true });
});

test('summarizeDirty: only-draft case has hasDirtyVault=false', () => {
  const notes = [
    { source: 'draft', title: 'Untitled note', body: 'hi' },
  ];
  assert.deepEqual(summarizeDirty(notes), { count: 1, hasDraft: true, hasDirtyVault: false });
});

test('summarizeDirty: only-vault case has hasDraft=false', () => {
  const notes = [
    { source: 'vault', title: 'A', loadedTitle: 'A', body: 'edited', loadedBody: 'orig' },
  ];
  assert.deepEqual(summarizeDirty(notes), { count: 1, hasDraft: false, hasDirtyVault: true });
});
