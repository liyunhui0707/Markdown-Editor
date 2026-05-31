/* Stage E WAVE 4 + 5 — table edge cases.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-table-edge-cases.test.js

   Single-column, end-of-doc, multiple tables, frontmatter exclusion,
   HTML-special chars handled through render path. */

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

test('Stage E WAVE 4-T-EE-1: single-column table off-active produces 1 replace', () => {
  const doc = 'pre\n\n| only |\n|------|\n| a    |\n\npost\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'single-col table emits 1 replace');
});

test('Stage E WAVE 4-T-EE-2: header-only table (no body) produces 1 replace', () => {
  const doc = 'pre\n\n| A | B |\n|---|---|\n\npost\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'header-only table emits 1 replace');
});

test('Stage E WAVE 4-T-EE-3: table at end of document with no trailing newline', () => {
  // Note: still need blank-line after table for it to be considered closed.
  // Real-world edge: doc ends right after the table.
  const doc = 'pre\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'eof-table emits 1 replace');
});

test('Stage E WAVE 4-T-EE-4: multiple tables — each independently off-active', () => {
  const doc = 'pre\n\n| A |\n|---|\n| 1 |\n\nmid\n\n| B |\n|---|\n| 2 |\n\npost\n';
  const state = makeState(doc, 0); // caret on "pre"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2, 'two tables → 2 replaces when both off-active');
});

test('Stage E WAVE 4-T-EE-5: caret in first table → only second table replaced', () => {
  const doc = 'pre\n\n| A |\n|---|\n| 1 |\n\nmid\n\n| B |\n|---|\n| 2 |\n\npost\n';
  const state = makeState(doc, 7); // caret inside first table
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'first table active → only second replaced');
});

test('Stage E WAVE 5-T-EE-6: frontmatter content NOT replaced as table', () => {
  // Frontmatter region (strict --- ... --- fences) should be excluded
  // even if a "|"-bearing line inside the YAML looks table-ish.
  const doc = '---\ntitle: t\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\npost\n';
  const state = makeState(doc, 0); // caret at start (line 1, frontmatter line)
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Only the post-frontmatter table should be replaced. The frontmatter
  // doesn't actually contain a Markdown table (it's YAML), so this
  // mainly verifies that the post-frontmatter table works.
  assert.equal(replaced.length, 1, 'post-frontmatter table off-active → 1 replace');
});

test('Stage E WAVE 5-T-EE-7: round-trip — document unchanged after multiple builds', () => {
  const doc = 'pre\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\npost\n';
  const state = makeState(doc, 0);
  lpBlock.buildLpBlockDecorations(state, cm6);
  lpBlock.buildLpBlockDecorations(state, cm6);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), doc, 'doc unchanged after repeated builds');
});

test('Stage E WAVE 5-T-EE-8: empty document → 0 table replaces (no crash)', () => {
  const state = makeState('', 0);
  assert.doesNotThrow(() => {
    const out = lpBlock.buildLpBlockDecorations(state, cm6);
    const replaced = collectRanges(out.replaced);
    assert.equal(replaced.length, 0);
  });
});

test('Stage E WAVE 5-T-EE-9: cell with HTML special chars survives parse + rendering pipeline', () => {
  // Confirm the integration: a table whose cell contains <script>... text
  // gets a widget (the widget itself escapes via textContent — pinned by
  // WAVE 2 widget tests). Here just confirm the integration doesn't crash.
  const doc = 'pre\n\n| safe | <script>x</script> |\n|---|---|\n| a | b |\n\npost\n';
  const state = makeState(doc, 0);
  assert.doesNotThrow(() => {
    const out = lpBlock.buildLpBlockDecorations(state, cm6);
    const replaced = collectRanges(out.replaced);
    assert.equal(replaced.length, 1, 'unsafe-content table still emits 1 widget');
  });
});
