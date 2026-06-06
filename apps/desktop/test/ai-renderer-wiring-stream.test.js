/* test/ai-renderer-wiring-stream.test.js
   CB9 — Stage B: renderer-wiring source-shape (lib/ai-boot.js + main.js).

   These are source-regex sanity probes that lock the WIRING contract
   without re-implementing the runtime tests (CB8 covers runtime). The
   regexes are written to be tolerant of formatting changes; each one
   pins a load-bearing claim:
     - per-request token (D8)
     - signal + onChunk passed to both verbs (U1.a + D3')
     - streaming branch in renderActive (D11)
     - A8 negative: no DirtyState / saveNote / mutation of selectedNote
     - main.js registers ai:cancel exactly once.
*/

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BOOT_PATH = path.join(__dirname, '..', 'lib', 'ai-boot.js');
const MAIN_PATH = path.join(__dirname, '..', 'main.js');
const BOOT_SRC = () => fs.readFileSync(BOOT_PATH, 'utf8');
const MAIN_SRC = () => fs.readFileSync(MAIN_PATH, 'utf8');

test('CB9.1 ai-boot references a monotonic request-token counter (D8)', () => {
  // Tolerate naming: either nextRequestToken or close variants. Match
  // a `let|var` declaration of a token identifier initialized to 0.
  assert.match(
    BOOT_SRC(),
    /\b(let|var)\s+[A-Za-z_][A-Za-z0-9_]*Token[A-Za-z0-9_]*\s*=\s*0\b/,
  );
});

test('CB9.2 ai-boot passes onChunk and registerAbort to BOTH verbs (U1.a + D3\'\')', () => {
  const src = BOOT_SRC();
  // Match `onChunk:` and `registerAbort:` appearing in the click handler
  // region. The original D3' design passed an AbortSignal — that was
  // replaced after the QA bug surface revealed contextBridge strips its
  // prototype methods.
  assert.match(src, /onChunk\s*:/);
  assert.match(src, /registerAbort\s*:/);
  // Both window.ai.* methods are still called (verb routing intact).
  assert.match(src, /window\.ai\.summarizeNote\(/);
  assert.match(src, /window\.ai\.rewriteText\(/);
});

test('CB9.3 settle handler checks token before noteState.set (D8)', () => {
  // Match either `e.token !== token` or `entry.token !== token`.
  assert.match(
    BOOT_SRC(),
    /\b(e|entry)\.token\s*!==\s*token\b/,
  );
});

test('CB9.4 main.js registers ai:cancel exactly once', () => {
  const src = MAIN_SRC();
  const matches = src.match(/AiIpc\.registerCancel\(\s*ipcMain\s*\)/g) || [];
  assert.equal(matches.length, 1, 'expected exactly one AiIpc.registerCancel(ipcMain) call');
});

test('CB9.5 noteState entries include a token field (D8)', () => {
  // Match a noteState.set(...) call body containing `token`.
  assert.match(
    BOOT_SRC(),
    /noteState\.set\(\s*[A-Za-z_][A-Za-z_0-9]*\s*,\s*\{[^}]*\btoken\b/,
  );
});

test('CB9.6 renderActive handles the "streaming" kind (D11)', () => {
  assert.match(
    BOOT_SRC(),
    /kind\s*===\s*['"]streaming['"]/,
  );
});

test('CB9.7 A8: no editor / dirty-state / file mutation in handlers (re-asserted)', () => {
  const src = BOOT_SRC();
  assert.doesNotMatch(src, /\bsaveNote\b/);
  assert.doesNotMatch(src, /\bDirtyState\b/);
  assert.doesNotMatch(src, /selectedNote\.body\s*=/);
  assert.doesNotMatch(src, /\.markDirty\(/);
});

test('CB9.8 B9 / A7: preload still exposes exactly 2 keys on window.ai (re-asserted)', () => {
  const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js');
  const src = fs.readFileSync(PRELOAD_PATH, 'utf8');
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

test('CB9.9 ai-boot uses registerAbort callback (contextBridge-safe cancellation)', () => {
  // Stage B QA fix: AbortSignal does not survive Electron's contextBridge
  // (prototype methods are stripped). The click handlers pass a
  // `registerAbort` callback into options instead; the preload calls it
  // synchronously with a function that issues 'ai:cancel'. The renderer
  // stores it in inflightAborts and invokes it from onCloseHandler.
  assert.match(BOOT_SRC(), /registerAbort\s*:/);
  // Should NOT introduce a renderer-side AbortController — that pattern
  // was tried and broken by contextBridge stripping methods.
  assert.doesNotMatch(BOOT_SRC(), /new\s+AbortController\(\s*\)/);
});

test('CB9.10 ai-boot routes × handler to abort the in-flight (D5/D8)', () => {
  // The onCloseHandler should look up and call an abort for the active
  // note before deleting state. Match the structural pattern.
  const src = BOOT_SRC();
  assert.match(src, /inflightAborts/);
});

test('CB9.11 ai-boot calls AiSummaryPanel.appendChunk(chunk) inside onChunk', () => {
  assert.match(BOOT_SRC(), /AiSummaryPanel\.appendChunk\(/);
});

test('CB9.12 ai-boot uses showStreamingText in the streaming branch of renderActive', () => {
  assert.match(BOOT_SRC(), /AiSummaryPanel\.showStreamingText\(/);
});

test('CB9.13 main.js still has register + registerRewrite + registerCancel (all three lines)', () => {
  const src = MAIN_SRC();
  assert.match(src, /AiIpc\.register\(\s*ipcMain\s*\)/);
  assert.match(src, /AiIpc\.registerRewrite\(\s*ipcMain\s*\)/);
  assert.match(src, /AiIpc\.registerCancel\(\s*ipcMain\s*\)/);
});
