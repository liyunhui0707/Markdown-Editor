/* Stage A QA fix — AiSummaryPanel.showLoading(label) optional argument.
   Run focused: cd apps/desktop && node --test test/ai-result-panel-loading-label.test.js

   Backwards-compatible: showLoading() with no args defaults to 'Summarizing…'
   (v0.2.0 contract preserved). showLoading('Rewriting…') displays the
   passed string. Enables per-verb loading text without breaking T7.P3.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Minimal DOM stub mirroring v0.2.0 test/ai-result-panel.test.js shape.
function makeElement(tagName) {
  const classes = new Set();
  const el = {
    tagName,
    children: [],
    _classList: classes,
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
    addEventListener() {},
    dispatchEvent() {},
    querySelector(sel) {
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
  delete require.cache[require.resolve('../lib/ai-result-panel')];
  globalThis.document = doc;
  const mod = require('../lib/ai-result-panel');
  return mod.AiSummaryPanel || mod;
}

test('Stage-A-1: showLoading() with no args defaults to "Summarizing…" (v0.2.0 backward compat)', () => {
  const panel = loadPanel(makeDocument());
  const root = makeElement('div');
  panel.mount(root);
  panel.showLoading();
  assert.equal(root.querySelector('.ai-summary-status').textContent, 'Summarizing…');
});

test('Stage-A-2: showLoading("Rewriting…") sets the passed label', () => {
  const panel = loadPanel(makeDocument());
  const root = makeElement('div');
  panel.mount(root);
  panel.showLoading('Rewriting…');
  assert.equal(root.querySelector('.ai-summary-status').textContent, 'Rewriting…');
});

test('Stage-A-3: showLoading("") falls back to default (empty string treated as missing)', () => {
  const panel = loadPanel(makeDocument());
  const root = makeElement('div');
  panel.mount(root);
  panel.showLoading('');
  assert.equal(root.querySelector('.ai-summary-status').textContent, 'Summarizing…');
});

test('Stage-A-4: showLoading(non-string) falls back to default (defensive)', () => {
  const panel = loadPanel(makeDocument());
  const root = makeElement('div');
  panel.mount(root);
  for (const bad of [null, undefined, 0, {}, []]) {
    panel.showLoading(bad);
    assert.equal(root.querySelector('.ai-summary-status').textContent, 'Summarizing…');
  }
});
