/* Stage D WAVE 2 — lp ListMark branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-block-list.test.js

   Off-active list markers (`-`, `*`, `+`, `1.`, `1)`) get
   Decoration.replace; on-active no-op. Sibling TaskMarker (`[ ]`,
   `[x]`) is NOT affected — Stage 23 toggle behavior preserved. */

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

test('Stage D WAVE 2-T-L-1: off-active unordered "- item" ListMark is replaced', () => {
  // "alpha\n- item\nbeta\n"
  //  0     6  7
  const fixture = 'alpha\n- item\nbeta\n';
  const state = makeState(fixture, 0); // caret on line 1
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected 1 replaced range for the - ListMark');
  assert.equal(replaced[0].from, 6, 'ListMark starts after the preceding newline');
});

test('Stage D WAVE 2-T-L-2: each bullet variant produces 1 ListMark replace', () => {
  const variants = ['- ', '* ', '+ ', '1. ', '1) '];
  for (const marker of variants) {
    const fixture = 'alpha\n' + marker + 'item\nbeta\n';
    const state = makeState(fixture, 0);
    const out = lpBlock.buildLpBlockDecorations(state, cm6);
    const replaced = collectRanges(out.replaced);
    assert.equal(replaced.length, 1,
      'variant "' + marker.trim() + '": expected 1 replaced range');
  }
});

test('Stage D WAVE 2-T-L-3: nested 2-space-indented list still gets ListMark replace', () => {
  // "- outer\n  - inner\nbeta\n"
  //  0        8
  const fixture = '- outer\n  - inner\nbeta\n';
  const state = makeState(fixture, 19); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'expected 2 replaced ranges: outer "-" + inner "-"');
});

test('Stage D WAVE 2-T-L-4: on-active list line ListMark is NOT replaced', () => {
  const fixture = 'alpha\n- item\nbeta\n';
  const state = makeState(fixture, 8); // caret on the list line
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'on-active line: lp emits 0 replaces; walker reveals via cm-md-list-mark');
});

test('Stage D WAVE 2-T-L-5: task list "- [ ] task" replaces ListMark but NOT TaskMarker', () => {
  // "- [ ] task\nbeta\n"
  //  0   2-5    10
  const fixture = '- [ ] task\nbeta\n';
  const state = makeState(fixture, 11); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1,
    'expected 1 replaced range: the "-" ListMark only (TaskMarker exempt)');
  // The replaced range must cover the "-" at position 0, NOT the "[ ]" at 2-5.
  assert.equal(replaced[0].from, 0, 'replaced range starts at 0 (the "-")');
  assert.ok(replaced[0].to <= 2, 'replaced range ends before the TaskMarker at position 2');
});

test('Stage D WAVE 2-T-L-6: ordered list with multiple items gets one replace per item', () => {
  // "1. first\n2. second\n3. third\nbeta\n"
  //  0          9          19         29
  const fixture = '1. first\n2. second\n3. third\nbeta\n';
  const state = makeState(fixture, 30); // caret on "beta"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 3,
    'expected 3 replaced ListMark ranges (one per ordered item)');
});

test('Stage D WAVE 2-T-L-7: caret on first list item reveals only that item', () => {
  const fixture = '- a\n- b\n- c\nbeta\n';
  const state = makeState(fixture, 2); // caret on "- a"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2,
    'caret on first item: items 2 and 3 still replaced');
});
