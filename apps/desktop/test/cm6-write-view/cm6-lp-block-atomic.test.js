/* Stage D WAVE 4 — lp-block atomicRanges plumbing.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-atomic.test.js

   Verifies that the lp-block ViewPlugin's atomicRanges facet provider
   returns the replaced ranges. Without this, cursor arrow-key motion
   would step character-by-character through the empty widget. Pattern
   mirrors Stage A WAVE 7 / Stage B atomicRanges tests for lp-inline. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { EditorView, Decoration, WidgetType, ViewPlugin } = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-block.js')];
const lpBlock = require('../../lib/cm6-lp-block.js');

const cm6 = { Decoration, syntaxTree, WidgetType, ViewPlugin, EditorView };

function collectRanges(rangeSet) {
  const out = [];
  if (!rangeSet || typeof rangeSet.iter !== 'function') return out;
  const cursor = rangeSet.iter();
  while (cursor.value) {
    out.push({ from: cursor.from, to: cursor.to });
    cursor.next();
  }
  return out;
}

test('Stage D WAVE 4-T-A-1: createLpBlockExtension returns non-null when surfaces present', () => {
  const ext = lpBlock.createLpBlockExtension(cm6);
  assert.ok(ext != null, 'extension factory must return a non-null extension');
});

test('Stage D WAVE 4-T-A-2: createLpBlockExtension returns null when EditorView.atomicRanges missing', () => {
  const cm6Bare = { Decoration, syntaxTree, WidgetType, ViewPlugin, EditorView: {} };
  const ext = lpBlock.createLpBlockExtension(cm6Bare);
  assert.equal(ext, null, 'M1 sentinel: missing atomicRanges → null extension');
});

test('Stage D WAVE 4-T-A-3: replaced RangeSet equals the all RangeSet (atomicRanges contract)', () => {
  // The atomicRanges facet provider reads `view.plugin(p).replacedRanges`.
  // We pin the contract at the pure-function level: the `replaced` set
  // returned by buildLpBlockDecorations must be the exact same RangeSet
  // as `all` (atomicRanges should atomicize EVERY replace, never just
  // a subset). Real-DOM atomic-cursor verification is covered by manual
  // QA gate MQ-D5 (no jsdom — Hard Rule 4).
  const fixture = 'beta\n# H\n- li\n> q\n';
  const state = EditorState.create({
    doc: fixture,
    selection: { anchor: 0, head: 0 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const all      = collectRanges(out.all);
  const replaced = collectRanges(out.replaced);
  assert.equal(all.length, replaced.length,
    'all.length must equal replaced.length (atomicRanges atomicizes every replace)');
  for (let i = 0; i < all.length; i++) {
    assert.deepEqual(all[i], replaced[i],
      'all[' + i + '] must equal replaced[' + i + ']');
  }
  assert.ok(replaced.length >= 3,
    'expected at least 3 block-marker replaces (heading + list + quote)');
});
