/* Stage D WAVE 5 — lp-block edge cases.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-edge-cases.test.js

   Frontmatter exclusion, HR exclusion, Setext exclusion, fenced-code
   exclusion, nested constructs, empty docs, multi-cursor.

   Pattern mirrors cm6-lp-edge-cases.test.js for inline markers. */

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

test('Stage D WAVE 5-T-E-1: frontmatter region excluded from block-marker replaces', () => {
  // The frontmatter region "---\n...\n---" must be skipped. Any "#" / "-" / ">"
  // characters inside YAML are plain text, not markdown markers anyway, but the
  // frontmatter guard provides defense-in-depth: even if the parser misidentifies
  // them as markers, the lp-block plugin must not replace them.
  const fixture = '---\nyaml: value\n---\n# Real Heading\n';
  // Cursor on the heading line (line 4 — but past frontmatter end).
  // To make the heading off-active, put caret on a hypothetical line 5 (empty).
  const stateOffActive = makeState(fixture + 'beta\n', fixture.length + 2);
  const out = lpBlock.buildLpBlockDecorations(stateOffActive, cm6);
  const replaced = collectRanges(out.replaced);
  // The "# Real Heading" line is past frontmatter end; its HeaderMark
  // should be replaced. The frontmatter "---" lines are NOT HeaderMark
  // (they're a structural YAML fence), so they shouldn't appear in the
  // replaced set even without the guard. Net: 1 replaced range.
  assert.equal(replaced.length, 1,
    'expected exactly 1 replaced range: the post-frontmatter # HeaderMark');
  assert.ok(replaced[0].from >= 20,
    'replaced range must be past the frontmatter region (from ~ 20)');
});

test('Stage D WAVE 5-T-E-2: standalone HorizontalRule (---) is NOT replaced', () => {
  // HR is parsed as HorizontalRule, not HeaderMark/ListMark/QuoteMark.
  // lp-block has no branch for HorizontalRule, so it should produce 0 replaces.
  const fixture = 'alpha\n\n---\n\nbeta\n';
  const state = makeState(fixture, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'HorizontalRule must NOT be replaced (Stage D excludes HR)');
});

test('Stage D WAVE 5-T-E-3: heading inside blockquote "> # H" produces QuoteMark + HeaderMark', () => {
  // "> # H\nbeta\n"
  //  0      6
  const fixture = '> # H\nbeta\n';
  const state = makeState(fixture, 7); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 replaces: QuoteMark + ATX HeaderMark');
});

test('Stage D WAVE 5-T-E-4: multi-line blockquote with heading replace per-line', () => {
  // "> # H\n> text\nbeta\n"
  //  0      6      13
  const fixture = '> # H\n> text\nbeta\n';
  const state = makeState(fixture, 14); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 3,
    'expected 3 replaces: line 1 QuoteMark + line 1 HeaderMark + line 2 QuoteMark');
});

test('Stage D WAVE 5-T-E-5: # inside fenced code block is NOT a HeaderMark (no replace)', () => {
  // The "#" inside fenced code is parsed as code content, not HeaderMark.
  // The lp-block plugin would never see it as a HeaderMark node.
  const fixture = '```\n# not a heading\n```\nbeta\n';
  const state = makeState(fixture, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    '# inside fenced code is not a HeaderMark; expect 0 replaces');
});

test('Stage D WAVE 5-T-E-6: empty document produces 0 replaces (no crash)', () => {
  const state = makeState('', 0);
  assert.doesNotThrow(() => {
    const out = lpBlock.buildLpBlockDecorations(state, cm6);
    const replaced = collectRanges(out.replaced);
    assert.equal(replaced.length, 0, 'empty doc → 0 replaces');
  });
});

test('Stage D WAVE 5-T-E-7: document with only newlines produces 0 replaces', () => {
  const state = makeState('\n\n\n', 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0, 'newlines-only doc → 0 replaces');
});

test('Stage D WAVE 5-T-E-8: Setext H2 in document with ATX heading — only ATX replaced', () => {
  // Mixed Setext + ATX. The Setext "---" underline's HeaderMark (parent
  // SetextHeading2) must NOT be replaced; the ATX "## H2" HeaderMark
  // (parent ATXHeading2) MUST be replaced.
  const fixture = 'Setext H2\n---\n## ATX H2\nbeta\n';
  // Caret on "beta" — all heading lines off-active.
  const state = makeState(fixture, fixture.length - 1);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1,
    'expected 1 replace: only the ATX HeaderMark (Setext underline excluded)');
});

test('Stage D WAVE 5-T-E-9: round-trip — doc unchanged after build', () => {
  const fixture = '# H\n- a\n- b\n> q\nbody\n';
  const state = makeState(fixture, 0);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), fixture,
    'buildLpBlockDecorations must NOT mutate the document');
});
