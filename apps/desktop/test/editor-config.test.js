/* TDD: editor config module must produce the correct Toast UI options.
   Run: node --test test/editor-config.test.js */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const makeEditorConfig = require('../lib/editor-config');

// ── Config shape tests ────────────────────────────────────────────────────────

test('makeEditorConfig is a function', () => {
  assert.equal(typeof makeEditorConfig, 'function');
});

test('el is passed through unchanged', () => {
  const sentinel = { tagName: 'DIV' };
  const config = makeEditorConfig(sentinel);
  assert.equal(config.el, sentinel);
});

test('initialEditType is markdown', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.initialEditType, 'markdown');
});

test('previewStyle is explicitly tab', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.previewStyle, 'tab');
});

test('hideModeSwitch is true', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.hideModeSwitch, true);
});

test('usageStatistics is false', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.usageStatistics, false);
});

test('height is 100%', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.height, '100%');
});

test('initialValue is empty string', () => {
  const config = makeEditorConfig(null);
  assert.equal(config.initialValue, '');
});

test('toolbarItems has the expected three groups', () => {
  const config = makeEditorConfig(null);
  assert.deepEqual(config.toolbarItems, [
    ['heading', 'bold', 'italic'],
    ['ul', 'ol'],
    ['link'],
  ]);
});

// ── Static wiring tests ───────────────────────────────────────────────────────

test('index.html loads editor-config.js via script tag', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /<script src="\.\/lib\/editor-config\.js"><\/script>/);
});

test('index.html instantiates ToastuiEditor via window.makeEditorConfig(liveEditorContainer)', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'index.html'),
    'utf8'
  );
  assert.match(html, /window\.makeEditorConfig\(liveEditorContainer\)/);
});
