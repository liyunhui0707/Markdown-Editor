/* Stage A WAVE 2 — cm6-lp-inline.js UMD wrapper isolation contract.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-emphasis-isolation.test.js

   Round-2 Codex review (R2-MAJOR 4) flagged that cm6-lp-inline.js
   depends on globalThis.Cm6LineUtils.resolveTouchedLines — the same
   pattern as cm6-active-range.js and cm6-construct-reveal.js. Those
   existing modules require('./cm6-line-utils.js') on the CommonJS path
   so Node tests don't depend on global script-load order (Stage 29 D5).
   This file pins that the lp-emphasis module follows the same pattern:
   loading it via require() must make Cm6LineUtils.resolveTouchedLines
   available even when nothing else has been loaded first. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const LP_EMPH_REL = '../../lib/cm6-lp-inline.js';
const LINE_UTILS_REL = '../../lib/cm6-line-utils.js';

function freshRequireLpEmph() {
  // Wipe both modules from the require cache and the Cm6LineUtils global
  // so the test starts from a known-empty state. Then require() the lp
  // module in isolation — the UMD wrapper's `require('./cm6-line-utils.js')`
  // is what's under test.
  delete require.cache[require.resolve(LP_EMPH_REL)];
  delete require.cache[require.resolve(LINE_UTILS_REL)];
  delete globalThis.Cm6LineUtils;
  return require(LP_EMPH_REL);
}

test('Stage A WAVE 2-D1: loading cm6-lp-inline.js in isolation populates globalThis.Cm6LineUtils', () => {
  const lp = freshRequireLpEmph();
  assert.ok(lp, 'module must export an object');
  assert.ok(globalThis.Cm6LineUtils,
    'after requiring lp-emphasis the Cm6LineUtils global must be present (UMD wrapper requires it on CJS path)');
  assert.equal(typeof globalThis.Cm6LineUtils.resolveTouchedLines, 'function',
    'Cm6LineUtils.resolveTouchedLines must be callable');
});

test('Stage A WAVE 2-D2: cm6-lp-emphasis exports buildLpInlineDecorations and createLpInlineExtension', () => {
  const lp = freshRequireLpEmph();
  assert.equal(typeof lp.buildLpInlineDecorations, 'function',
    'buildLpInlineDecorations must be exported');
  assert.equal(typeof lp.createLpInlineExtension, 'function',
    'createLpInlineExtension must be exported');
});

test('Stage A WAVE 2-D3: createLpInlineExtension returns null when cm6 is missing', () => {
  const lp = freshRequireLpEmph();
  assert.equal(lp.createLpInlineExtension(null), null,
    'null cm6 must return null (M1 sentinel pattern)');
  assert.equal(lp.createLpInlineExtension(undefined), null,
    'undefined cm6 must return null');
  assert.equal(lp.createLpInlineExtension({}), null,
    'empty cm6 must return null (no ViewPlugin)');
});

test('Stage A WAVE 2-D4: createLpInlineExtension returns null when Decoration.replace is missing', () => {
  const lp = freshRequireLpEmph();
  const partial = {
    ViewPlugin: { fromClass: () => ({}) },
    Decoration: { set: () => ({}), none: {} /* no replace */ },
    WidgetType: class {},
    EditorView: { atomicRanges: { of: () => ({}) } },
  };
  assert.equal(lp.createLpInlineExtension(partial), null,
    'missing Decoration.replace must return null');
});

test('Stage A WAVE 2-D5: createLpInlineExtension returns null when WidgetType is missing', () => {
  const lp = freshRequireLpEmph();
  const partial = {
    ViewPlugin: { fromClass: () => ({}) },
    Decoration: { set: () => ({}), none: {}, replace: () => ({}) },
    /* no WidgetType */
    EditorView: { atomicRanges: { of: () => ({}) } },
  };
  assert.equal(lp.createLpInlineExtension(partial), null,
    'missing WidgetType must return null');
});

test('Stage A WAVE 2-D6: createLpInlineExtension returns null when EditorView.atomicRanges is missing', () => {
  const lp = freshRequireLpEmph();
  const partial = {
    ViewPlugin: { fromClass: () => ({}) },
    Decoration: { set: () => ({}), none: {}, replace: () => ({}) },
    WidgetType: class {},
    EditorView: { /* no atomicRanges */ },
  };
  assert.equal(lp.createLpInlineExtension(partial), null,
    'missing EditorView.atomicRanges must return null');
});

test('Stage A WAVE 2-D7: createLpInlineExtension returns an extension when all surfaces are present', () => {
  const lp = freshRequireLpEmph();
  const full = {
    ViewPlugin: { fromClass: (cls, spec) => ({ _ext: 'view-plugin', cls, spec }) },
    Decoration: { set: () => ({ size: 0 }), none: { _none: true }, replace: () => ({ range: () => ({}) }) },
    WidgetType: class {},
    EditorView: { atomicRanges: { of: (fn) => ({ _ext: 'atomic-ranges', fn }) } },
  };
  const ext = lp.createLpInlineExtension(full);
  assert.ok(ext, 'must return a non-null extension when all surfaces present');
  assert.equal(ext._ext, 'view-plugin', 'extension shape is a ViewPlugin (mocked)');
});

test('Stage A WAVE 2-D8: buildLpInlineDecorations returns null when cm6 is missing', () => {
  const lp = freshRequireLpEmph();
  assert.equal(lp.buildLpInlineDecorations(null, null), null);
  assert.equal(lp.buildLpInlineDecorations(null, {}), null);
});

test('Stage A WAVE 2-D9: buildLpInlineDecorations returns {all,replaced} sentinel when state is missing', () => {
  const lp = freshRequireLpEmph();
  const cm6 = {
    Decoration: {
      set: (arr) => ({ size: (arr || []).length, _ranges: arr || [] }),
    },
  };
  const out = lp.buildLpInlineDecorations(null, cm6);
  assert.ok(out, 'must return non-null when cm6 is present even with no state');
  assert.equal(out.all.size, 0,      'all RangeSet is empty when state is missing');
  assert.equal(out.replaced.size, 0, 'replaced RangeSet is empty when state is missing');
});
