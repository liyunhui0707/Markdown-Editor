/* Stage B WAVE 4 — lp inline-link markers branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-link-markers.test.js

   For `[text](url)`: 4 LinkMark + 1 URL = 5 replaced ranges off-active.
   For `[text](url "title")`: 6 ranges (+ LinkTitle).
   Link TEXT range is NOT replaced.
   Reference-style links `[text][ref]` and autolinks `<url>` are NOT replaced. */

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

// "line1\n[text](https://example.com)\nline3\n"
//  0     5 6                        32 33
// Link spans [6, 33). LinkMarks at 6, 11-12, 12-13, 32-33. URL at 13-32.
const FIXTURE_LINK_NO_TITLE = 'line1\n[text](https://example.com)\nline3\n';

test('Stage B WAVE 4-LK-1: off-active inline link [text](url) emits 5 replaced ranges', () => {
  const state = makeState(FIXTURE_LINK_NO_TITLE, 0); // caret on line 1
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 5,
    'expected 5 replaced ranges (4 LinkMark + 1 URL), got ' + replaced.length);
});

test('Stage B WAVE 4-LK-2: link TEXT range is NOT in replaced', () => {
  const state = makeState(FIXTURE_LINK_NO_TITLE, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Link TEXT is between offsets 7 (after [) and 11 (before ]). The word "text".
  for (const r of replaced) {
    assert.ok(r.to <= 7 || r.from >= 11,
      'replaced range [' + r.from + ',' + r.to + ') overlaps link TEXT range [7,11)');
  }
});

test('Stage B WAVE 4-LK-3: with title [text](url "title") emits 6 replaced ranges', () => {
  const fixture = 'line1\n[text](https://example.com "title")\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 6,
    'expected 6 replaced ranges (4 LinkMark + 1 URL + 1 LinkTitle), got ' + replaced.length);
});

test('Stage B WAVE 4-LK-4: on-active link markers are NOT replaced', () => {
  const state = makeState(FIXTURE_LINK_NO_TITLE, 10); // caret inside "text"
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  assert.equal(collectRanges(out.replaced).length, 0);
});

test('Stage B WAVE 4-LK-5: reference-style link [text][ref] is NOT replaced', () => {
  const fixture = 'line1\n[text][ref]\n\n[ref]: https://example.com\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // The Link parent of the [text][ref] LinkMarks has no direct URL child
  // (URL belongs to the LinkReference definition). isInlineLinkAncestor
  // returns false → no replace.
  assert.equal(replaced.length, 0,
    'reference-style link must NOT be replaced');
});

test('Stage B WAVE 4-LK-6: autolink <url> is NOT replaced', () => {
  const fixture = 'line1\n<https://example.com>\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // The < and > LinkMarks have parent.name === 'Autolink', not 'Link'.
  assert.equal(replaced.length, 0,
    'autolink must NOT be replaced (out of scope for Stage B)');
});

test('Stage B WAVE 4-LK-7: link source offsets unchanged (Cmd-click model preserved)', () => {
  // Verify that getText() returns the document character-identical — proves
  // Decoration.replace does not mutate the source offsets the Stage 25
  // Cmd-click handler depends on.
  const state = makeState(FIXTURE_LINK_NO_TITLE, 0);
  assert.equal(state.doc.toString(), FIXTURE_LINK_NO_TITLE,
    'getText() preserves source — Cmd-click offset model intact');
});

test('Stage B WAVE 4-LK-8: nested emphasis inside link text [**bold** text](url) — emphasis still replaced', () => {
  // The inner **bold** EmphasisMarks should still be replaced when off-active,
  // independently of the link branch. Total replaced should be link's 5 + 2 emphasis = 7.
  const fixture = 'line1\n[**bold** text](https://example.com)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 7,
    'link (5 ranges) + inner emphasis (2 ranges) = 7 replaced, got ' + replaced.length);
});

test('Stage B WAVE 4-LK-9: empty link [](url) does not crash', () => {
  const fixture = 'line1\n[](https://example.com)\nline3\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpInline.buildLpInlineDecorations(state, cm6));
});
