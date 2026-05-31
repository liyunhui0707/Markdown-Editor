/* Stage G.1 WAVE 1 — CodeBlockWidget toDOM behavior.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-code-widget.test.js

   Uses an inline stub document + stub hljs so toDOM can run in Node
   without jsdom. Real hljs is loaded via the vendored bundle in the
   renderer. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { WidgetType } = require('@codemirror/view');

delete require.cache[require.resolve('../../lib/cm6-lp-code-widget.js')];
const cwMod = require('../../lib/cm6-lp-code-widget.js');

function makeStubElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    _textContent: '',
    _innerHTML: '',
    className: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this._innerHTML = ''; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); this._textContent = ''; },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
  };
}
const origDoc = globalThis.document;
globalThis.document = { createElement(tag) { return makeStubElement(tag); } };

let lastHighlightCalls = [];
function installStubHljs() {
  globalThis.hljs = {
    getLanguage: function (name) {
      return (name === 'js' || name === 'javascript' || name === 'python') ? {} : null;
    },
    highlight: function (code, opts) {
      lastHighlightCalls.push({ code: code, language: opts && opts.language });
      return { value: '<span class="hljs-keyword">' + code + '</span>' };
    },
  };
}
function installThrowingHljs() {
  globalThis.hljs = {
    getLanguage: function () { return {}; },
    highlight: function () { throw new Error('synthetic hljs failure'); },
  };
}
function uninstallHljs() {
  delete globalThis.hljs;
}

const Cls = cwMod.getCodeBlockWidgetClass();

test('Stage G.1 WAVE 1-T-CW-1: known language → toDOM emits <pre><code class="hljs language-js"> with hljs HTML', () => {
  installStubHljs();
  lastHighlightCalls = [];
  const w = new Cls({ lang: 'js', code: 'const x;' });
  const dom = w.toDOM();
  assert.equal(dom.tagName, 'PRE');
  assert.equal(dom.className, 'cm-md-lp-code-block');
  assert.equal(dom.children.length, 1);
  const code = dom.children[0];
  assert.equal(code.tagName, 'CODE');
  assert.equal(code.className, 'hljs language-js');
  assert.ok(code.innerHTML.indexOf('hljs-keyword') >= 0,
    'innerHTML contains hljs span class');
  assert.equal(lastHighlightCalls.length, 1);
  assert.equal(lastHighlightCalls[0].language, 'js');
});

test('Stage G.1 WAVE 1-T-CW-2: unknown language → plain textContent', () => {
  installStubHljs();
  const w = new Cls({ lang: 'xyz123', code: 'mystery' });
  const dom = w.toDOM();
  const code = dom.children[0];
  assert.equal(code.textContent, 'mystery');
  assert.equal(code.innerHTML, '', 'no innerHTML when fallback path runs');
  assert.equal(code.className, 'hljs language-xyz123',
    'class still includes language-xyz123 (caller may still want CSS hooks)');
});

test('Stage G.1 WAVE 1-T-CW-3: no language → plain textContent', () => {
  installStubHljs();
  const w = new Cls({ lang: '', code: 'no-lang' });
  const dom = w.toDOM();
  const code = dom.children[0];
  assert.equal(code.textContent, 'no-lang');
  assert.equal(code.className, 'hljs', 'no language-* class when lang is empty');
});

test('Stage G.1 WAVE 1-T-CW-4: empty code → empty <code> without crash', () => {
  installStubHljs();
  const w = new Cls({ lang: 'js', code: '' });
  const dom = w.toDOM();
  const code = dom.children[0];
  // hljs stub returns "<span class=\"hljs-keyword\"></span>" for empty input;
  // real hljs returns the empty string. Either is fine — no crash.
  assert.equal(code.tagName, 'CODE');
});

test('Stage G.1 WAVE 1-T-CW-5: HTML-special chars without language → textContent (XSS-safe)', () => {
  installStubHljs();
  const w = new Cls({ lang: '', code: '<script>alert(1)</script>' });
  const dom = w.toDOM();
  const code = dom.children[0];
  // textContent stores raw; the real DOM impl renders as text not HTML.
  assert.equal(code.textContent, '<script>alert(1)</script>');
  assert.equal(code.innerHTML, '');
});

test('Stage G.1 WAVE 1-T-CW-6: eq() compares lang + code', () => {
  installStubHljs();
  const a = new Cls({ lang: 'js', code: 'x' });
  const b = new Cls({ lang: 'js', code: 'x' });
  const c = new Cls({ lang: 'py', code: 'x' });
  const d = new Cls({ lang: 'js', code: 'y' });
  assert.ok(a.eq(b));
  assert.equal(a.eq(c), false, 'different lang → not eq');
  assert.equal(a.eq(d), false, 'different code → not eq');
});

test('Stage G.1 WAVE 1-T-CW-7: missing hljs global → plain textContent fallback', () => {
  uninstallHljs();
  const w = new Cls({ lang: 'js', code: 'x = 1;' });
  const dom = w.toDOM();
  const code = dom.children[0];
  assert.equal(code.textContent, 'x = 1;', 'without hljs, fallback to source text');
});

test('Stage G.1 WAVE 1-T-CW-8: hljs throwing → plain textContent fallback', () => {
  installThrowingHljs();
  const w = new Cls({ lang: 'js', code: 'crash me' });
  const dom = w.toDOM();
  const code = dom.children[0];
  assert.equal(code.textContent, 'crash me', 'throwing hljs → textContent fallback');
});

test('Stage G.1 WAVE 1-T-CW-9: getCodeBlockWidgetClass cached', () => {
  const a = cwMod.getCodeBlockWidgetClass();
  const b = cwMod.getCodeBlockWidgetClass();
  assert.equal(a, b);
});

process.on('exit', () => { globalThis.document = origDoc; uninstallHljs(); });
