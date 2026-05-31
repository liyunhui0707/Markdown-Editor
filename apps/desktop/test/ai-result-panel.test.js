/* T7 — lib/ai-result-panel.js
   Run focused: cd apps/desktop && node --test test/ai-result-panel.test.js

   Verifies the F4 ownership contract (HTML provides empty shell;
   mount(root) creates .ai-summary-status + .ai-summary-body children),
   and the show / clear API. Renders via textContent only (XSS-safe).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM stub. Mirrors the smallest subset of the browser DOM
// required by AiSummaryPanel: createElement, classList, appendChild,
// textContent, hidden, querySelector, children.

function makeElement(tagName) {
  const classes = new Set();
  const handlers = {};
  const el = {
    tagName,
    children: [],
    _classList: classes,
    _handlers: handlers,
    classList: {
      add(...names) { names.forEach((n) => classes.add(n)); },
      remove(...names) { names.forEach((n) => classes.delete(n)); },
      contains(n) { return classes.has(n); },
    },
    textContent: '',
    hidden: false,
    appendChild(child) {
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    addEventListener(type, handler) {
      (handlers[type] = handlers[type] || []).push(handler);
    },
    dispatchEvent(type) {
      (handlers[type] || []).forEach((h) => h({ type, target: el }));
    },
    querySelector(sel) {
      // We only support '.foo' selectors here.
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        for (const c of el.children) if (c._classList.has(cls)) return c;
        for (const c of el.children) {
          const inner = c.querySelector ? c.querySelector(sel) : null;
          if (inner) return inner;
        }
      }
      return null;
    },
  };
  return el;
}

function makeDocument() {
  return { createElement: (tag) => makeElement(tag) };
}

function loadPanel(doc) {
  // The panel module is UMD-ish; in node it reads document from globalThis
  // by default but accepts an override via setDocument() for tests.
  delete require.cache[require.resolve('../lib/ai-result-panel')];
  globalThis.document = doc;
  const mod = require('../lib/ai-result-panel');
  return mod.AiSummaryPanel || mod;
}

test('T7.P1 mount(root) creates .ai-summary-status and .ai-summary-body children', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  assert.equal(root.children.length, 2);
  const status = root.querySelector('.ai-summary-status');
  const body = root.querySelector('.ai-summary-body');
  assert.ok(status);
  assert.ok(body);
});

test('T7.P2 mount(root) is idempotent (no duplicate children)', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.mount(root);
  assert.equal(root.children.length, 2);
});

test('T7.P3 showLoading() unhides + sets status text + clears body', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  root.hidden = true;
  panel.mount(root);
  root.querySelector('.ai-summary-body').textContent = 'old';
  panel.showLoading();
  assert.equal(root.hidden, false);
  assert.ok(/summari/i.test(root.querySelector('.ai-summary-status').textContent));
  assert.equal(root.querySelector('.ai-summary-body').textContent, '');
});

test('T7.P4 showSummary unhides + sets body textContent (XSS-safe)', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.showSummary('Hello.');
  assert.equal(root.hidden, false);
  assert.equal(root.querySelector('.ai-summary-body').textContent, 'Hello.');
  assert.equal(root.querySelector('.ai-summary-status').textContent, '');
});

test('T7.P5 showError unhides, adds error class, sets body to message', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.showError('boom');
  assert.equal(root.hidden, false);
  assert.ok(root.classList.contains('error'));
  assert.ok(/error/i.test(root.querySelector('.ai-summary-status').textContent));
  assert.equal(root.querySelector('.ai-summary-body').textContent, 'boom');
});

test('T7.P6 showSummary after showError clears the error class', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.showError('boom');
  panel.showSummary('OK.');
  assert.equal(root.classList.contains('error'), false);
});

test('T7.P7 clear() hides root, removes error class, empties text (keeps children)', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.showError('boom');
  panel.clear();
  assert.equal(root.hidden, true);
  assert.equal(root.classList.contains('error'), false);
  assert.equal(root.children.length, 2);
  assert.equal(root.querySelector('.ai-summary-body').textContent, '');
});

test('T7.P8 untrusted input goes through textContent (no innerHTML)', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root);
  panel.showSummary('<script>x()</script>');
  const body = root.querySelector('.ai-summary-body');
  assert.equal(body.textContent, '<script>x()</script>');
  assert.equal(body.children.length, 0);
});

test('T7.P9 mount({ onClose }) creates a close button as a third child', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root, { onClose: () => {} });
  assert.equal(root.children.length, 3);
  const close = root.querySelector('.ai-summary-close');
  assert.ok(close, 'expected a .ai-summary-close child');
});

test('T7.P10 mount({ onClose }) wires the close button click to onClose', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  let fired = 0;
  panel.mount(root, { onClose: () => { fired += 1; } });
  const close = root.querySelector('.ai-summary-close');
  close.dispatchEvent('click');
  assert.equal(fired, 1);
});

test('T7.P11 mount without options does NOT create a close button (backwards compat)', () => {
  const doc = makeDocument();
  const panel = loadPanel(doc);
  const root = makeElement('div');
  panel.mount(root); // no options
  assert.equal(root.children.length, 2);
  assert.equal(root.querySelector('.ai-summary-close'), null);
});
