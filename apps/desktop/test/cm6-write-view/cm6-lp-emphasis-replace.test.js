/* Stage A WAVE 4 + WAVE 5 + WAVE 6 — lp emphasis decoration plugin behavior.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-emphasis-replace.test.js

   These tests pin the core Stage A behavior at the RangeSet level:
     WAVE 4: off-active emphasis markers → Decoration.replace + replaced set populated.
     WAVE 5: on-active emphasis markers  → no Decoration.replace from this plugin
             (the hybrid walker's existing Decoration.mark + existing CSS handles reveal).
     WAVE 6: selection-set transitions update the decorations correctly.

   DOM-LEVEL VERIFICATION DEFERRED: per R2-MAJOR 3 the decoration-overlap
   assumption (Decoration.replace wins visually over Decoration.mark on
   the same range) is verified at the DOM level by MANUAL QA from
   docs/test-manual.md Stage A section. Automated DOM-level testing would
   require adding a DOM library (jsdom) which is a new npm dependency,
   forbidden by Hard Rule 4. RangeSet-level testing here is the closest
   automatable equivalent.

   Pattern: uses real CM6 (mirrors hybrid-cm6-readiness.test.js + WAVE 3). */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                  = require('@codemirror/state');
const { Decoration }                   = require('@codemirror/view');
const { syntaxTree }                   = require('@codemirror/language');
const { markdown, markdownLanguage }   = require('@codemirror/lang-markdown');

// Load the lp emphasis module (UMD CJS path requires cm6-line-utils.js).
delete require.cache[require.resolve('../../lib/cm6-lp-emphasis.js')];
const lpEmphasis = require('../../lib/cm6-lp-emphasis.js');

// Real cm6 namespace — the surface buildLpEmphasisDecorations consumes.
// WidgetType is included so the empty marker widget can be constructed
// when the plugin emits Decoration.replace.
const { WidgetType } = require('@codemirror/view');
const cm6 = { Decoration, syntaxTree, WidgetType };

function makeStateWithCursor(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos, head: cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
}

function collectRanges(rangeSet) {
  const out = [];
  if (!rangeSet || typeof rangeSet.iter !== 'function') return out;
  const cursor = rangeSet.iter();
  while (cursor.value) {
    out.push({ from: cursor.from, to: cursor.to, kind: cursor.value.constructor && cursor.value.constructor.name });
    cursor.next();
  }
  return out;
}

// Fixtures — character offsets are precomputed to make assertions clear.
// "line1\n**bold**\nline3\n"
//  0     5 6   1011  14 15  20
// EmphasisMark ranges: [6,8) and [12,14).
const FIXTURE_BOLD = 'line1\n**bold**\nline3\n';
const BOLD_OPEN_FROM  = 6;
const BOLD_OPEN_TO    = 8;
const BOLD_CLOSE_FROM = 12;
const BOLD_CLOSE_TO   = 14;

// ── WAVE 4: off-active emphasis markers get Decoration.replace ────────────

test('Stage A WAVE 4-1: off-active **bold** markers are replaced (caret on line 1)', () => {
  const state = makeStateWithCursor(FIXTURE_BOLD, 0); // line 1, not touching line 2
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  assert.ok(out, 'must return non-null {all, replaced}');
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 replaced ranges (opening ** and closing **), got ' + replaced.length);
  replaced.sort((a, b) => a.from - b.from);
  assert.equal(replaced[0].from, BOLD_OPEN_FROM,  'opening ** start');
  assert.equal(replaced[0].to,   BOLD_OPEN_TO,    'opening ** end');
  assert.equal(replaced[1].from, BOLD_CLOSE_FROM, 'closing ** start');
  assert.equal(replaced[1].to,   BOLD_CLOSE_TO,   'closing ** end');
});

test('Stage A WAVE 4-2: word "bold" itself is NOT replaced (only the markers)', () => {
  const state = makeStateWithCursor(FIXTURE_BOLD, 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  for (const r of replaced) {
    assert.ok(r.from < BOLD_OPEN_TO || r.from >= BOLD_CLOSE_FROM,
      'replaced range at offset ' + r.from + ' falls inside the word "bold" — only markers should be replaced');
  }
});

test('Stage A WAVE 4-3: replaced ranges match all ranges (on-active emits nothing this wave)', () => {
  const state = makeStateWithCursor(FIXTURE_BOLD, 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const all      = collectRanges(out.all);
  const replaced = collectRanges(out.replaced);
  assert.equal(all.length, replaced.length,
    'WAVE 4: all === replaced (no separate marks emitted on-active by this plugin)');
});

test('Stage A WAVE 4-4: *italic* off-active produces 2 single-character replaced ranges', () => {
  // "line1\n*italic*\nline3\n"
  //  0     5 6     13 14
  // EmphasisMark ranges: [6,7) and [13,14).
  const fixture = 'line1\n*italic*\nline3\n';
  const state = makeStateWithCursor(fixture, 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2);
  replaced.sort((a, b) => a.from - b.from);
  assert.equal(replaced[0].from, 6);  assert.equal(replaced[0].to, 7);
  assert.equal(replaced[1].from, 13); assert.equal(replaced[1].to, 14);
});

test('Stage A WAVE 4-5: _italic_ off-active uses underscore variant (same replace behavior)', () => {
  const fixture = 'line1\n_italic_\nline3\n';
  const state = makeStateWithCursor(fixture, 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2);
});

test('Stage A WAVE 4-6: __bold__ underscore variant also handled', () => {
  const fixture = 'line1\n__bold__\nline3\n';
  const state = makeStateWithCursor(fixture, 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2);
});

// ── WAVE 5: on-active emphasis markers are NOT replaced by this plugin ────

test('Stage A WAVE 5-1: caret on line 2 → no replace for that line\'s emphasis markers', () => {
  // Place caret inside the word "bold" on line 2.
  const state = makeStateWithCursor(FIXTURE_BOLD, 9); // 9 is inside "bold"
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'caret on the emphasis line must produce zero replaced ranges (no-op on-active)');
});

test('Stage A WAVE 5-2: caret at exactly the boundary of an emphasis marker still considered active', () => {
  // Caret at offset 6 — the very start of "**bold**". Same line, considered active.
  const state = makeStateWithCursor(FIXTURE_BOLD, 6);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'caret on the same line as an emphasis marker → no replace (active-line includes the whole line)');
});

test('Stage A WAVE 5-3: multi-line selection covering both line 1 and line 2 → no replace on line 2', () => {
  // Selection from offset 0 (line 1 start) to offset 10 (inside "bold" on line 2).
  // Both lines are touched.
  const state = EditorState.create({
    doc: FIXTURE_BOLD,
    selection: { anchor: 0, head: 10 },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
  });
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'multi-line selection touching line 2 must reveal markers there');
});

// ── WAVE 6: recompute on selection change ─────────────────────────────────

test('Stage A WAVE 6-1: changing selection from line 1 to line 2 changes the replace set', () => {
  const stateA = makeStateWithCursor(FIXTURE_BOLD, 0); // line 1
  const stateB = makeStateWithCursor(FIXTURE_BOLD, 9); // line 2

  const outA = lpEmphasis.buildLpEmphasisDecorations(stateA, cm6);
  const outB = lpEmphasis.buildLpEmphasisDecorations(stateB, cm6);

  const replacedA = collectRanges(outA.replaced);
  const replacedB = collectRanges(outB.replaced);

  assert.equal(replacedA.length, 2, 'line 1 cursor: 2 replaced');
  assert.equal(replacedB.length, 0, 'line 2 cursor: 0 replaced');
  assert.notEqual(replacedA.length, replacedB.length,
    'selection change must alter the replaced RangeSet');
});

// ── Edge cases (WAVE 10 partial coverage; remaining edges in dedicated file) ──

test('Stage A WAVE 4-7: no emphasis in document → empty replaced set', () => {
  const state = makeStateWithCursor('plain paragraph\nanother\n', 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0);
});

test('Stage A WAVE 4-8: empty document → null-safe', () => {
  const state = makeStateWithCursor('', 0);
  const out = lpEmphasis.buildLpEmphasisDecorations(state, cm6);
  assert.ok(out);
  assert.equal(collectRanges(out.replaced).length, 0);
});
