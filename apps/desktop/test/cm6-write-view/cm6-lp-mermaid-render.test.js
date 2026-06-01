/* Stage G.2 WAVE 2 — lp-block FencedCode lang dispatch.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-mermaid-render.test.js

   Verifies:
     - ```mermaid blocks emit a MermaidWidget.
     - ```js (and other) blocks emit a CodeBlockWidget (Stage G.1 unchanged).
     - On-active behavior preserved.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { EditorState }                = require('@codemirror/state');
const { Decoration, WidgetType }     = require('@codemirror/view');
const { syntaxTree }                 = require('@codemirror/language');
const { markdown, markdownLanguage } = require('@codemirror/lang-markdown');
const { GFM }                        = require('@lezer/markdown');

// Stage G.3 — FencedCode block widget (which dispatches to MermaidWidget
// vs CodeBlockWidget on lang) now lives in cm6-lp-block-widgets.js.
delete require.cache[require.resolve('../../lib/cm6-lp-block-widgets.js')];
delete require.cache[require.resolve('../../lib/cm6-lp-mermaid-widget.js')];
delete require.cache[require.resolve('../../lib/cm6-lp-code-widget.js')];
const lpBlock = {
  buildLpBlockDecorations: require('../../lib/cm6-lp-block-widgets.js').buildBlockWidgetDecorations,
};
const mermaidMod   = require('../../lib/cm6-lp-mermaid-widget.js');
const codeMod      = require('../../lib/cm6-lp-code-widget.js');

const cm6 = { Decoration, syntaxTree, WidgetType };

function makeState(doc, cursorPos) {
  return EditorState.create({
    doc,
    selection: { anchor: cursorPos == null ? 0 : cursorPos, head: cursorPos == null ? 0 : cursorPos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: [], extensions: [GFM] })],
  });
}

function widgetsOf(rangeSet) {
  const out = [];
  if (!rangeSet || typeof rangeSet.iter !== 'function') return out;
  const c = rangeSet.iter();
  while (c.value) {
    out.push({
      from: c.from,
      to: c.to,
      widget: c.value.spec && c.value.spec.widget,
    });
    c.next();
  }
  return out;
}

const MermaidCls = mermaidMod.getMermaidWidgetClass();
const CodeCls    = codeMod.getCodeBlockWidgetClass();

test('Stage G.2 WAVE 2-T-MD-1: ```mermaid block off-active → 1 replace with MermaidWidget', () => {
  const doc = 'top\n```mermaid\ngraph TD\nA-->B\n```\nend\n';
  const state = makeState(doc, 0); // caret on "top"
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const ws = widgetsOf(out.replaced);
  assert.equal(ws.length, 1, 'one fenced code → one replace');
  assert.ok(ws[0].widget instanceof MermaidCls,
    'widget must be MermaidWidget instance, not CodeBlockWidget');
});

test('Stage G.2 WAVE 2-T-MD-2: ```js block off-active → 1 replace with CodeBlockWidget (Stage G.1 unchanged)', () => {
  const doc = 'top\n```js\nconst x = 1;\n```\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const ws = widgetsOf(out.replaced);
  assert.equal(ws.length, 1);
  assert.ok(ws[0].widget instanceof CodeCls,
    'widget must be CodeBlockWidget (Stage G.1 path preserved for non-mermaid)');
  assert.equal(ws[0].widget instanceof MermaidCls, false,
    'js block must NOT be a MermaidWidget');
});

test('Stage G.2 WAVE 2-T-MD-3: caret in mermaid block → 0 replaces (on-active preserved)', () => {
  const doc = 'top\n```mermaid\ngraph TD\nA-->B\n```\nend\n';
  const pos = doc.indexOf('graph');
  const state = makeState(doc, pos);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const ws = widgetsOf(out.replaced);
  assert.equal(ws.length, 0, 'caret in mermaid block → 0 replaces');
});

test('Stage G.2 WAVE 2-T-MD-4: mermaid + js in same doc → correct widget per block', () => {
  const doc = 'top\n```mermaid\ngraph TD\nA-->B\n```\nmid\n```js\nconst y;\n```\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const ws = widgetsOf(out.replaced);
  assert.equal(ws.length, 2, 'two fenced blocks → two replaces');
  // Sort by `from` (they should already be sorted, but defensive).
  ws.sort(function (a, b) { return a.from - b.from; });
  assert.ok(ws[0].widget instanceof MermaidCls, 'first block (mermaid) uses MermaidWidget');
  assert.ok(ws[1].widget instanceof CodeCls,    'second block (js) uses CodeBlockWidget');
});

test('Stage G.2 WAVE 2-T-MD-5: ```  mermaid  block (whitespace) → MermaidWidget (trimmed)', () => {
  // The lang extraction in cm6-lp-block.js trims the CodeInfo text.
  // Test the dispatch handles trimmed values.
  const doc = 'top\n```   mermaid   \ngraph TD\n```\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const ws = widgetsOf(out.replaced);
  assert.equal(ws.length, 1);
  assert.ok(ws[0].widget instanceof MermaidCls,
    'whitespace-padded "  mermaid  " info still dispatches to MermaidWidget');
});

test('Stage G.2 WAVE 2-T-MD-6: round-trip — doc unchanged after build', () => {
  const doc = 'top\n```mermaid\ngraph TD\nA-->B\n```\nend\n';
  const state = makeState(doc, 0);
  lpBlock.buildLpBlockDecorations(state, cm6);
  assert.equal(state.doc.toString(), doc);
});

test('Stage G.2 WAVE 2-T-MD-7: ```mermaid uses block:true spec', () => {
  const doc = 'top\n```mermaid\ngraph TD\nA-->B\n```\nend\n';
  const state = makeState(doc, 0);
  const out = lpBlock.buildLpBlockDecorations(state, cm6);
  const c = out.replaced.iter();
  assert.ok(c.value, 'must have a replace');
  assert.equal(c.value.spec.block, true, 'mermaid replace must be block:true');
});
