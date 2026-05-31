/* Stage C WAVE 4 — lp inline-image markup branch (REWRITTEN for Stage C).
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-markup.test.js

   CONTRACT CHANGE FROM STAGE B:
   Stage B emitted 5 Decoration.replace ranges per inline image (one per
   LinkMark/URL/LinkTitle child of the Image node). Stage C replaces this
   with ONE Decoration.replace per image, spanning the entire `![alt](url)`
   range, holding an InlineImageWidget that renders the <img>.

   This file pins the new 1-range contract. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');

delete require.cache[require.resolve('../../lib/cm6-lp-inline.js')];
const lpInline = require('../../lib/cm6-lp-inline.js');

delete require.cache[require.resolve('../../lib/cm6-lp-image-widget.js')];
const { InlineImageWidget, RejectedImageWidget } = require('../../lib/cm6-lp-image-widget.js');

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
    out.push({ from: cursor.from, to: cursor.to, widget: cursor.value.spec && cursor.value.spec.widget });
    cursor.next();
  }
  return out;
}

test('Stage C WAVE 4-T-IMG-1: off-active inline image emits EXACTLY 1 Decoration.replace (not 5-6)', () => {
  // "line1\n![alt](https://x.test/img.png)\nline3\n"
  //  0     5 6                            32 33
  // Image node spans offsets 6..32. One widget replaces the entire range.
  const fixture = 'line1\n![alt](https://x.test/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1, 'one widget per image (Stage C contract; Stage B was 5)');
});

test('Stage C WAVE 4-T-IMG-2: widget at the range is InlineImageWidget (safe URL)', () => {
  const fixture = 'line1\n![alt](https://x.test/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.ok(ranges[0].widget instanceof InlineImageWidget);
});

test('Stage C WAVE 4-T-IMG-3: on-active image line emits NOTHING (walker handles reveal)', () => {
  const fixture = 'line1\n![alt](https://x.test/img.png)\nline3\n';
  // Caret on offset 10 — inside the image markup on line 2.
  const state = makeState(fixture, 10);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 0, 'on-active no-op (Stage B parity preserved)');
});

test('Stage C WAVE 4-T-IMG-4: rejected URL (http) emits 1 RejectedImageWidget range', () => {
  const fixture = 'line1\n![alt](http://x.test/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].widget instanceof RejectedImageWidget);
});

test('Stage C WAVE 4-T-IMG-5: reference-style image NOT replaced', () => {
  const fixture = 'line1\n![alt][1]\n\n[1]: https://x.test/img.png\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  // Reference-style Image has no URL child; lp branch skips.
  assert.equal(ranges.length, 0, 'reference-style image not replaced');
});

test('Stage C WAVE 4-T-IMG-6: two inline images on one off-active line → 2 widget ranges', () => {
  const fixture = 'line1\n![a](https://x.test/1.png) ![b](https://x.test/2.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 2, 'two images → two widget ranges');
  assert.ok(ranges.every(r => r.widget instanceof InlineImageWidget));
});

test('Stage C WAVE 4-T-IMG-7: nested emphasis inside alt — image widget covers the range', () => {
  // ![**bold** alt](url) — the Image widget renders the entire image as
  // <img alt="**bold** alt">. The inner EmphasisMark nodes are inside
  // the image's range; with the Image branch returning false from enter,
  // the iterator does NOT descend into Image's children. So no inner
  // emphasis Decoration.replace is emitted. Total: 1 image widget range.
  const fixture = 'line1\n![**bold** alt](https://x.test/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1,
    'image widget owns the entire range; inner emphasis not separately replaced');
  assert.ok(ranges[0].widget instanceof InlineImageWidget);
});

test('Stage C WAVE 4-T-IMG-8: empty image alt ![](url) does not crash', () => {
  const fixture = 'line1\n![](https://x.test/img.png)\nline3\n';
  const state = makeState(fixture, 0);
  assert.doesNotThrow(() => lpInline.buildLpInlineDecorations(state, cm6));
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1);
});

test('Stage C WAVE 4-T-IMG-9: image inside inline link [![alt](img)](page) → 1 image widget + 5 link markers = 6 ranges', () => {
  // The outer Link spans the full text. Its direct children include
  // a LinkMark for `[`, an Image node (the image syntax), LinkMark for
  // `]`, LinkMark for `(`, URL (page-url), LinkMark for `)`. The Image
  // branch handles the image (1 widget); the inline-link branch handles
  // the surrounding link markers (4 LinkMark + 1 URL = 5 ranges).
  const fixture = 'line1\n[![alt](https://x.test/img.png)](https://x.test/page)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  // Expect 6 ranges: 1 image widget + 5 link marker replacements.
  // The image widget is an InlineImageWidget; the 5 link markers are
  // empty-widget replacements (the existing EmptyMarkerWidget).
  assert.equal(ranges.length, 6,
    'image widget (1) + link markers (5) = 6 ranges; got ' + ranges.length);
  const imageWidgets = ranges.filter(r => r.widget instanceof InlineImageWidget);
  assert.equal(imageWidgets.length, 1, 'exactly one image widget');
});
