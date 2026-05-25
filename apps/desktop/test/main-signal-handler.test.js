/* Stage 6.3C — main.js terminal-signal handlers route through the
   close-guard. Without these, Ctrl+C in the terminal running the
   dev server bypasses the dirty-summary dialog and silently
   discards unsaved work.
   Run focused: node --test test/main-signal-handler.test.js
*/

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MAIN_PATH = path.join(__dirname, '..', 'main.js');
function readMain() { return fs.readFileSync(MAIN_PATH, 'utf8'); }

test('main.js registers SIGINT/SIGTERM/SIGHUP via prependListener (runs before Electron internal handlers)', () => {
  const src = readMain();
  assert.match(
    src,
    /TERMINATION_SIGNALS\s*=\s*\[\s*['"]SIGINT['"]\s*,\s*['"]SIGTERM['"]\s*,\s*['"]SIGHUP['"]\s*\]/,
  );
  assert.match(
    src,
    /TERMINATION_SIGNALS\.forEach\([\s\S]*?process\.prependListener\(sig,\s*\(\)\s*=>\s*handleTerminationSignal\(sig\)\)/,
  );
});

test('main.js registers the signal handlers BEFORE require(electron) so Electron internal handlers cannot pre-empt', () => {
  const src = readMain();
  const idxRegistration = src.indexOf('process.prependListener(sig');
  // Use the `const { app, ... } = require('electron')` destructure as
  // the anchor; the comment that names `require('electron')` higher up
  // would otherwise be matched first.
  const idxElectronRequire = src.indexOf(
    `const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')`,
  );
  assert.ok(idxRegistration > 0, 'registration call exists');
  assert.ok(idxElectronRequire > 0, 'electron destructure require exists');
  assert.ok(
    idxRegistration < idxElectronRequire,
    'signal handlers must register BEFORE electron is required',
  );
});

test('handleTerminationSignal invokes runCloseGuardForSource with `before-quit`', () => {
  const src = readMain();
  assert.match(
    src,
    /function\s+handleTerminationSignal[\s\S]*?runCloseGuardForSource\(\s*['"]before-quit['"]\s*\)/,
  );
});

test('handleTerminationSignal has a double-tap force-quit escape hatch (within 2s)', () => {
  const src = readMain();
  // Within 2000 ms of a prior signal → process.exit(130).
  assert.match(
    src,
    /function\s+handleTerminationSignal[\s\S]*?now\s*-\s*lastTerminationSignalAt\s*<\s*2000[\s\S]*?process\.exit\(\s*130\s*\)/,
  );
});

test('handleTerminationSignal logs via process.stderr.write (synchronous, unbuffered)', () => {
  const src = readMain();
  // Switched from console.error to process.stderr.write because the
  // user reported "no output" — synchronous stderr is more reliable
  // when Electron may be shutting down concurrently.
  assert.match(
    src,
    /function\s+handleTerminationSignal[\s\S]*?process\.stderr\.write[\s\S]*?running close-guard/,
  );
});

test('main.js writes a load-time stderr log confirming handlers are registered', () => {
  const src = readMain();
  // A diagnostic so the user can verify in the dev-server log that
  // main.js actually reached the registration step.
  assert.match(
    src,
    /process\.stderr\.write\([\s\S]*?registering termination signal handlers/,
  );
});
