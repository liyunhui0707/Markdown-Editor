/* Stage B WAVE 3 — lp strikethrough branch (StrikethroughMark).
   Run focused:
     node --test test/cm6-write-view/cm6-lp-strikethrough.test.js

   Off-active `~~` delimiters get Decoration.replace; on-active no-op. */

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
  while (cursor.value) { out.push({ from: cursor.from, to: cursor.to }); cursor.next(); }
  return out;
}

// "line1\n~~old~~\nline3\n"
//  0     5 6   1011 12
// StrikethroughMark ranges: [6,8) and [11,13).
const FIXTURE = 'line1\n~~old~~\nline3\n';

test('Stage B WAVE 3-ST-1: off-active ~~ delimiters are replaced', () => {
  const state = makeState(FIXTURE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 2, 'expected 2 replaced ranges for the two ~~ runs');
  replaced.sort((a, b) => a.from - b.from);
  assert.equal(replaced[0].from, 6);  assert.equal(replaced[0].to, 8);
  assert.equal(replaced[1].from, 11); assert.equal(replaced[1].to, 13);
});

test('Stage B WAVE 3-ST-2: on-active ~~ delimiters are NOT replaced', () => {
  const state = makeState(FIXTURE, 9); // caret inside "old"
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  assert.equal(collectRanges(out.replaced).length, 0);
});

test('Stage B WAVE 3-ST-3: word "old" itself is NOT replaced (only delimiters)', () => {
  const state = makeState(FIXTURE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  for (const r of replaced) {
    assert.ok(r.from < 8 || r.from >= 11,
      'replaced range at ' + r.from + ' falls inside the word "old"');
  }
});

test('Stage B WAVE 3-ST-4: empty ~~~~ does not crash', () => {
  const fixture = 'line1\n~~~~\nline3\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpInline.buildLpInlineDecorations(state, cm6));
});

test('Stage B WAVE 3-ST-5: emphasis + strikethrough + inline code on same off-active line — all replaced', () => {
  // "line1\n**b** ~~s~~ `c`\nline3\n"
  //  0     5 6  9 10 14 15 18
  const fixture = 'line1\n**b** ~~s~~ `c`\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Expect 6 ranges: 2 ** + 2 ~~ + 2 backticks.
  assert.equal(replaced.length, 6,
    '2 emphasis + 2 strikethrough + 2 code = 6 replaced ranges');
});

test('Stage B WAVE 3-ST-6: strikethrough inside fenced code is NOT replaced', () => {
  // Parser doesn't emit StrikethroughMark inside fenced code blocks.
  const fixture = 'line1\n```\n~~not strike~~\n```\nbody\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  assert.equal(collectRanges(out.replaced).length, 0,
    'no StrikethroughMark inside fenced code → no replace');
});
