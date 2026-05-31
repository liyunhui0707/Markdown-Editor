/* Stage B WAVE 2 — lp inline-code branch (CodeMark with parent InlineCode).
   Run focused:
     node --test test/cm6-write-view/cm6-lp-inline-code.test.js

   Off-active backticks of `code` get Decoration.replace; on-active no-op.
   Fenced-code backticks (parent FencedCode) are NOT replaced.
   Pattern mirrors Stage A's cm6-lp-emphasis-replace.test.js. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-inline.js')];
const lpInline = require('../../lib/cm6-lp-inline.js');

const cm6 = { Decoration, syntaxTree, WidgetType };

function makeState(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos == null ? 0 : cursorPos, head: cursorPos == null ? 0 : cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [] })],
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

// "line1\n`code`\nline3\n"
//  0     5 6   11 12
// CodeMark ranges (parent InlineCode): [6,7) and [11,12).
const FIXTURE_CODE = 'line1\n`code`\nline3\n';
const CODE_OPEN  = { from: 6,  to: 7  };
const CODE_CLOSE = { from: 11, to: 12 };

test('Stage B WAVE 2-IC-1: off-active inline-code backticks are replaced', () => {
  const state = makeState(FIXTURE_CODE, 0); // caret on line 1
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2, 'expected 2 replaced ranges for the two backticks');
  replaced.sort((a, b) => a.from - b.from);
  assert.deepEqual(replaced[0], CODE_OPEN);
  assert.deepEqual(replaced[1], CODE_CLOSE);
});

test('Stage B WAVE 2-IC-2: on-active inline-code backticks are NOT replaced', () => {
  const state = makeState(FIXTURE_CODE, 8); // caret inside `code` on line 2
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0, 'on-active line emits no replace from lp plugin');
});

test('Stage B WAVE 2-IC-3: word "code" itself is NOT replaced (only backticks)', () => {
  const state = makeState(FIXTURE_CODE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  for (const r of replaced) {
    assert.ok(r.from < CODE_OPEN.to || r.from >= CODE_CLOSE.from,
      'replaced range at ' + r.from + ' falls inside "code"');
  }
});

test('Stage B WAVE 2-IC-4: fenced-code backticks are NOT replaced (parent FencedCode, not InlineCode)', () => {
  // Fenced code block: ``` on line 2 and 4 (the fence delimiters), code on line 3.
  // The walker emits CodeMark for the fence delimiters with parent FencedCode.
  // lp-inline must skip those — only replace CodeMark whose parent is InlineCode.
  const fixture = 'line1\n```\nlet x = 1;\n```\nbody\n';
  const state = makeState(fixture, 0); // caret on line 1 (off all fence lines)
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0,
    'fenced-code backticks (parent FencedCode) must NOT be replaced');
});

test('Stage B WAVE 2-IC-5: empty inline code `` does not crash', () => {
  const fixture = 'line1\n``\nline3\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpInline.buildLpInlineDecorations(state, cm6),
    'empty backtick pair must not crash the walker');
});

test('Stage B WAVE 2-IC-6: emphasis still works after the rename (Stage A regression)', () => {
  // Sanity: confirm the lp-inline module still handles emphasis correctly post-rename.
  const fixture = 'line1\n**bold**\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2, 'Stage A emphasis behavior preserved');
});

test('Stage B WAVE 2-IC-7: inline code AND emphasis in the same off-active line — both replaced', () => {
  // "line1\n**b** `c`\nline3\n"
  //  0     5 6  9 10 12
  const fixture = 'line1\n**b** `c`\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Expect 4 ranges: 2 ** + 2 backticks.
  assert.equal(replaced.length, 4,
    'two ** + two backticks on the same off-active line = 4 replaced ranges');
});
