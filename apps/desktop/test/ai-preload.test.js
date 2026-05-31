/* T8 — preload.js source-shape for window.ai (mandatory; covers A7).
   Run focused: cd apps/desktop && node --test test/ai-preload.test.js

   Mirrors test/session-viewer/preload-bridge.test.js — regex over the
   preload.js source string, no Electron required.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const SRC = () => fs.readFileSync(PRELOAD_PATH, 'utf8');

test('T8.1 preload exposes the "ai" surface', () => {
  assert.match(SRC(), /exposeInMainWorld\(\s*['"]ai['"]/);
});

test('T8.2 summarizeNote routes to ipcRenderer.invoke("ai:summarize-note", { text })', () => {
  const src = SRC();
  assert.match(
    src,
    /summarizeNote\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]ai:summarize-note['"]\s*,\s*\{?\s*text/,
  );
});

test('T8.3 only summarizeNote is exposed on the ai surface (no extra keys)', () => {
  const src = SRC();
  // Capture the ai block: matches `exposeInMainWorld('ai', { … })`.
  const re = /exposeInMainWorld\(\s*['"]ai['"]\s*,\s*(\{[\s\S]*?\})\s*\)\s*;/m;
  const m = src.match(re);
  assert.ok(m, 'ai block must be present');
  // Strip single- and double-quoted strings so identifier:value patterns
  // inside string literals (e.g. 'ai:summarize-note') don't false-positive.
  const stripped = m[1]
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const keys = stripped.match(/\b[A-Za-z_][A-Za-z_0-9]*\s*:/g) || [];
  assert.equal(keys.length, 1, 'expected exactly one key on window.ai, got ' + keys.length);
  assert.ok(/summarizeNote\s*:/.test(keys[0]));
});

test('T8.4 preload does NOT expose raw ipcRenderer or "electron" surface', () => {
  const src = SRC();
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]ipcRenderer['"]/);
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]electron['"]/);
});
