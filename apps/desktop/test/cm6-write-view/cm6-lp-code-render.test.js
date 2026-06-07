/* Stage G.1 WAVE 2 — lp-block FencedCode branch integration.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-code-render.test.js

   Verifies that fenced code blocks in the document produce exactly
   one block-level Decoration.replace covering the full FencedCode
   range when off-active, and zero when any line of the block is
   touched. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

// Stage G.3 — FencedCode block widget now lives in cm6-lp-block-widgets.js
// (StateField source) per the CM6 "block decorations may not be specified
// via plugins" rule.
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
  const c = rangeSet.iter();
  while (c.value) { out.push({ from: c.from, to: c.to }); c.next(); }
  return out;
}

// "alpha\n```js\nconst x = 1;\n```\nbeta\n"
//  0     6          10           25      30
const DOC = 'alpha\n```js\nconst x = 1;\n```\nbeta\n';

test('Stage G.1 WAVE 2-T-CR-1: off-active fenced code → 1 widget at FencedCode line.from (Stage G.8 pattern)', () => {
  // Stage G.8 changed the block-widget pattern from Decoration.replace
  // ({block:true}) over a multi-line range to Decoration.widget(
  // {block:true,side:-1}) inserted at the FIRST line's .from + line-hide
  // decorations on each source line. `out.replaced` now contains only
  // the widget point decoration (zero-length range at line.from), one
  // per block.
  const state = makeState(DOC, 0); // caret on "alpha"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected exactly 1 block-widget for the fenced code');
  // Widget is inserted at the FIRST line of the FencedCode range.
  // For "alpha\n```js\n..." the first line of the fence is line 2,
  // which starts at position 6 (after "alpha\n").
  assert.equal(replaced[0].from, 6, 'widget at first-line .from');
  // Widget is a POINT insertion: from === to.
  assert.equal(replaced[0].to, replaced[0].from, 'widget is a point decoration (from === to)');
});

test('Stage G.1 WAVE 2-T-CR-2: caret on opening fence line → on-active → 0 replaces', () => {
  const state = makeState(DOC, 8); // caret inside "```js"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0);
});

test('Stage G.1 WAVE 2-T-CR-3: caret on code line → on-active → 0 replaces', () => {
  const state = makeState(DOC, 15); // caret inside "const x = 1;"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0);
});

test('Stage G.1 WAVE 2-T-CR-4: caret on closing fence line → on-active → 0 replaces', () => {
  const state = makeState(DOC, 27); // caret inside closing "```"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0);
});

test('Stage G.1 WAVE 2-T-CR-5: caret AFTER fence block → off-active → 1 replace', () => {
  const state = makeState(DOC, 32); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1);
});

test('Stage G.1 WAVE 2-T-CR-6: tilde-fenced code ~~~ also matches', () => {
  const doc = 'alpha\n~~~js\nconst x = 1;\n~~~\nbeta\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'tilde-fenced code produces 1 replace');
});

test('Stage G.1 WAVE 2-T-CR-7: fenced code without info string still matches', () => {
  const doc = 'alpha\n```\nconst x = 1;\n```\nbeta\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'no-info fenced code produces 1 replace');
});

test('Stage G.1 WAVE 2-T-CR-8: multiple code blocks → 1 replace each', () => {
  const doc = 'pre\n```js\na\n```\nmid\n```py\nb\n```\npost\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2, 'two code blocks → 2 replaces');
});

test('Stage G.1 WAVE 2-T-CR-9: caret in first code block → only second replaced', () => {
  const doc = 'pre\n```js\na\n```\nmid\n```py\nb\n```\npost\n';
  // Position inside first block — find a position inside "a".
  const firstA = doc.indexOf('a\n```');
  const state = makeState(doc, firstA);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'first block active → only second replaced');
});

test('Stage G.1 WAVE 2-T-CR-10: Decoration.replace uses block:true', () => {
  const state = makeState(DOC, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const cursor = out.replaced.iter();
  assert.ok(cursor.value);
  assert.equal(cursor.value.spec.block, true, 'fenced code replace must be block:true');
});

test('Stage G.1 WAVE 2-T-CR-11: round-trip — doc unchanged after build', () => {
  const state = makeState(DOC, 0);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), DOC);
});

test('Stage G.1 WAVE 2-T-CR-12: frontmatter region — no code-block replace inside', () => {
  // A fenced code-like region inside YAML frontmatter is parsed as raw
  // YAML, not as a Markdown FencedCode. Either way, the frontmatter
  // exclusion should prevent any replace inside the [0, fmEnd) region.
  const doc = '---\nfoo: bar\n---\n\n```js\nconst x = 1;\n```\n\npost\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // The post-frontmatter fenced code should still get its 1 replace.
  // The frontmatter "---\n...\n---" itself is not a FencedCode in Lezer.
  assert.equal(replaced.length, 1, 'post-frontmatter fenced code → 1 replace');
});
