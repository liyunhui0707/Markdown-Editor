/* TDD: Stage 14.2 — bundle-entry source-wiring contract for Strikethrough.
   Run: node --test test/cm6-write-view/cm6-entry-source.test.js

   The Strikethrough markdown extension is wired in lib/cm6-entry.js, which
   is the source of cm6-bundle.js (the production IIFE). Because the bundle
   is a generated artifact, we pin the wiring at the source level:

     - Positive: Strikethrough is imported from @lezer/markdown and
       registered inside the markdown({...}) extensions array.
     - Negative (scoped): the @lezer/markdown import and the markdown
       extensions array literal must NOT pull in GFM, Table, TaskList,
       or Autolink — Stage 14.2 is "Strikethrough only" by design.

   Negative checks deliberately inspect ONLY the import specifier and the
   inner extensions array — not the whole file — to avoid false failures
   from incidental occurrences in comments or string literals. */
'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'cm6-entry.js'),
  'utf8'
);

// Capture the names inside `import { ... } from '@lezer/markdown'`.
function lezerMarkdownImport() {
  const m = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]@lezer\/markdown['"]/);
  return m ? m[1] : '';
}

// Capture the inner extensions array of the markdown({...}) call.
function markdownExtensionsArray() {
  const m = src.match(/markdown\s*\(\s*\{[^}]*extensions\s*:\s*\[([^\]]*)\]/s);
  return m ? m[1] : '';
}

// ── Positive: Strikethrough must be wired ──────────────────────────────────

test('Stage 14.2: cm6-entry imports Strikethrough from @lezer/markdown', () => {
  const imp = lezerMarkdownImport();
  assert.ok(imp, 'cm6-entry must import from @lezer/markdown');
  assert.match(imp, /\bStrikethrough\b/,
    '@lezer/markdown import must include Strikethrough');
});

test('Stage 14.2: cm6-entry registers Strikethrough in markdown extensions array', () => {
  const ext = markdownExtensionsArray();
  assert.ok(ext, 'cm6-entry must call markdown({ ..., extensions: [...] })');
  assert.match(ext, /\bStrikethrough\b/,
    'markdown extensions array must include Strikethrough');
});

// ── Negative (scoped): Strikethrough only — no GFM widening ────────────────

test('Stage 14.2: cm6-entry @lezer/markdown import does NOT include GFM/Table/TaskList/Autolink', () => {
  const imp = lezerMarkdownImport();
  for (const sym of ['GFM', 'Table', 'TaskList', 'Autolink']) {
    assert.doesNotMatch(imp, new RegExp(`\\b${sym}\\b`),
      `@lezer/markdown import must not include ${sym}`);
  }
});

test('Stage 14.2: cm6-entry markdown extensions array does NOT register GFM/Table/TaskList/Autolink', () => {
  const ext = markdownExtensionsArray();
  for (const sym of ['GFM', 'Table', 'TaskList', 'Autolink']) {
    assert.doesNotMatch(ext, new RegExp(`\\b${sym}\\b`),
      `markdown extensions array must not register ${sym}`);
  }
});
