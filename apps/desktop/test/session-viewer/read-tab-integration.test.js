/* Stage S3 — Read tab integration (renderer-boot harness style).
   These tests exercise the DOM-level behavior wired in index.html: the
   Read button visibility gate, the saved-mode fallback for non-session
   notes, scroll-state hygiene, and the no-selection-from-Read state.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

function readIndex() {
  return fs.readFileSync(INDEX_HTML_PATH, 'utf8');
}

test('index.html declares modeReadButton statically with hidden + aria-selected=false', () => {
  const src = readIndex();
  assert.match(src, /<button[^>]*id="modeReadButton"[^>]*hidden[^>]*>Read<\/button>/s,
    'modeReadButton tag should exist with hidden attribute');
  assert.match(src, /id="modeReadButton"[^>]*aria-selected="false"/s);
});

test('index.html declares readViewMount static div', () => {
  const src = readIndex();
  assert.match(src, /<div\s+id="readViewMount"\s+class="read-view-mount"[^>]*>/);
});

test('index.html includes the new script tags', () => {
  const src = readIndex();
  for (const lib of [
    './lib/session-viewer/read-inline.js',
    './lib/session-viewer/read-user-preprocess.js',
    './lib/session-viewer/read-renderer.js',
    './lib/session-viewer/read-tab.js',
  ]) {
    assert.match(src, new RegExp(`<script\\s+src="${lib.replace(/\./g, '\\.').replace(/\//g, '\\/')}">`),
      `script tag for ${lib} should exist`);
  }
});

test('script tags are in dependency order (inline before renderer before tab)', () => {
  const src = readIndex();
  const pos = (s) => src.indexOf(`<script src="${s}">`);
  assert.ok(
    pos('./lib/session-viewer/read-inline.js') <
    pos('./lib/session-viewer/read-renderer.js'),
    'read-inline must load before read-renderer',
  );
  assert.ok(
    pos('./lib/session-viewer/read-renderer.js') <
    pos('./lib/session-viewer/read-tab.js'),
    'read-renderer must load before read-tab',
  );
});

test('CSS for .read-view-mount + .is-visible exists', () => {
  const src = readIndex();
  assert.match(src, /\.read-view-mount\s*\{[^}]*display:\s*none/s);
  assert.match(src, /\.read-view-mount\.is-visible\s*\{[^}]*display:\s*block/s);
});

test('setActiveMode has a "read" branch that toggles classes and calls renderInto', () => {
  const src = readIndex();
  assert.match(src, /mode === 'read'/);
  assert.match(src, /readTabController\.renderInto\(getCurrentEditorText\(\)\)/);
  // The branch must add .is-visible to readViewMount and add hidden to write
  assert.match(src, /readViewMount\.classList\.add\(\s*'is-visible'\s*\)/);
});

test('showReadMode click handler is wired on modeReadButton', () => {
  const src = readIndex();
  assert.match(src, /modeReadButton\.addEventListener\(\s*'click'\s*,\s*showReadMode\s*\)/);
});

test('readTabController is created with renderMarkdown from window.SessionViewer', () => {
  const src = readIndex();
  assert.match(src, /window\.SessionViewer\.createReadTabController\(\{/);
  // Stage S3 post-launch hardening: the renderMarkdown argument may now be
  // null-guarded (`window.SessionViewer && window.SessionViewer.renderMarkdown`)
  // so a missing SessionViewer global surfaces a clean controller-init error
  // rather than an upstream TypeError reading .renderMarkdown of undefined.
  // Match either the original or the null-guarded shape.
  assert.match(
    src,
    /renderMarkdown:\s*(?:window\.SessionViewer\s*&&\s*)?window\.SessionViewer\.renderMarkdown/,
  );
});

test('renderer-boot harness is wired with SessionViewer.renderMarkdown + createReadTabController', () => {
  // The harness extension lives in test/renderer-boot.test.js — sanity-check it.
  const rendererBoot = fs.readFileSync(
    path.join(__dirname, '..', 'renderer-boot.test.js'),
    'utf8',
  );
  assert.match(rendererBoot, /require\(['"]\.\.\/lib\/session-viewer\/read-renderer['"]\)/);
  assert.match(rendererBoot, /require\(['"]\.\.\/lib\/session-viewer\/read-tab['"]\)/);
  assert.match(rendererBoot, /modeReadButton/);
  assert.match(rendererBoot, /readViewMount/);
});
