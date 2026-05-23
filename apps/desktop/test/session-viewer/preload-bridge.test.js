/* Stage S2 — preload bridge for sessionViewer:import.
   Run focused: node --test test/session-viewer/preload-bridge.test.js
   Test T-S2-11. Source-shape: asserts preload.js exposes refreshSessions
   and routes it to ipcRenderer.invoke('sessionViewer:import', {vaultPath}).
   Mirrors test/open-external-link.test.js Group C.
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', '..', 'preload.js');

function readPreload() {
  return fs.readFileSync(PRELOAD_PATH, 'utf8');
}

test('S2-11: preload exposes refreshSessions on vaultApi', () => {
  const src = readPreload();
  assert.match(src, /refreshSessions\s*:/);
});

test('S2-11: refreshSessions invokes the sessionViewer:import channel', () => {
  const src = readPreload();
  assert.match(
    src,
    /refreshSessions\s*:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]sessionViewer:import['"]/,
  );
});

test('S2-11: refreshSessions payload is a {vaultPath} object', () => {
  const src = readPreload();
  // Accept either `refreshSessions: (vaultPath) => ipcRenderer.invoke('…', { vaultPath })`
  // or `refreshSessions: (payload) => ipcRenderer.invoke('…', payload)`.
  const flexible = /refreshSessions\s*:\s*\(\s*(\w+)\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]sessionViewer:import['"]\s*,\s*([^)]+)\)/;
  const m = src.match(flexible);
  assert.ok(m, 'pattern must match');
  const argName = m[1];
  const passed = m[2].trim();
  const ok =
    passed === argName ||                              // forward payload directly
    passed === `{ ${argName} }` ||                     // wrap as {vaultPath}
    passed === `{${argName}}` ||
    passed === `{ vaultPath: ${argName} }` ||
    passed === `{vaultPath: ${argName}}`;
  assert.ok(ok, `payload arg "${passed}" not in accepted shapes`);
});
