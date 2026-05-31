/* Stage F WAVE 2 — InlineMathWidget + DisplayMathWidget.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-math-widget.test.js

   Uses an inline stub document + stub KaTeX so toDOM can run in Node
   without jsdom (Hard Rule 4). The real KaTeX is loaded via vendored
   script tag in the renderer. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { WidgetType } = require('@codemirror/view');

delete require.cache[require.resolve('../../lib/cm6-lp-math-widget.js')];
const mwMod = require('../../lib/cm6-lp-math-widget.js');

// ── Stub document for Node tests ───────────────────────────────────────
function makeStubElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    _textContent: '',
    className: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
  };
}
const origDoc = globalThis.document;
globalThis.document = { createElement(tag) { return makeStubElement(tag); } };

// ── Stub KaTeX ────────────────────────────────────────────────────────
let lastRenderCalls = [];
function installStubKatex() {
  globalThis.katex = {
    render: function (latex, element, options) {
      lastRenderCalls.push({ latex: latex, displayMode: options && options.displayMode });
      element.textContent = 'KaTeX(' + latex + ')';
    },
  };
}
function installThrowingKatex() {
  globalThis.katex = {
    render: function () {
      throw new Error('synthetic katex failure');
    },
  };
}
function uninstallKatex() {
  delete globalThis.katex;
}

const InlineCls  = mwMod.getInlineMathWidgetClass();
const DisplayCls = mwMod.getDisplayMathWidgetClass();

test('Stage F WAVE 2-T-MW-1: InlineMathWidget toDOM calls katex.render with displayMode:false', () => {
  installStubKatex();
  lastRenderCalls = [];
  const w = new InlineCls('x^2');
  const dom = w.toDOM();
  assert.equal(dom.tagName, 'SPAN');
  assert.equal(dom.className, 'cm-md-lp-math-inline');
  assert.equal(lastRenderCalls.length, 1);
  assert.equal(lastRenderCalls[0].latex, 'x^2');
  assert.equal(lastRenderCalls[0].displayMode, false);
});

test('Stage F WAVE 2-T-MW-2: DisplayMathWidget toDOM calls katex.render with displayMode:true', () => {
  installStubKatex();
  lastRenderCalls = [];
  const w = new DisplayCls('\\sum x');
  const dom = w.toDOM();
  assert.equal(dom.tagName, 'DIV');
  assert.equal(dom.className, 'cm-md-lp-math-display');
  assert.equal(lastRenderCalls.length, 1);
  assert.equal(lastRenderCalls[0].latex, '\\sum x');
  assert.equal(lastRenderCalls[0].displayMode, true);
});

test('Stage F WAVE 2-T-MW-3: missing katex global → fallback shows raw source', () => {
  uninstallKatex();
  const w = new InlineCls('x');
  const dom = w.toDOM();
  assert.equal(dom.textContent, 'x', 'without katex, widget shows raw source');
});

test('Stage F WAVE 2-T-MW-4: katex.render throwing → element gets error class', () => {
  installThrowingKatex();
  const w = new InlineCls('\\frac{');
  const dom = w.toDOM();
  assert.equal(dom.className, 'cm-md-lp-math-error',
    'throwing katex → error-class wrapper');
  assert.equal(dom.textContent, '\\frac{', 'raw source shown in error');
  assert.ok(dom.getAttribute('title').indexOf('synthetic katex failure') >= 0,
    'title attribute records the error message');
});

test('Stage F WAVE 2-T-MW-5: eq() compares source for InlineMathWidget', () => {
  installStubKatex();
  const a = new InlineCls('x');
  const b = new InlineCls('x');
  const c = new InlineCls('y');
  assert.ok(a.eq(b));
  assert.equal(a.eq(c), false);
});

test('Stage F WAVE 2-T-MW-6: eq() compares source for DisplayMathWidget', () => {
  installStubKatex();
  const a = new DisplayCls('x');
  const b = new DisplayCls('x');
  const c = new DisplayCls('y');
  assert.ok(a.eq(b));
  assert.equal(a.eq(c), false);
});

test('Stage F WAVE 2-T-MW-7: eq() returns false across widget types', () => {
  installStubKatex();
  const inline = new InlineCls('x');
  const disp = new DisplayCls('x');
  assert.equal(inline.eq(disp), false);
  assert.equal(disp.eq(inline), false);
});

test('Stage F WAVE 2-T-MW-8: getInlineMathWidgetClass cached', () => {
  const a = mwMod.getInlineMathWidgetClass();
  const b = mwMod.getInlineMathWidgetClass();
  assert.equal(a, b, 'class is cached');
});

process.on('exit', () => { globalThis.document = origDoc; uninstallKatex(); });
