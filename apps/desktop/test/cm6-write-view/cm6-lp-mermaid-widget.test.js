/* Stage G.2 WAVE 1 — MermaidWidget async render + destroyed-flag.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-mermaid-widget.test.js

   Uses stub document + stub mermaid global so async render can be
   exercised in Node without jsdom (Hard Rule 4). */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { WidgetType } = require('@codemirror/view');

delete require.cache[require.resolve('../../lib/cm6-lp-mermaid-widget.js')];
const mwMod = require('../../lib/cm6-lp-mermaid-widget.js');

function makeStubElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    attributes: {},
    _textContent: '',
    _innerHTML: '',
    className: '',
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this._innerHTML = ''; this.children = []; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); this._textContent = ''; this.children = []; },
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

let lastRenderCalls = [];
let pendingDeferred = null;
function installResolvingMermaid(svg) {
  globalThis.mermaid = {
    render: function (id, source) {
      lastRenderCalls.push({ id: id, source: source });
      return Promise.resolve({ svg: svg || ('<svg>' + source + '</svg>') });
    },
  };
}
function installRejectingMermaid(errorMsg) {
  globalThis.mermaid = {
    render: function () {
      return Promise.reject(new Error(errorMsg || 'syntax error'));
    },
  };
}
function installDeferringMermaid() {
  globalThis.mermaid = {
    render: function () {
      return new Promise(function (resolve, reject) {
        pendingDeferred = { resolve: resolve, reject: reject };
      });
    },
  };
}
function installThrowingMermaid() {
  globalThis.mermaid = {
    render: function () { throw new Error('synthetic synchronous throw'); },
  };
}
function uninstallMermaid() {
  delete globalThis.mermaid;
}

const Cls = mwMod.getMermaidWidgetClass();

test('Stage G.2 WAVE 1-T-MW-1: toDOM returns <div class="cm-md-lp-mermaid"> synchronously', () => {
  installResolvingMermaid();
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  assert.equal(dom.tagName, 'DIV');
  assert.equal(dom.className, 'cm-md-lp-mermaid');
});

test('Stage G.2 WAVE 1-T-MW-2: async resolve patches innerHTML with the rendered SVG', async () => {
  installResolvingMermaid('<svg id="diagram"></svg>');
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  // Wait for microtask flush so the render Promise resolves.
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.ok(dom.innerHTML.indexOf('<svg') >= 0,
    'after Promise resolve, container.innerHTML contains the SVG');
});

test('Stage G.2 WAVE 1-T-MW-3: rejected render → styled error placeholder with raw source', async () => {
  installRejectingMermaid('Parse error on line 2');
  const w = new Cls('graph TD\nbad syntax');
  const dom = w.toDOM();
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(dom.className, 'cm-md-lp-mermaid cm-md-lp-mermaid-error',
    'error placeholder applies error class');
  assert.equal(dom.textContent, 'graph TD\nbad syntax',
    'raw source shown in error placeholder');
  assert.ok(dom.getAttribute('title').indexOf('Parse error on line 2') >= 0,
    'title attribute records the error message');
});

test('Stage G.2 WAVE 1-T-MW-4: missing mermaid global → plain textContent fallback', () => {
  uninstallMermaid();
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  assert.equal(dom.textContent, 'graph TD\nA-->B',
    'without mermaid, container shows raw source');
});

test('Stage G.2 WAVE 1-T-MW-5: destroy() sets destroyed flag; late resolve does NOT mutate DOM', async () => {
  installDeferringMermaid();
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  // Destroy BEFORE the Promise resolves.
  w.destroy(dom);
  assert.equal(w._destroyed, true, 'destroyed flag set');
  // Now resolve the pending deferred.
  pendingDeferred.resolve({ svg: '<svg>SHOULD NOT APPEAR</svg>' });
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(dom.innerHTML, '',
    'after destroy, late resolve is a no-op — innerHTML unchanged');
});

test('Stage G.2 WAVE 1-T-MW-6: destroy() + late reject also no-op', async () => {
  installDeferringMermaid();
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  w.destroy(dom);
  pendingDeferred.reject(new Error('late error'));
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(dom.className, 'cm-md-lp-mermaid',
    'after destroy, late reject does NOT swap to error class');
});

test('Stage G.2 WAVE 1-T-MW-7: mermaid throwing synchronously → error placeholder', () => {
  installThrowingMermaid();
  const w = new Cls('graph TD\nA-->B');
  const dom = w.toDOM();
  // Synchronous throw caught immediately.
  assert.equal(dom.className, 'cm-md-lp-mermaid cm-md-lp-mermaid-error',
    'sync throw → error class');
  assert.equal(dom.textContent, 'graph TD\nA-->B');
});

test('Stage G.2 WAVE 1-T-MW-8: eq() compares source', () => {
  installResolvingMermaid();
  const a = new Cls('graph TD\nA-->B');
  const b = new Cls('graph TD\nA-->B');
  const c = new Cls('graph LR\nA-->B');
  assert.ok(a.eq(b));
  assert.equal(a.eq(c), false);
});

test('Stage G.2 WAVE 1-T-MW-9: getMermaidWidgetClass cached', () => {
  const a = mwMod.getMermaidWidgetClass();
  const b = mwMod.getMermaidWidgetClass();
  assert.equal(a, b);
});

test('Stage G.2 WAVE 1-T-MW-10: render is called with the source body', async () => {
  installResolvingMermaid();
  lastRenderCalls = [];
  const src = 'graph TD\nNode1-->Node2';
  const w = new Cls(src);
  w.toDOM();
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.equal(lastRenderCalls.length, 1, 'mermaid.render called once');
  assert.equal(lastRenderCalls[0].source, src);
  assert.ok(lastRenderCalls[0].id.indexOf('cm-md-lp-mermaid-') === 0,
    'id matches cm-md-lp-mermaid-* pattern');
});

process.on('exit', () => { globalThis.document = origDoc; uninstallMermaid(); });
