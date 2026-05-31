/* Stage A WAVE 10 — lp emphasis edge cases.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-edge-cases.test.js

   Covers the documented edge cases from the Stage A spec Section 10:
     - frontmatter: emphasis inside YAML frontmatter must NOT be replaced.
     - fenced code: parser does not expose EmphasisMark inside fenced code blocks.
     - inline code: same — parser does not expose EmphasisMark inside `code`.
     - nested emphasis: ***bold-italic*** — both inner and outer markers handled.
     - empty emphasis: **** — no zero-width crash.
     - adjacent emphasis: **a****b** — each ** run handled independently.
     - Setext heading: **bold** inside a Setext H1 title — markers still replaced. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-emphasis.js')];
const lpEmphasis = require('../../lib/cm6-lp-emphasis.js');

const cm6 = { Decoration, syntaxTree, WidgetType };

function makeState(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos == null ? 0 : cursorPos, head: cursorPos == null ? 0 : cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

function countReplaced(state) {
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  if (!out || !out.replaced || typeof out.replaced.iter !== 'function') return 0;
  let n = 0;
  const cur = out.replaced.iter();
  while (cur.value) { n++; cur.next(); }
  return n;
}

test('Stage A WAVE 10-T15: emphasis inside YAML frontmatter is NOT replaced', () => {
  // Strict frontmatter: leading '---' on line 1, closing '---' on a later line.
  // The walker's emphasis inside frontmatter would normally produce
  // EmphasisMark nodes (the parser doesn't recognize frontmatter as a
  // construct). Our lp-emphasis guard skips them via frontmatterEnd(doc).
  const fixture = '---\ntitle: **bold** in frontmatter\n---\n\nBody **bold**\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  // The body's "**bold**" is on a later line that is NOT touched by caret
  // at offset 0, so it MAY be replaced — assert there are exactly 2 replaced
  // ranges (the body markers only), not 4 (which would include frontmatter).
  assert.equal(replaced, 2,
    'frontmatter emphasis must be skipped; only body emphasis ('+ 2 +' markers) should be replaced');
});

test('Stage A WAVE 10-T14: emphasis-looking text inside fenced code is NOT styled', () => {
  // Parser intentionally does not emit EmphasisMark nodes inside fenced code.
  // This test pins that the lp walker depends on that contract.
  const fixture = 'line1\n```\n**not bold here**\n```\nbody\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 0,
    'no EmphasisMark inside fenced code → no replace');
});

test('Stage A WAVE 10-T-INLINE-CODE: emphasis-looking text inside `inline code` is NOT styled', () => {
  const fixture = 'line1\nprefix `**not bold**` suffix\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 0,
    'no EmphasisMark inside inline code → no replace');
});

test('Stage A WAVE 10-T-NESTED: ***bold-italic*** off-active produces multiple replaces', () => {
  // Parser produces nested StrongEmphasis around Emphasis (or vice versa).
  // The exact number of EmphasisMark nodes is parser-dependent — assert
  // at least 4 (two outer ** plus two inner *) and exactly that count.
  const fixture = 'line1\n***bold-italic***\nbody\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 4,
    'three-asterisk emphasis produces 4 EmphasisMark nodes (outer ** opening, inner * opening, inner * closing, outer ** closing)');
});

test('Stage A WAVE 10-T-EMPTY: **** off-active does not crash', () => {
  // Four asterisks parse as either an empty StrongEmphasis or as two
  // adjacent EmphasisMark spans. Whatever it produces, the walker must
  // handle it without error.
  const fixture = 'line1\n****\nbody\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpEmphasis.buildLpEmphasisDecorations(state, cm6),
    'four-asterisk run must not crash the walker');
});

test('Stage A WAVE 10-T-ADJACENT: **a****b** off-active produces the markers the parser emits', () => {
  // Probed against the real parser: `**a****b**` parses as ONE
  // StrongEmphasis spanning offsets 6..16 with EmphasisMark only at the
  // OPENING (6-8) and CLOSING (14-16). The middle `**` runs are absorbed
  // into the inner content as plain text rather than producing extra
  // EmphasisMark nodes. Pin that behavior so the walker handles it without
  // crashing and emits the same count the parser does.
  const fixture = 'line1\n**a****b**\nbody\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 2,
    'parser emits only opening + closing EmphasisMark for adjacent ** runs');
});

test('Stage A WAVE 10-T-SETEXT-HEADING: emphasis inside Setext H1 title is replaced normally', () => {
  // Setext H1: title line followed by ==== underline. Emphasis in the title
  // still produces EmphasisMark nodes. The lp walker does not need any
  // special Setext handling — emphasis is emphasis.
  const fixture = 'prelude\n\n**Title**\n=========\n\nbody\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 2,
    'emphasis inside Setext heading title produces 2 replaced ranges');
});

test('Stage A WAVE 10-T-MULTIPLE-LINES: multiple emphasis runs across multiple lines', () => {
  const fixture = 'line1\n**a**\nline3\n*b*\nline5\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 4,
    'two emphasis runs across two off-active lines = 4 replaced ranges');
});

test('Stage A WAVE 10-T-FRONTMATTER-ONLY: doc that is only frontmatter has no emphasis to replace', () => {
  // Edge case: doc is just frontmatter, no body.
  const fixture = '---\ntitle: **bold**\n---\n';
  const state = makeState(fixture, 0);
  const replaced = countReplaced(state);
  assert.equal(replaced, 0,
    'frontmatter-only doc produces zero replaced ranges');
});
