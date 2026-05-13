/* Stage 16 — bundle parity safeguards.
   Run focused: node --test test/cm6-write-view/cm6-bundle-parity.test.js

   These are SAFEGUARD tests, not bug-fix tests. They pass on the current
   repository state because the bundle is in sync with the entry. The
   "would they catch a regression?" proof is a developer-machine one-off
   mutation sanity check (documented in Stage 16's manual QA).

   Scope, narrow on purpose:
     - Stage 16-3 (load-bearing) compares the inner identifier list of
       markdown({ ..., extensions: [...] }) between cm6-entry.js and the
       built cm6-bundle.js. If a contributor edits the entry but forgets
       `npm run build:cm6`, the two arrays diverge and the test fails.
     - We do NOT assert that every @lezer/markdown imported identifier
       appears in the bundle, because the bundle already contains
       Table / TaskList / Autolink / GFM from @lezer/markdown's own code.
       That naive presence check would not reliably catch a stale bundle.
     - Stage 16-2 instead asserts entry self-consistency: every configured
       extension identifier in the entry must also appear in the entry's
       `import { ... } from '@lezer/markdown'` statement. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

function readSource(rel) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'lib', rel),
    'utf8'
  );
}

// Regex shape mirrors cm6-entry-source.test.js:36–39. NOTE: this does NOT
// strip comments; any /* ... */ inside the brackets would corrupt the
// parsed list. Keep entries comment-free in both files.
function parseExtensionsArray(source) {
  const m = source.match(/markdown\s*\(\s*\{[^}]*extensions\s*:\s*\[([^\]]*)\]/s);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

// Regex shape mirrors cm6-entry-source.test.js:29–33.
function parseLezerMarkdownImports(source) {
  const m = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]@lezer\/markdown['"]/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
}

// ── Stage 16-1: bundle exists and exposes the CM6Production window namespace ─

test('Stage 16-1: cm6-bundle.js exists and exposes the CM6Production window namespace', () => {
  const bundle = readSource('cm6-bundle.js');
  assert.ok(bundle.length > 10_000,
    'cm6-bundle.js must be a non-trivially populated runtime artifact (got '
    + bundle.length + ' chars)');
  assert.ok(bundle.includes('CM6Production'),
    'cm6-bundle.js must expose the CM6Production window namespace marker');
});

// ── Stage 16-2: entry self-consistency ─────────────────────────────────────

test('Stage 16-2: cm6-entry.js is self-consistent — every configured extension is imported from @lezer/markdown', () => {
  const entry = readSource('cm6-entry.js');
  const configured = parseExtensionsArray(entry);
  const imported = parseLezerMarkdownImports(entry);
  assert.ok(configured !== null,
    'cm6-entry.js must call markdown({ ..., extensions: [...] })');
  for (const ext of configured) {
    assert.ok(imported.includes(ext),
      'configured extension ' + ext + ' must be imported from @lezer/markdown '
      + '(imports: [' + imported.join(', ') + '])');
  }
});

// ── Stage 16-3: extensions arrays match between cm6-entry.js and cm6-bundle.js
//     (load-bearing parity assertion)

test('Stage 16-3: extensions arrays match between cm6-entry.js and cm6-bundle.js', () => {
  const entry  = readSource('cm6-entry.js');
  const bundle = readSource('cm6-bundle.js');
  const entryExts  = parseExtensionsArray(entry);
  const bundleExts = parseExtensionsArray(bundle);
  assert.ok(entryExts !== null,  'cm6-entry.js  must contain markdown({ extensions: [...] })');
  assert.ok(bundleExts !== null, 'cm6-bundle.js must contain markdown({ extensions: [...] })');
  assert.deepEqual(bundleExts, entryExts,
    'cm6-bundle.js extensions [' + (bundleExts || []).join(', ') + '] '
    + 'must match cm6-entry.js extensions [' + (entryExts || []).join(', ') + ']. '
    + 'If they differ, the bundle is stale — run `npm run build:cm6` and '
    + 'commit the rebuild as a SEPARATE reviewed patch (not part of Stage 16).');
});

// ── Stage 16-4: bundle exposes SetextHeading1 / SetextHeading2 node names ──

test('Stage 16-4: cm6-bundle.js exposes SetextHeading1 / SetextHeading2 parser node names', () => {
  const bundle = readSource('cm6-bundle.js');
  assert.ok(bundle.includes('"SetextHeading1"'),
    'cm6-bundle.js must include the "SetextHeading1" parser Type entry (Stage 14.7 dependency)');
  assert.ok(bundle.includes('"SetextHeading2"'),
    'cm6-bundle.js must include the "SetextHeading2" parser Type entry (Stage 14.7 dependency)');
});

// ── Stage 16-5: bundle exposes a Strikethrough definition ──────────────────

test('Stage 16-5: cm6-bundle.js exposes a Strikethrough definition', () => {
  const bundle = readSource('cm6-bundle.js');
  assert.ok(/var\s+Strikethrough\s*=/.test(bundle),
    'cm6-bundle.js must contain a `var Strikethrough = ...` definition '
    + '(Stage 14.2 extension; pins that the most recent parser-config '
    + 'addition is actually present in the runtime artifact)');
});

// ── Stage 22.5 — bundle export augmentation ────────────────────────────────
// Three new exports surface CodeMirror APIs that Stage 23's task-toggle
// keyboard binding needs. cm6-bundle.js is an IIFE that writes to
// window.CM6Production; the window shim lets us inspect it under Node.

function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

test('Stage 22.5-1: cm6-bundle.js exports cm6.keymap.of as a function', () => {
  const cm6 = loadCm6Bundle();
  assert.equal(typeof cm6.keymap, 'object',
    'cm6.keymap must be present (the @codemirror/view keymap facet)');
  assert.equal(typeof cm6.keymap.of, 'function',
    'cm6.keymap.of must be a function — Stage 23 uses it to register the '
    + 'task-toggle keyboard binding via the standard CM6 keymap path');
});

test('Stage 22.5-2: cm6-bundle.js exports cm6.undo as a function', () => {
  const cm6 = loadCm6Bundle();
  assert.equal(typeof cm6.undo, 'function',
    'cm6.undo must be exported (from @codemirror/commands); enables '
    + 'programmatic undo invocation in future Stage 23+ tests');
});

test('Stage 22.5-3: cm6-bundle.js exports cm6.redo as a function', () => {
  const cm6 = loadCm6Bundle();
  assert.equal(typeof cm6.redo, 'function',
    'cm6.redo must be exported (from @codemirror/commands); enables '
    + 'programmatic redo invocation in future Stage 23+ tests');
});
