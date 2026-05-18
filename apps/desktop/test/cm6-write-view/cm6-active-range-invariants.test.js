/* Stage 26 — peer source-file invariants for cm6-active-range.js + CSS +
   script-tag source-level invariants on index.html.
   Run focused:
     node --test test/cm6-write-view/cm6-active-range-invariants.test.js

   Group E tests (26-17..26-20):
     26-17  cm6-active-range.js forbidden-token scan (Section H peer contract)
     26-18  module exports surface exactly {resolveTouchedLines,
            buildActiveRangeDecorations, createActiveRangeExtension}
     26-19  index.html CSS rule presence + verbatim parity with the existing
            .cm-activeLine .cm-md-syntax rule (I2 fix)
     26-20  index.html <script src="./lib/cm6-active-range.js"> presence +
            ordering between cm6-link-click.js and cm6-hybrid-view.js (F2 add)
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const ACTIVE_RANGE_PATH = path.join(__dirname, '..', '..', 'lib', 'cm6-active-range.js');
const INDEX_HTML_PATH   = path.join(__dirname, '..', '..', 'index.html');

// ── 26-17: forbidden-token scan ───────────────────────────────────────────

test('Stage 26-17: cm6-active-range.js source contains zero forbidden tokens', () => {
  const src = fs.readFileSync(ACTIVE_RANGE_PATH, 'utf8');

  // Section H + Stage 16-10 adapter-output set + walker event-handler exclusions.
  // The active-range module has NO event surface (no domEventHandlers, no
  // keymap.of, no addEventListener) — it is pure Decoration.line work.
  assert.ok(!src.includes('Decoration.replace'),  'no Decoration.replace');
  assert.ok(!src.includes('Decoration.widget'),   'no Decoration.widget');
  assert.ok(!src.includes('WidgetType'),          'no WidgetType');
  assert.ok(!src.includes('<a'),                  'no "<a" anywhere');
  assert.ok(!src.includes('href'),                'no "href" anywhere');
  assert.ok(!src.includes('<img'),                'no "<img"');
  assert.ok(!src.includes('<div'),                'no "<div"');
  assert.ok(!src.includes('addEventListener'),    'no raw addEventListener');
  assert.ok(!/onclick\s*[:=]/.test(src),          'no onclick property/handler');
  assert.ok(!src.includes('innerHTML'),           'no innerHTML');
  assert.ok(!src.includes('document.write'),      'no document.write');
  assert.ok(!src.includes('eval('),               'no eval(');
  assert.ok(!src.includes('domEventHandlers'),    'no domEventHandlers (no event surface)');
  assert.ok(!src.includes('keymap.of'),           'no keymap.of (no keyboard surface)');
});

// ── 26-18: module exports surface (I1: sorted vs sorted) ──────────────────

test('Stage 26-18: module exports exactly the three documented names', () => {
  delete require.cache[require.resolve('../../lib/cm6-active-range.js')];
  const mod = require('../../lib/cm6-active-range.js');
  const actualKeys = Object.keys(mod).sort();
  const expectedKeysSorted = [
    'buildActiveRangeDecorations',
    'createActiveRangeExtension',
    'resolveTouchedLines',
  ];
  assert.deepEqual(actualKeys, expectedKeysSorted,
    'exports must be exactly {resolveTouchedLines, buildActiveRangeDecorations, createActiveRangeExtension}');
});

// ── 26-19: CSS rule presence + verbatim parity (I2 fix) ───────────────────

// Normalize a CSS declaration body for verbatim comparison:
//   - strip CSS comments /* ... */
//   - collapse all whitespace runs to a single space
//   - trim leading/trailing whitespace and trailing semicolons
function normalizeDeclarationBody(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, '')   // strip CSS comments
    .replace(/\s+/g, ' ')               // collapse whitespace
    .trim()
    .replace(/;\s*$/, '');              // strip trailing semicolon
}

test('Stage 26-19: index.html — .cm-md-active-range .cm-md-syntax rule exists and has verbatim parity with .cm-activeLine .cm-md-syntax', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  // (a) Find ALL matches of the new rule's selector — exactly one.
  const newRuleRegex = /\.cm-md-active-range\s+\.cm-md-syntax\s*\{([^}]*)\}/g;
  const newMatches = Array.from(html.matchAll(newRuleRegex));
  assert.equal(newMatches.length, 1,
    'exactly one .cm-md-active-range .cm-md-syntax rule (catches missing rule AND accidental duplicates)');

  // (b) Find the existing reference rule — exactly one.
  const existingRuleRegex = /\.cm-activeLine\s+\.cm-md-syntax\s*\{([^}]*)\}/g;
  const existingMatches = Array.from(html.matchAll(existingRuleRegex));
  assert.equal(existingMatches.length, 1,
    'exactly one .cm-activeLine .cm-md-syntax rule (catches accidental edits to the existing rule)');

  // (c) Normalize both declaration bodies. Assert verbatim equality — no
  // extra declarations allowed in the new rule.
  const newBodyNormalized = normalizeDeclarationBody(newMatches[0][1]);
  const existingBodyNormalized = normalizeDeclarationBody(existingMatches[0][1]);
  assert.equal(newBodyNormalized, existingBodyNormalized,
    'the new rule\'s declarations must equal the existing .cm-activeLine .cm-md-syntax declarations verbatim');

  // (d) Sanity: the normalized body must contain the three expected
  // declarations. Catches a regression where both rules drift in parallel.
  assert.ok(/display:\s*inline/.test(newBodyNormalized),  'declaration: display: inline');
  assert.ok(/color:\s*var\(--text-muted\)/.test(newBodyNormalized), 'declaration: color: var(--text-muted)');
  assert.ok(/opacity:\s*0\.5/.test(newBodyNormalized),    'declaration: opacity: 0.5');
});

// ── 26-20: <script src> presence + ordering invariant (F2 add) ────────────

test('Stage 26-20: index.html loads cm6-active-range.js between cm6-link-click.js and cm6-hybrid-view.js', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  // (a) Exactly one <script src="./lib/cm6-active-range.js"> tag.
  const tagRegex = /<script\s+src=["']\.\/lib\/cm6-active-range\.js["']\s*><\/script>/g;
  const tagMatches = Array.from(html.matchAll(tagRegex));
  assert.equal(tagMatches.length, 1,
    'exactly one <script src="./lib/cm6-active-range.js"> tag in index.html');

  const activeRangeOffset = tagMatches[0].index;

  // (b) Find the cm6-link-click.js and cm6-hybrid-view.js tag offsets.
  const linkClickIdx  = html.indexOf('./lib/cm6-link-click.js');
  const hybridViewIdx = html.indexOf('./lib/cm6-hybrid-view.js');
  assert.notEqual(linkClickIdx,  -1, 'cm6-link-click.js script tag must exist');
  assert.notEqual(hybridViewIdx, -1, 'cm6-hybrid-view.js script tag must exist');

  // (c) Ordering: linkClick < activeRange < hybridView.
  assert.ok(linkClickIdx < activeRangeOffset,
    'cm6-active-range.js must load AFTER cm6-link-click.js (got linkClickIdx=' + linkClickIdx +
    ', activeRangeOffset=' + activeRangeOffset + ')');
  assert.ok(activeRangeOffset < hybridViewIdx,
    'cm6-active-range.js must load BEFORE cm6-hybrid-view.js (got activeRangeOffset=' + activeRangeOffset +
    ', hybridViewIdx=' + hybridViewIdx + ')');
});
