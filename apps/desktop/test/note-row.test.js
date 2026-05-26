/* TDD: note-row — pure helpers used by the note-list row redesign.
   Run: node --test test/note-row.test.js

   These helpers compute per-row presentational data from the existing
   note model. They must be:
     - pure (no DOM, no mutation of the input note)
     - safe on null / undefined / missing fields
     - aligned with the Stage 5.3 rules:
         badge: AI takes precedence over Draft; vault notes get no badge
         tags : show up to `max` (default 3); rest collapses to overflow
*/
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { computeNoteBadge, computeNoteDirtyBadge, computeNoteTags } = require('../lib/note-row');

// ── computeNoteBadge ────────────────────────────────────────────────

test('computeNoteBadge: AI-imported note returns the AI badge', () => {
  const note = { aiImported: true, source: 'vault' };
  assert.deepEqual(computeNoteBadge(note), { kind: 'ai', label: 'AI' });
});

test('computeNoteBadge: draft note returns the Draft badge', () => {
  const note = { aiImported: false, source: 'draft' };
  assert.deepEqual(computeNoteBadge(note), { kind: 'draft', label: 'Draft' });
});

test('computeNoteBadge: vault note returns null', () => {
  const note = { aiImported: false, source: 'vault' };
  assert.equal(computeNoteBadge(note), null);
});

test('computeNoteBadge: AI takes precedence over Draft when both apply', () => {
  const note = { aiImported: true, source: 'draft' };
  assert.deepEqual(computeNoteBadge(note), { kind: 'ai', label: 'AI' });
});

test('computeNoteBadge: missing source defaults to no badge when not AI', () => {
  const note = { aiImported: false };
  assert.equal(computeNoteBadge(note), null);
});

test('computeNoteBadge: null/undefined/empty note input returns null', () => {
  assert.equal(computeNoteBadge(null), null);
  assert.equal(computeNoteBadge(undefined), null);
  assert.equal(computeNoteBadge({}), null);
});

// ── Stage 6.1: dirty hint extends the Draft case ────────────────────

test('computeNoteBadge: dirty vault note returns the Draft badge', () => {
  const note = { aiImported: false, source: 'vault' };
  assert.deepEqual(computeNoteBadge(note, true), { kind: 'draft', label: 'Draft' });
});

test('computeNoteBadge: clean vault note returns null even with isDirty=false', () => {
  const note = { aiImported: false, source: 'vault' };
  assert.equal(computeNoteBadge(note, false), null);
});

test('computeNoteBadge: AI takes precedence over dirty hint', () => {
  const note = { aiImported: true, source: 'vault' };
  assert.deepEqual(computeNoteBadge(note, true), { kind: 'ai', label: 'AI' });
});

test('computeNoteBadge: draft + dirty still returns Draft (no double badge)', () => {
  const note = { aiImported: false, source: 'draft' };
  assert.deepEqual(computeNoteBadge(note, true), { kind: 'draft', label: 'Draft' });
});

test('computeNoteBadge: omitted isDirty preserves pre-Stage-6.1 behavior for vault notes', () => {
  const note = { aiImported: false, source: 'vault' };
  assert.equal(computeNoteBadge(note), null);
});

// ── Stage 6.8: secondary dirty badge for modified AI imports ────────

test('computeNoteDirtyBadge: dirty AI-imported vault note returns the Draft badge', () => {
  const note = { aiImported: true, source: 'vault' };
  assert.deepEqual(
    computeNoteDirtyBadge(note, true),
    { kind: 'draft', label: 'Draft' },
  );
});

test('computeNoteDirtyBadge: clean AI-imported vault note returns null', () => {
  const note = { aiImported: true, source: 'vault' };
  assert.equal(computeNoteDirtyBadge(note, false), null);
  assert.equal(computeNoteDirtyBadge(note),        null);
});

test('computeNoteDirtyBadge: dirty plain vault note returns null (primary badge already conveys it)', () => {
  const note = { aiImported: false, source: 'vault' };
  assert.equal(computeNoteDirtyBadge(note, true), null);
});

test('computeNoteDirtyBadge: dirty draft returns null (drafts already render Draft via primary)', () => {
  const note = { source: 'draft' };
  assert.equal(computeNoteDirtyBadge(note, true), null);
});

test('computeNoteDirtyBadge: null / undefined / empty note returns null', () => {
  assert.equal(computeNoteDirtyBadge(null, true),      null);
  assert.equal(computeNoteDirtyBadge(undefined, true), null);
  assert.equal(computeNoteDirtyBadge({}, true),        null);
});

// ── computeNoteTags ─────────────────────────────────────────────────

test('computeNoteTags: missing frontmatter returns empty', () => {
  assert.deepEqual(computeNoteTags({}), { visible: [], overflow: 0 });
});

test('computeNoteTags: missing tags array returns empty', () => {
  assert.deepEqual(computeNoteTags({ frontmatter: {} }), { visible: [], overflow: 0 });
});

test('computeNoteTags: empty tags array returns empty', () => {
  assert.deepEqual(computeNoteTags({ frontmatter: { tags: [] } }), { visible: [], overflow: 0 });
});

test('computeNoteTags: 1 tag visible, 0 overflow', () => {
  const note = { frontmatter: { tags: ['ai'] } };
  assert.deepEqual(computeNoteTags(note), { visible: ['ai'], overflow: 0 });
});

test('computeNoteTags: exactly 3 tags all visible, 0 overflow', () => {
  const note = { frontmatter: { tags: ['a', 'b', 'c'] } };
  assert.deepEqual(computeNoteTags(note), { visible: ['a', 'b', 'c'], overflow: 0 });
});

test('computeNoteTags: 4 tags → 3 visible + overflow 1', () => {
  const note = { frontmatter: { tags: ['a', 'b', 'c', 'd'] } };
  assert.deepEqual(computeNoteTags(note), { visible: ['a', 'b', 'c'], overflow: 1 });
});

test('computeNoteTags: 5 tags → 3 visible + overflow 2', () => {
  const note = { frontmatter: { tags: ['a', 'b', 'c', 'd', 'e'] } };
  assert.deepEqual(computeNoteTags(note), { visible: ['a', 'b', 'c'], overflow: 2 });
});

test('computeNoteTags: explicit max overrides the default', () => {
  const note = { frontmatter: { tags: ['a', 'b', 'c', 'd'] } };
  assert.deepEqual(computeNoteTags(note, 2), { visible: ['a', 'b'], overflow: 2 });
});

test('computeNoteTags: non-array tags (defensive) returns empty', () => {
  assert.deepEqual(computeNoteTags({ frontmatter: { tags: 'ai' } }),  { visible: [], overflow: 0 });
  assert.deepEqual(computeNoteTags({ frontmatter: { tags: null } }),  { visible: [], overflow: 0 });
  assert.deepEqual(computeNoteTags({ frontmatter: { tags: 42 } }),    { visible: [], overflow: 0 });
});

test('computeNoteTags: null/undefined note input returns empty', () => {
  assert.deepEqual(computeNoteTags(null),      { visible: [], overflow: 0 });
  assert.deepEqual(computeNoteTags(undefined), { visible: [], overflow: 0 });
});
