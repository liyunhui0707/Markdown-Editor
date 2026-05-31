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

test('T8.3 [Stage A Option α-2] exactly the documented keys are exposed on window.ai', () => {
  // Stage A added rewriteText next to summarizeNote. Key count is now 2.
  // Any additional key beyond these two would indicate scope creep on the
  // A7 surface and must be intentional.
  const src = SRC();
  const re = /exposeInMainWorld\(\s*['"]ai['"]\s*,\s*(\{[\s\S]*?\})\s*\)\s*;/m;
  const m = src.match(re);
  assert.ok(m, 'ai block must be present');
  const stripped = m[1]
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const keys = (stripped.match(/\b[A-Za-z_][A-Za-z_0-9]*\s*:/g) || [])
    .map((k) => k.match(/[A-Za-z_][A-Za-z_0-9]*/)[0])
    .sort();
  assert.deepEqual(keys, ['rewriteText', 'summarizeNote']);
});

test('T8.4 preload does NOT expose raw ipcRenderer or "electron" surface', () => {
  const src = SRC();
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]ipcRenderer['"]/);
  assert.doesNotMatch(src, /exposeInMainWorld\(\s*['"]electron['"]/);
});
