/* Stage D WAVE 3 — lp QuoteMark branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-quote.test.js

   Off-active blockquote markers (`>`) get Decoration.replace; on-active
   no-op. Multi-line blockquote: each line's QuoteMark gets its own
   per-line active-line determination so caret on one line reveals only
   that line's `>`. Nested constructs work bidirectionally. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-block.js')];
const lpBlock = require('../../lib/cm6-lp-block.js');

const cm6 = { Decoration, syntaxTree, WidgetType };

function makeState(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos == null ? 0 : cursorPos, head: cursorPos == null ? 0 : cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
}

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

test('Stage D WAVE 3-T-Q-1: off-active single-line "> text" QuoteMark is replaced', () => {
  // "alpha\n> quoted\nbeta\n"
  //  0     6  7
  const fixture = 'alpha\n> quoted\nbeta\n';
  const state = makeState(fixture, 0); // caret on line 1
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected 1 replaced range for the > QuoteMark');
  assert.equal(replaced[0].from, 6, 'QuoteMark starts after the preceding newline');
});

test('Stage D WAVE 3-T-Q-2: off-active multi-line "> a\\n> b" produces 2 QuoteMark replaces', () => {
  // "alpha\n> a\n> b\nbeta\n"
  //  0     6  7 9   10 13
  const fixture = 'alpha\n> a\n> b\nbeta\n';
  const state = makeState(fixture, 0); // caret on alpha (line 1)
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 replaced ranges (one QuoteMark per line)');
});

test('Stage D WAVE 3-T-Q-3: multi-line blockquote with caret on line 1 reveals only line 1', () => {
  // "alpha\n> a\n> b\nbeta\n"
  // Caret on "> a" (line 2). Line 2's QuoteMark must NOT be replaced;
  // line 3's QuoteMark must still be replaced.
  const fixture = 'alpha\n> a\n> b\nbeta\n';
  const state = makeState(fixture, 8); // caret in "a"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1,
    'caret on line 2: only line 3 still has its QuoteMark replaced');
  // The remaining replaced range should be on line 3 (positions ~10-11),
  // not line 2 (positions 6-7).
  assert.ok(replaced[0].from >= 10,
    'remaining QuoteMark must be on line 3, not line 2');
});

test('Stage D WAVE 3-T-Q-4: nested "> > nested" produces 2 QuoteMark replaces on one line', () => {
  // "alpha\n> > deep\nbeta\n"
  //  0     6           14
  const fixture = 'alpha\n> > deep\nbeta\n';
  const state = makeState(fixture, 16); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 QuoteMark replaces: outer > and inner >');
});

test('Stage D WAVE 3-T-Q-5: blockquote inside list "- > quote" produces 1 ListMark + 1 QuoteMark', () => {
  // "- > quoted\nbeta\n"
  //  0          11
  const fixture = '- > quoted\nbeta\n';
  const state = makeState(fixture, 11); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 ranges: ListMark "-" + QuoteMark ">"');
});

test('Stage D WAVE 3-T-Q-6: list inside blockquote "> - item" produces 1 QuoteMark + 1 ListMark', () => {
  // "> - item\nbeta\n"
  //  0          9
  const fixture = '> - item\nbeta\n';
  const state = makeState(fixture, 10); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 ranges: QuoteMark ">" + ListMark "-"');
});

test('Stage D WAVE 3-T-Q-7: on-active single-line blockquote NOT replaced', () => {
  const fixture = 'alpha\n> quoted\nbeta\n';
  const state = makeState(fixture, 10); // caret inside "quoted"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'on-active: walker handles reveal; lp emits 0');
});
