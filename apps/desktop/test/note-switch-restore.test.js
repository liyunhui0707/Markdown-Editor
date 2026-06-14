'use strict';

/* note-switch-restore — pure predicate for renderEditor's note-switch path.

   Locks the "no setState => always setText" contract that fixes the tiptap
   stale-content bug. The renderer-level integration coverage (host wiring +
   real tiptap adapter) lives in renderer-boot.test.js; this file pins the
   decision in isolation. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shouldRestoreCachedState } = require('../lib/note-switch-restore.js');

test('no setState (tiptap/hybrid): never restore, even on an exact cache match', () => {
  assert.equal(shouldRestoreCachedState(false, { state: {}, doc: 'X' }, 'X'), false);
});

test('setState + cached doc matches body: restore (CM6 note-local undo)', () => {
  assert.equal(shouldRestoreCachedState(true, { state: {}, doc: 'X' }, 'X'), true);
});

test('setState + cached doc diverged from body: do not restore (stale cache -> setText)', () => {
  assert.equal(shouldRestoreCachedState(true, { state: {}, doc: 'old' }, 'new'), false);
});

test('setState but no cache entry: do not restore', () => {
  assert.equal(shouldRestoreCachedState(true, undefined, 'X'), false);
});

test('no setState and no cache: do not restore', () => {
  assert.equal(shouldRestoreCachedState(false, undefined, 'X'), false);
});

test('total: null cached is safe (false)', () => {
  assert.equal(shouldRestoreCachedState(true, null, 'X'), false);
});
