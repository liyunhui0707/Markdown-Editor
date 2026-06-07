/* Stage E WAVE 2 — TableWidget construction + DOM assembly.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-table-widget.test.js

   The widget's toDOM uses document.createElement + textContent for
   XSS-safe rendering. Tests use a stub document with createElement /
   appendChild / setAttribute / textContent — same pattern as
   cm6-lp-image-widget.test.js. */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');

const { WidgetType } = require('@codemirror/view');

delete require.cache[require.resolve('../../lib/cm6-lp-table-widget.js')];
const tableMod = require('../../lib/cm6-lp-table-widget.js');

// ── Stub document for Node tests (no jsdom — Hard Rule 4) ──────────────
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
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
  };
}

const stubDoc = {
  createElement(tag) { return makeStubElement(tag); },
};

// Install the stub as globalThis.document so toDOM uses it.
const origDoc = globalThis.document;
globalThis.document = stubDoc;

function getWidgetClass() {
  const Cls = tableMod.getTableWidgetClass();
  assert.ok(Cls, 'TableWidget class must be obtainable when WidgetType available');
  return Cls;
}

test('Stage E WAVE 2-T-W-1: widget renders <table> with <thead> and <tbody>', () => {
  const Cls = getWidgetClass();
  const w = new Cls({
    headers: ['A', 'B'],
    alignments: [null, null],
    rows: [['1', '2'], ['3', '4']],
  });
  const dom = w.toDOM();
  assert.equal(dom.tagName, 'TABLE');
  assert.equal(dom.className, 'cm-md-lp-table');
  assert.equal(dom.children.length, 2, '<thead> + <tbody>');
  assert.equal(dom.children[0].tagName, 'THEAD');
  assert.equal(dom.children[1].tagName, 'TBODY');
});

test('Stage E WAVE 2-T-W-2: header row contains correct <th> cells', () => {
  const Cls = getWidgetClass();
  const w = new Cls({ headers: ['Col1', 'Col2'], alignments: [null, null], rows: [] });
  const dom = w.toDOM();
  const thead = dom.children[0];
  const headRow = thead.children[0];
  assert.equal(headRow.tagName, 'TR');
  assert.equal(headRow.children.length, 2);
  assert.equal(headRow.children[0].tagName, 'TH');
  assert.equal(headRow.children[0].textContent, 'Col1');
  assert.equal(headRow.children[1].textContent, 'Col2');
});

test('Stage E WAVE 2-T-W-3: body rows contain correct <td> cells', () => {
  const Cls = getWidgetClass();
  const w = new Cls({
    headers: ['A', 'B'],
    alignments: [null, null],
    rows: [['x', 'y']],
  });
  const dom = w.toDOM();
  const tbody = dom.children[1];
  const row1 = tbody.children[0];
  assert.equal(row1.children[0].tagName, 'TD');
  assert.equal(row1.children[0].textContent, 'x');
  assert.equal(row1.children[1].textContent, 'y');
});

test('Stage E WAVE 2-T-W-4: alignment applied via inline style', () => {
  const Cls = getWidgetClass();
  const w = new Cls({
    headers: ['L', 'C', 'R'],
    alignments: ['left', 'center', 'right'],
    rows: [['1', '2', '3']],
  });
  const dom = w.toDOM();
  const headCells = dom.children[0].children[0].children;
  assert.equal(headCells[0].getAttribute('style'), 'text-align: left;');
  assert.equal(headCells[1].getAttribute('style'), 'text-align: center;');
  assert.equal(headCells[2].getAttribute('style'), 'text-align: right;');
  // Body row also gets alignment.
  const bodyCells = dom.children[1].children[0].children;
  assert.equal(bodyCells[0].getAttribute('style'), 'text-align: left;');
});

test('Stage E WAVE 2-T-W-5: header-only table omits <tbody>', () => {
  const Cls = getWidgetClass();
  const w = new Cls({ headers: ['A'], alignments: [null], rows: [] });
  const dom = w.toDOM();
  assert.equal(dom.children.length, 1, 'only <thead>; no <tbody> when no rows');
  assert.equal(dom.children[0].tagName, 'THEAD');
});

test('Stage E WAVE 2-T-W-6: HTML-special chars are textContent-escaped (XSS-safe)', () => {
  const Cls = getWidgetClass();
  const w = new Cls({
    headers: ['safe', 'unsafe'],
    alignments: [null, null],
    rows: [['a', '<script>alert(1)</script>']],
  });
  const dom = w.toDOM();
  const cell = dom.children[1].children[0].children[1];
  // textContent stores raw string; the DOM impl is responsible for
  // escaping. Stub records the raw value; real DOM would render as text.
  assert.equal(cell.textContent, '<script>alert(1)</script>');
});

test('Stage E WAVE 2-T-W-7: empty alignments produce no style attribute', () => {
  const Cls = getWidgetClass();
  const w = new Cls({ headers: ['A', 'B'], alignments: [null, null], rows: [] });
  const dom = w.toDOM();
  const cells = dom.children[0].children[0].children;
  assert.equal(cells[0].getAttribute('style'), undefined,
    'no style attribute when alignment is null');
});

test('Stage E WAVE 2-T-W-8: eq() returns true for identical payloads', () => {
  const Cls = getWidgetClass();
  const a = new Cls({ headers: ['A','B'], alignments: ['left',null], rows: [['1','2']] });
  const b = new Cls({ headers: ['A','B'], alignments: ['left',null], rows: [['1','2']] });
  assert.ok(a.eq(b));
  assert.ok(b.eq(a));
});

test('Stage E WAVE 2-T-W-9: eq() returns false for different payloads', () => {
  const Cls = getWidgetClass();
  const a = new Cls({ headers: ['A','B'], alignments: [null,null], rows: [['1','2']] });
  const b = new Cls({ headers: ['A','B'], alignments: [null,null], rows: [['1','9']] });
  assert.equal(a.eq(b), false);
});

test('Stage E WAVE 2-T-W-10: empty cells render as empty <td>', () => {
  const Cls = getWidgetClass();
  const w = new Cls({ headers: ['A','B','C'], alignments: [null,null,null], rows: [['1','','3']] });
  const dom = w.toDOM();
  const cells = dom.children[1].children[0].children;
  assert.equal(cells[0].textContent, '1');
  assert.equal(cells[1].textContent, '');
  assert.equal(cells[2].textContent, '3');
});

// Restore document at end of file.
process.on('exit', () => { globalThis.document = origDoc; });
