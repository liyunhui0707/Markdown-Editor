/* Stage F WAVE 3 — lp-inline + lp-block math integration.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-math-render.test.js

   Verifies that detected math ranges turn into Decoration.replace
   in lp-inline (inline math) and lp-block (display math), with
   Lezer-aware filtering for InlineCode/FencedCode and frontmatter
   exclusion. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

// Stage G.3 — display math (block:true) moved from cm6-lp-block.js to
// cm6-lp-block-widgets.js (StateField source). Inline math (Stage F)
// stays in cm6-lp-inline.js.
delete require.cache[require.resolve('../../lib/cm6-lp-inline.js')];
delete require.cache[require.resolve('../../lib/cm6-lp-block-widgets.js')];
const lpInline = require('../../lib/cm6-lp-inline.js');
const lpBlock  = {
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

// ── INLINE MATH (lp-inline) ────────────────────────────────────────────

test('Stage F WAVE 3-T-MR-1: off-active inline $x$ produces 1 replace', () => {
  // "alpha $x$ beta\n"
  //  0      6   10
  const doc = 'alpha $x$ beta\n';
  const state = makeState(doc, 0); // caret at line 1 start... actually line 1 is the only line
  // To make math off-active: doc must be multi-line.
  const doc2 = 'top\nalpha $x$ beta\nbottom\n';
  const state2 = makeState(doc2, 0); // caret on "top"
  const out = lpInline.buildLpInlineDecorations(state2, cm6);
  const replaced = collectRanges(out.replaced);
  assert.ok(replaced.length >= 1, 'expected at least 1 replace (the inline math)');
  // Find the math range — should be the only one in this doc.
  const mathR = replaced.find(r => doc2.charAt(r.from) === '$');
  assert.ok(mathR, 'a $-starting range must be present');
  assert.equal(doc2.slice(mathR.from, mathR.to), '$x$', 'replace covers $x$ exactly');
});

test('Stage F WAVE 3-T-MR-2: on-active inline math (caret on same line) → no math replace', () => {
  const doc = 'top\nalpha $x$ beta\nbottom\n';
  const state = makeState(doc, 12); // caret inside "$x$" on line 2
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined,
    'caret on math line → no $-replace from lp-inline');
});

test('Stage F WAVE 3-T-MR-3: math inside inline code is NOT replaced', () => {
  // "top\nuse `$x$` here\nend\n"
  const doc = 'top\nuse `$x$` here\nend\n';
  const state = makeState(doc, 0); // caret on line 1 — math is in line 2 off-active
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  // Find any $-starting range — should not exist.
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined,
    'math inside inline code must NOT produce a math replace');
});

test('Stage F WAVE 3-T-MR-4: math inside fenced code is NOT replaced', () => {
  const doc = 'top\n```\n$x$ in code\n```\nend\n';
  const state = makeState(doc, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined,
    'math inside fenced code must NOT produce a math replace');
});

test('Stage F WAVE 3-T-MR-5: math in frontmatter is NOT replaced', () => {
  const doc = '---\ntitle: $x$\n---\nbody\n';
  const state = makeState(doc, 22); // caret on "body"
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined,
    'math in frontmatter must NOT produce a math replace');
});

test('Stage F WAVE 3-T-MR-6: escaped \\$ inline does NOT trigger math', () => {
  const doc = 'top\nPrice \\$100 today.\nend\n';
  const state = makeState(doc, 0);
  const out = lpInline.buildLpInlineDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined, 'escaped $ must not trigger math');
});

// ── DISPLAY MATH (lp-block) ────────────────────────────────────────────

test('Stage F WAVE 3-T-MR-7: off-active display $$x$$ produces 1 block replace', () => {
  const doc = 'top\n\n$$\nx + y\n$$\n\nend\n';
  const state = makeState(doc, 0); // caret on "top"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 1, 'expected 1 display-math replace');
  // The range must cover the $$...$$ block.
  assert.equal(doc.slice(replaced[0].from, replaced[0].from + 2), '$$',
    'replace starts with $$');
});

test('Stage F WAVE 3-T-MR-8: caret on display math block → no replace', () => {
  const doc = 'top\n\n$$\nx + y\n$$\n\nend\n';
  // Find position inside the display block (after the first $$\n).
  const innerPos = doc.indexOf('x + y');
  const state = makeState(doc, innerPos);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  assert.equal(replaced.length, 0, 'caret in display block → 0 replaces');
});

test('Stage F WAVE 3-T-MR-9: display math uses block:true spec', () => {
  const doc = 'top\n\n$$\nx\n$$\n\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const c = out.replaced.iter();
  assert.ok(c.value, 'must have a replace');
  assert.equal(c.value.spec.block, true, 'display math replace must be block:true');
});

test('Stage F WAVE 3-T-MR-10: display math inside fenced code is NOT replaced as math', () => {
  // Stage G.1 added a FencedCode widget that DOES replace the entire
  // ```...``` block. But the math inside must NOT trigger a SEPARATE
  // math widget. We assert: no $-starting range appears in the
  // replaced set (the FencedCode replace starts with `).
  const doc = 'top\n\n```\n$$\nx\n$$\n```\n\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const replaced = collectRanges(out.replaced);
  const mathR = replaced.find(r => doc.charAt(r.from) === '$');
  assert.equal(mathR, undefined,
    'display math inside fenced code must NOT produce a $-starting math replace');
});

test('Stage F WAVE 3-T-MR-11: round-trip — doc unchanged after build', () => {
  const doc = 'top\n\n$$\nx\n$$\n\nmid $y$ end\n';
  const state = makeState(doc, 0);
  lpInline.buildLpInlineDecorations(state, cm6);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), doc, 'doc must NOT mutate');
});
