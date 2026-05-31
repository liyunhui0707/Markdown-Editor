/* Stage B WAVE 5 — lp inline-image markers branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-markup.test.js

   For `![alt](url)`: 4 LinkMark (note: opening `![` is 1 LinkMark of length 2)
   + 1 URL = 5 replaced ranges off-active.
   For `![alt](url "title")`: 6 ranges (+ LinkTitle).
   Image ALT range is NOT replaced (stays visible with cm-md-image-alt styling).
   Reference-style images `![alt][1]` are NOT replaced. */

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

// "line1\n![alt](https://example.com/img.png)\nline3\n"
//  0     5 6                                 41 42
// Image spans [6, 41). LinkMarks at 6-8 (![), 11-12 (]), 12-13 ((), 40-41 ()).
// URL at 13-40.
const FIXTURE_IMG_NO_TITLE = 'line1\n![alt](https://example.com/img.png)\nline3\n';

test('Stage B WAVE 5-IM-1: off-active inline image ![alt](url) emits 5 replaced ranges', () => {
  const state = makeState(FIXTURE_IMG_NO_TITLE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 5,
    'expected 5 replaced ranges (4 LinkMark + 1 URL), got ' + replaced.length);
});

test('Stage B WAVE 5-IM-2: image ALT range is NOT in replaced', () => {
  const state = makeState(FIXTURE_IMG_NO_TITLE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Alt range is between offsets 8 (after ![) and 11 (before ]). The word "alt".
  for (const r of replaced) {
    assert.ok(r.to <= 8 || r.from >= 11,
      'replaced range [' + r.from + ',' + r.to + ') overlaps image alt range [8,11)');
  }
});

test('Stage B WAVE 5-IM-3: with title ![alt](url "title") emits 6 replaced ranges', () => {
  const fixture = 'line1\n![alt](https://example.com/img.png "title")\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 6,
    'expected 6 replaced ranges (4 LinkMark + 1 URL + 1 LinkTitle), got ' + replaced.length);
});

test('Stage B WAVE 5-IM-4: on-active image markers are NOT replaced', () => {
  const state = makeState(FIXTURE_IMG_NO_TITLE, 9); // caret inside "alt"
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  assert.equal(collectRanges(out.replaced).length, 0);
});

test('Stage B WAVE 5-IM-5: reference-style image ![alt][1] is NOT replaced', () => {
  const fixture = 'line1\n![alt][1]\n\n[1]: https://example.com/img.png\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  // The Image parent has no direct URL child; isInlineImageAncestor returns false.
  assert.equal(collectRanges(out.replaced).length, 0,
    'reference-style image must NOT be replaced');
});

test('Stage B WAVE 5-IM-6: nested emphasis inside image alt — emphasis still replaced', () => {
  // Alt text contains **bold**. Total replaced = 5 image + 2 emphasis = 7.
  const fixture = 'line1\n![**bold** alt](https://example.com/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 7,
    'image (5 ranges) + inner emphasis (2 ranges) = 7 replaced, got ' + replaced.length);
});

test('Stage B WAVE 5-IM-7: empty image ![](url) does not crash', () => {
  const fixture = 'line1\n![](https://example.com/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpInline.buildLpInlineDecorations(state, cm6));
});

test('Stage B WAVE 5-IM-8: all four marker types on one off-active line', () => {
  // **b** `c` ~~s~~ [l](u) ![i](u)
  const fixture = 'line1\n**b** `c` ~~s~~ [l](https://x.test) ![i](https://x.test/i.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // 2 emphasis + 2 backticks + 2 strikethrough + 5 link + 5 image = 16 ranges
  assert.equal(replaced.length, 16,
    '2+2+2+5+5 = 16 replaced ranges for all 5 marker types combined, got ' + replaced.length);
});
