/* Stage E WAVE 3 — lp-block Table branch integration.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-table-render.test.js

   Tests that GFM tables in the document trigger exactly one
   Decoration.replace covering [Table.from, Table.to] when off-active,
   and zero when any line of the Table is touched. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

// Stage G.3 — Table block widgets now live in cm6-lp-block-widgets.js
// (StateField source) per the CM6 "block decorations may not be specified
// via plugins" rule. The pure builder shape is preserved as
// buildBlockWidgetDecorations(state, cm6) → {all, replaced}.
delete require.cache[require.resolve('../../lib/cm6-lp-block-widgets.js')];
const lpBlock = {
  buildLpBlockDecorations: require('../../lib/cm6-lp-block-widgets.js').buildBlockWidgetDecorations,
};

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

// Document structure (with required blank-line-after-table convention —
// Lezer GFM absorbs trailing non-pipe lines into the table otherwise):
// "alpha\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nbeta\n"
// Line numbers: 1=alpha, 2=blank, 3=header, 4=delim, 5=row1, 6=blank, 7=beta
const DOC = 'alpha\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nbeta\n';

test('Stage E WAVE 3-T-R-1: off-active table produces exactly 1 widget at Table line.from (Stage G.8 pattern)', () => {
  // Stage G.8 changed from Decoration.replace({block:true}) over a
  // multi-line range to Decoration.widget({block:true,side:-1}) at
  // the first source line's .from + line-hide decorations on each
  // source line. The widget appears as ONE point decoration in
  // `out.replaced`.
  const state = makeState(DOC, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected exactly 1 block-widget for the table');
  // Table is at [7, 36]; widget is inserted at the first line's .from = 7.
  assert.equal(replaced[0].from, 7, 'widget at first-line .from');
  assert.equal(replaced[0].to, 7,   'widget is a point decoration (from === to)');
});

test('Stage E WAVE 3-T-R-2: caret on header line → table on-active → 0 replaces', () => {
  const state = makeState(DOC, 11); // caret inside header row "| A | B |"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'caret on header line: table on-active; walker renders source');
});

test('Stage E WAVE 3-T-R-3: caret on delimiter line → table on-active → 0 replaces', () => {
  const state = makeState(DOC, 20); // caret inside "|---|---|"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0, 'caret on delimiter line: table on-active');
});

test('Stage E WAVE 3-T-R-4: caret on body row → table on-active → 0 replaces', () => {
  const state = makeState(DOC, 30); // caret inside "| 1 | 2 |"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0, 'caret on body row: table on-active');
});

test('Stage E WAVE 3-T-R-5: caret AFTER the table → table off-active → 1 replace', () => {
  const state = makeState(DOC, 40); // caret on "beta" line
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'caret past the table: table off-active');
});

test('Stage E WAVE 3-T-R-6: Decoration.widget uses block:true + side:-1 (Stage G.8 pattern)', () => {
  // After Stage G.8 the table is emitted as a Decoration.widget point
  // insertion (not a multi-line Decoration.replace). The widget still
  // sets block:true so CM6 renders it as a block element. side:-1
  // positions it BEFORE the first source line.
  const state = makeState(DOC, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const cursor = out.replaced.iter();
  const spec = cursor.value && cursor.value.spec;
  assert.ok(spec, 'widget decoration must have a spec');
  assert.equal(spec.block, true, 'table widget must be block:true');
  assert.equal(spec.side, -1, 'side:-1 places widget BEFORE the first source line');
  assert.ok(spec.widget, 'widget must be present');
});

test('Stage E WAVE 3-T-R-7: round-trip — document unchanged after build', () => {
  const state = makeState(DOC, 0);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), DOC,
    'buildLpBlockDecorations must NOT mutate the document');
});
