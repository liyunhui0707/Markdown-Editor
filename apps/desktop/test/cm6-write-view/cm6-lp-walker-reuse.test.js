/* Stage A WAVE 3 — lp adapter reuses Cm6HybridView.buildHeadingDecorations.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-walker-reuse.test.js

   The lp engine reuses the hybrid walker via the public export at
   cm6-hybrid-view.js line 702 (`return { createCm6HybridView,
   buildHeadingDecorations }`). It does NOT duplicate the walker.

   These tests pin two contracts:
     T-WALKER-REUSE: for the same input + same cm6 backend, the walker
       produces the SAME decorations regardless of which adapter invokes
       it. This is the foundation of the WAVE 2 extension-parity claim.
     T-EMPHASIS-MARK-STILL-EMITTED: the walker still emits
       Decoration.mark for EmphasisMark nodes (this is the existing
       hybrid-cm6 behavior). The lp-emphasis plugin's Decoration.replace
       visually overrides these marks off-active-line; on-active-line
       the mark is what existing CSS reveals dimmed.

   Pattern: uses real CM6 (mirrors hybrid-cm6-readiness.test.js) so the
   syntax tree is the real Lezer Markdown parser, not a fake. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                  = require('@codemirror/state');
const { Decoration }                   = require('@codemirror/view');
const { syntaxTree }                   = require('@codemirror/language');
const { markdown, markdownLanguage }   = require('@codemirror/lang-markdown');

const { buildHeadingDecorations } = require('../../lib/cm6-hybrid-view');

const cm6 = { Decoration, syntaxTree };

function makeMarkdownState(doc) {
  return EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

function collectMarks(decorationSet) {
  const out = [];
  const cursor = decorationSet.iter();
  while (cursor.value) {
    out.push({
      from: cursor.from,
      to:   cursor.to,
      class: cursor.value.spec && cursor.value.spec.class,
    });
    cursor.next();
  }
  return out;
}

test('Stage A WAVE 3-T1: lp walker-reuse — buildHeadingDecorations is callable via the public export', () => {
  // The export at cm6-hybrid-view.js line 702 is the contract the lp
  // adapter relies on. If this assertion fails, the lp engine cannot
  // reuse the walker and would need to either duplicate it (rejected
  // by R2-MAJOR 1) or modify cm6-hybrid-view.js (off-limits).
  assert.equal(typeof buildHeadingDecorations, 'function',
    'Cm6HybridView.buildHeadingDecorations must be exported');
});

test('Stage A WAVE 3-T2: walker emits Decoration.mark for EmphasisMark on **bold**', () => {
  const state = makeMarkdownState('**bold**\n');
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  const emphasisMarks = marks.filter(m =>
    m.class && m.class.indexOf('cm-md-emphasis-mark') >= 0
  );
  assert.equal(emphasisMarks.length, 2,
    'walker must emit two cm-md-emphasis-mark decorations for the two ** runs');
  // The two emphasis marks should be at positions [0,2) and [6,8).
  emphasisMarks.sort((a, b) => a.from - b.from);
  assert.equal(emphasisMarks[0].from, 0, 'first ** at offset 0');
  assert.equal(emphasisMarks[0].to,   2, 'first ** ends at offset 2');
  assert.equal(emphasisMarks[1].from, 6, 'second ** at offset 6');
  assert.equal(emphasisMarks[1].to,   8, 'second ** ends at offset 8');
});

test('Stage A WAVE 3-T3: walker emits Decoration.mark for EmphasisMark on *italic*', () => {
  const state = makeMarkdownState('*italic*\n');
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  const emphasisMarks = marks.filter(m =>
    m.class && m.class.indexOf('cm-md-emphasis-mark') >= 0
  );
  assert.equal(emphasisMarks.length, 2,
    'walker must emit two cm-md-emphasis-mark decorations for the two * runs');
  emphasisMarks.sort((a, b) => a.from - b.from);
  assert.equal(emphasisMarks[0].from, 0);
  assert.equal(emphasisMarks[0].to,   1);
  assert.equal(emphasisMarks[1].from, 7);
  assert.equal(emphasisMarks[1].to,   8);
});

test('Stage A WAVE 3-T4: walker also emits container marks (cm-md-bold, cm-md-italic) — unchanged by lp', () => {
  const state = makeMarkdownState('**bold** *italic*\n');
  const marks = collectMarks(buildHeadingDecorations(state, cm6));
  const boldContainer   = marks.filter(m => m.class === 'cm-md-bold');
  const italicContainer = marks.filter(m => m.class === 'cm-md-italic');
  assert.equal(boldContainer.length,   1, 'one StrongEmphasis container');
  assert.equal(italicContainer.length, 1, 'one Emphasis container');
});

test('Stage A WAVE 3-T5: walker output is deterministic for repeated calls on the same state', () => {
  // If this regresses, walker reuse from two adapters at once could
  // produce divergent decoration sets — which would break the WAVE 2
  // parity claim.
  const state = makeMarkdownState('# H\n\n**a** and *b*\n');
  const first  = collectMarks(buildHeadingDecorations(state, cm6));
  const second = collectMarks(buildHeadingDecorations(state, cm6));
  assert.deepEqual(first, second,
    'two calls on the same state must produce byte-identical decoration data');
});
