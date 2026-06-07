/* Stage C WAVE 4 — lp-inline image rendering branch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-image-rendering.test.js

   For each off-active inline image (Image node with URL child), the lp
   branch emits ONE Decoration.replace spanning the entire image range
   `![alt](url)`. The widget is:
     - InlineImageWidget when the URL passes the allowlist (https/data/vault-relative)
     - RejectedImageWidget when the URL is rejected (http/javascript/...)

   The widget's spec.widget is `instanceof InlineImageWidget` or
   `RejectedImageWidget` — verifiable at the decoration-set level without
   exercising real DOM. */

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

test('Stage C WAVE 4-T-RENDER-1: off-active ![alt](https://...) → InlineImageWidget', () => {
  const fixture = 'line1\n![alt](https://example.com/x.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1, 'one widget per image');
  assert.ok(ranges[0].widget instanceof InlineImageWidget,
    'safe URL → InlineImageWidget, got ' + (ranges[0].widget && ranges[0].widget.constructor.name));
});

test('Stage C WAVE 4-T-RENDER-2: off-active ![alt](http://...) → RejectedImageWidget', () => {
  const fixture = 'line1\n![alt](http://example.com/x.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].widget instanceof RejectedImageWidget,
    'rejected scheme → RejectedImageWidget');
});

test('Stage C WAVE 4-T-RENDER-3: off-active ![alt](./assets/foo.png) → InlineImageWidget with vault-relative kind', () => {
  const fixture = 'line1\n![alt](./assets/foo.png)\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].widget instanceof InlineImageWidget,
    'vault-relative URL → InlineImageWidget');
});

test('Stage C WAVE 4-T-RENDER-4: off-active ![alt](javascript:...) → RejectedImageWidget (dangerous URL never as src)', () => {
  const fixture = 'line1\n![alt](javascript:alert(1))\nline3\n';
  const state = makeState(fixture, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const ranges = collectRanges(out.replaced);
  assert.equal(ranges.length, 1);
  assert.ok(ranges[0].widget instanceof RejectedImageWidget,
    'javascript: scheme → RejectedImageWidget');
  // Verify the RejectedImageWidget does NOT hold the dangerous URL anywhere
  // that could leak as src. (Rejected widget only stores alt text.)
  const json = JSON.stringify(ranges[0].widget);
  assert.ok(!json.includes('javascript:'),
    'rejected widget must not retain the dangerous URL');
});
