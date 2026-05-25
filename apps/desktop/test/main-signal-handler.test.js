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

test('main.js registers SIGINT handler routing to runCloseGuardForSource', () => {
  const src = readMain();
  assert.match(src, /process\.on\(\s*['"]SIGINT['"]\s*,/);
  assert.match(
    src,
    /process\.on\(\s*['"]SIGINT['"][\s\S]*?handleTerminationSignal\(['"]SIGINT['"]\)/,
  );
});

test('main.js also registers SIGTERM (for orchestrators / OS shutdown signals)', () => {
  const src = readMain();
  assert.match(src, /process\.on\(\s*['"]SIGTERM['"]\s*,/);
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

test('handleTerminationSignal logs a heads-up so the user knows what is happening', () => {
  const src = readMain();
  // Console.error is the conventional channel for signal-handler
  // diagnostics. Skipping the exact message text; just confirming
  // SOMETHING is logged for both the prompt-triggering signal and
  // the force-quit case.
  assert.match(
    src,
    /function\s+handleTerminationSignal[\s\S]*?console\.error[\s\S]*?running close-guard[\s\S]*?Ctrl\+C again to force-quit/,
  );
});
