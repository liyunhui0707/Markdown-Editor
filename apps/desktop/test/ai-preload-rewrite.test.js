/* CA3 — preload.js source-shape for window.ai.rewriteText
   Run focused: cd apps/desktop && node --test test/ai-preload-rewrite.test.js

   Mirrors v0.2.0 test/ai-preload.test.js (T8) shape — regex over preload
   source; no Electron required. Stage A keeps direct-routing for both verbs
   (no callAiAction indirection — that's a Stage B concept).
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
const SRC = () => fs.readFileSync(PRELOAD_PATH, 'utf8');

test('CA3.1 rewriteText key on window.ai surface', () => {
  assert.match(SRC(), /rewriteText\s*:/);
});

test('CA3.2 rewriteText routes to ipcRenderer.invoke("ai:rewrite-text", { text })', () => {
  const src = SRC();
  assert.match(
    src,
    /rewriteText\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]ai:rewrite-text['"]\s*,\s*\{?\s*text/,
  );
});

test('CA3.3 negative regex: no new exposeInMainWorld namespace beyond existing vaultApi + ai', () => {
  const src = SRC();
  const exposes = src.match(/exposeInMainWorld\(\s*['"][A-Za-z_]+['"]/g) || [];
  // Should be exactly 2: 'vaultApi' (v0.2.0) and 'ai' (Path D).
  assert.equal(exposes.length, 2);
});

test('CA3.4 negative regex: Stage A keeps direct invoke (no callAiAction helper, no chunkChannel)', () => {
  const src = SRC();
  assert.doesNotMatch(src, /callAiAction\b/);
  assert.doesNotMatch(src, /chunkChannel\b/);
});

test('CA3.5 negative regex: preload does NOT expose raw ipcRenderer or "electron"', () => {
  const src = SRC();
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]ipcRenderer['"]/);
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]electron['"]/);
});
