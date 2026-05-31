/* Stage A WAVE 12 — index.html renderer-wiring source contract.
   Run focused:
     node --test test/cm6-write-view/cm6-lp-renderer-source.test.js

   These tests inspect apps/desktop/index.html as text to pin:
     - The lp-emphasis + lp-view script tags are loaded with the ./lib/
       convention (matches the existing tags).
     - The script-tag order places lp modules AFTER cm6-hybrid-view.js
       AND cm6-line-utils.js (the lp adapter depends on both).
     - The engine-dispatch chain in the renderer-init script handles
       'hybrid-cm6-lp' by calling window.Cm6LpView.createCm6LpView.
     - The engine-label string covers 'hybrid-cm6-lp'.

   Pattern mirrors cm6-entry-source.test.js — source-text scan, not a
   real boot harness. Boot-level integration is deferred to manual QA
   (no jsdom available; would require a new dependency forbidden by
   Hard Rule 4). */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const html      = fs.readFileSync(HTML_PATH, 'utf8');

// ── Script tag presence ──────────────────────────────────────────────────

test('Stage A WAVE 12-S1: index.html loads ./lib/cm6-lp-inline.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/cm6-lp-inline\.js["']/,
    'index.html must include <script src="./lib/cm6-lp-inline.js">');
});

test('Stage A WAVE 12-S2: index.html loads ./lib/cm6-lp-view.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/cm6-lp-view\.js["']/,
    'index.html must include <script src="./lib/cm6-lp-view.js">');
});

// ── Script tag ordering ──────────────────────────────────────────────────

function tagOffset(tagSubstring) {
  return html.indexOf(tagSubstring);
}

test('Stage A WAVE 12-S3: cm6-lp-inline.js loads AFTER cm6-line-utils.js (delegation dep)', () => {
  const lineUtils = tagOffset('./lib/cm6-line-utils.js');
  const lpEmph    = tagOffset('./lib/cm6-lp-inline.js');
  assert.ok(lineUtils >= 0, 'cm6-line-utils.js script tag must be present');
  assert.ok(lpEmph    >= 0, 'cm6-lp-inline.js script tag must be present');
  assert.ok(lineUtils < lpEmph,
    'cm6-lp-inline.js must load AFTER cm6-line-utils.js (lp-emphasis reads Cm6LineUtils.resolveTouchedLines)');
});

test('Stage A WAVE 12-S4: cm6-lp-view.js loads AFTER cm6-hybrid-view.js (walker-reuse dep)', () => {
  const hybrid = tagOffset('./lib/cm6-hybrid-view.js');
  const lpView = tagOffset('./lib/cm6-lp-view.js');
  assert.ok(hybrid  >= 0, 'cm6-hybrid-view.js script tag must be present');
  assert.ok(lpView  >= 0, 'cm6-lp-view.js script tag must be present');
  assert.ok(hybrid < lpView,
    'cm6-lp-view.js must load AFTER cm6-hybrid-view.js (lp adapter reads Cm6HybridView.buildHeadingDecorations)');
});

test('Stage A WAVE 12-S5: cm6-lp-view.js loads AFTER cm6-lp-inline.js', () => {
  const lpEmph = tagOffset('./lib/cm6-lp-inline.js');
  const lpView = tagOffset('./lib/cm6-lp-view.js');
  assert.ok(lpEmph < lpView,
    'cm6-lp-view.js must load AFTER cm6-lp-inline.js (adapter reads Cm6LpInline.createLpInlineExtension)');
});

// ── Engine dispatch chain ────────────────────────────────────────────────

test('Stage A WAVE 12-S6: dispatch chain includes a hybrid-cm6-lp case', () => {
  assert.match(html, /selectedWriteEngine\s*===\s*['"]hybrid-cm6-lp['"]/,
    'renderer dispatch chain must check selectedWriteEngine === "hybrid-cm6-lp"');
});

test('Stage A WAVE 12-S7: dispatch chain instantiates Cm6LpView for hybrid-cm6-lp', () => {
  assert.match(html, /window\.Cm6LpView\.createCm6LpView\s*\(/,
    'renderer must call window.Cm6LpView.createCm6LpView for the lp engine');
});

// ── Engine label ─────────────────────────────────────────────────────────

test('Stage A WAVE 12-S8: engine label string includes a "CM6 Hybrid LP" entry', () => {
  assert.match(html, /selectedWriteEngine\s*===\s*['"]hybrid-cm6-lp['"]\s*\?\s*['"]CM6 Hybrid LP['"]/,
    'engine-label expression must map hybrid-cm6-lp to a recognizable string');
});

// ── Negative guards ──────────────────────────────────────────────────────

test('Stage A WAVE 12-S9: default engine is still hybrid-cm6 (not lp; opt-in only)', () => {
  // The default lives in lib/write-engine.js — verify here defensively that
  // index.html does not silently override it. Look for any explicit override
  // to lp in the renderer-init scope.
  const overridePattern = /WriteEngine\.resolveWriteEngine\([^)]*storage\s*:\s*\{[^}]*['"]hybrid-cm6-lp['"]/;
  assert.doesNotMatch(html, overridePattern,
    'renderer must NOT inject hybrid-cm6-lp as a synthetic storage default');
});

test('Stage A WAVE 12-S10: lp-view script tag is not duplicated', () => {
  const matches = html.match(/<script\s+src=["']\.\/lib\/cm6-lp-view\.js["']/g) || [];
  assert.equal(matches.length, 1,
    'cm6-lp-view.js must be loaded exactly once');
});

// ── Stage C WAVE 8 — image-widget script tag + renderer wiring ─────────

test('Stage C WAVE 8-T-RW-1: index.html loads ./lib/cm6-lp-image-widget.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/cm6-lp-image-widget\.js["']/,
    'index.html must include <script src="./lib/cm6-lp-image-widget.js">');
});

test('Stage C WAVE 8-T-RW-2: cm6-lp-image-widget.js loads BEFORE cm6-lp-inline.js (script-tag order)', () => {
  const imgWidget = tagOffset('./lib/cm6-lp-image-widget.js');
  const lpInline  = tagOffset('./lib/cm6-lp-inline.js');
  assert.ok(imgWidget >= 0, 'cm6-lp-image-widget.js script tag must be present');
  assert.ok(imgWidget < lpInline,
    'cm6-lp-image-widget.js must load BEFORE cm6-lp-inline.js (lp-inline reads window.Cm6LpImageWidget)');
});

test('Stage C WAVE 8-T-RW-3: lp dispatch case passes getNoteDir callback', () => {
  // Look for the getNoteDir field in the lp dispatch case.
  assert.match(html, /selectedWriteEngine\s*===\s*['"]hybrid-cm6-lp['"][\s\S]{0,4000}getNoteDir\s*:/,
    'lp dispatch case must pass a getNoteDir callback');
});

test('Stage C WAVE 8-T-RW-4: lp dispatch case passes resolveImagePath callback', () => {
  assert.match(html, /selectedWriteEngine\s*===\s*['"]hybrid-cm6-lp['"][\s\S]{0,4000}resolveImagePath\s*:/,
    'lp dispatch case must pass a resolveImagePath callback');
});

test('Stage C WAVE 8-T-RW-5: lp dispatch case uses window.vaultApi.resolveImagePath', () => {
  assert.match(html, /window\.vaultApi\.resolveImagePath/,
    'lp dispatch case must call window.vaultApi.resolveImagePath for vault-relative resolution');
});

// ── Stage D WAVE 7 — lp-block script tag + ordering ─────────────────────

test('Stage D WAVE 7-T-RWB-1: index.html loads ./lib/cm6-lp-block.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/cm6-lp-block\.js["']/,
    'index.html must include <script src="./lib/cm6-lp-block.js">');
});

test('Stage D WAVE 7-T-RWB-2: cm6-lp-block.js loads AFTER cm6-lp-inline.js (shared widget dep)', () => {
  const lpInline = tagOffset('./lib/cm6-lp-inline.js');
  const lpBlock  = tagOffset('./lib/cm6-lp-block.js');
  assert.ok(lpInline >= 0, 'cm6-lp-inline.js script tag must be present');
  assert.ok(lpBlock  >= 0, 'cm6-lp-block.js script tag must be present');
  assert.ok(lpInline < lpBlock,
    'cm6-lp-block.js must load AFTER cm6-lp-inline.js (reuses shared empty-widget instance)');
});

test('Stage D WAVE 7-T-RWB-3: cm6-lp-block.js loads BEFORE cm6-lp-view.js (composition dep)', () => {
  const lpBlock = tagOffset('./lib/cm6-lp-block.js');
  const lpView  = tagOffset('./lib/cm6-lp-view.js');
  assert.ok(lpBlock < lpView,
    'cm6-lp-block.js must load BEFORE cm6-lp-view.js (adapter composes block plugin)');
});

test('Stage D WAVE 7-T-RWB-4: lp-block script tag is not duplicated', () => {
  const matches = html.match(/<script\s+src=["']\.\/lib\/cm6-lp-block\.js["']/g) || [];
  assert.equal(matches.length, 1,
    'cm6-lp-block.js must be loaded exactly once');
});

// ── Stage E WAVE 6 — lp table-widget script tag + ordering ──────────────

test('Stage E WAVE 6-T-RWT-1: index.html loads ./lib/cm6-lp-table-widget.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/cm6-lp-table-widget\.js["']/,
    'index.html must include <script src="./lib/cm6-lp-table-widget.js">');
});

test('Stage E WAVE 6-T-RWT-2: cm6-lp-table-widget.js loads BEFORE cm6-lp-block.js (widget dep)', () => {
  const lpTable = tagOffset('./lib/cm6-lp-table-widget.js');
  const lpBlock = tagOffset('./lib/cm6-lp-block.js');
  assert.ok(lpTable >= 0, 'cm6-lp-table-widget.js script tag must be present');
  assert.ok(lpTable < lpBlock,
    'cm6-lp-table-widget.js must load BEFORE cm6-lp-block.js (block plugin reads window.Cm6LpTableWidget)');
});

test('Stage E WAVE 6-T-RWT-3: cm6-lp-table-widget.js script tag is not duplicated', () => {
  const matches = html.match(/<script\s+src=["']\.\/lib\/cm6-lp-table-widget\.js["']/g) || [];
  assert.equal(matches.length, 1,
    'cm6-lp-table-widget.js must be loaded exactly once');
});

// ── Stage F WAVE 6 — KaTeX JS + CSS + math modules ──────────────────────

test('Stage F WAVE 6-T-RWM-1: index.html loads ./lib/vendor/katex/katex.min.css', () => {
  assert.match(html, /<link\s+rel=["']stylesheet["']\s+href=["']\.\/lib\/vendor\/katex\/katex\.min\.css["']/,
    'index.html must include the KaTeX stylesheet link');
});

test('Stage F WAVE 6-T-RWM-2: index.html loads ./lib/vendor/katex/katex.min.js', () => {
  assert.match(html, /<script\s+src=["']\.\/lib\/vendor\/katex\/katex\.min\.js["']/,
    'index.html must include the KaTeX JS bundle script tag');
});

test('Stage F WAVE 6-T-RWM-3: KaTeX JS loads BEFORE cm6-lp-math-widget.js (window.katex dep)', () => {
  const katex   = tagOffset('./lib/vendor/katex/katex.min.js');
  const mathWid = tagOffset('./lib/cm6-lp-math-widget.js');
  assert.ok(katex   >= 0, 'KaTeX JS tag present');
  assert.ok(mathWid >= 0, 'math widget tag present');
  assert.ok(katex < mathWid,
    'KaTeX must load BEFORE cm6-lp-math-widget.js (widget reads window.katex)');
});

test('Stage F WAVE 6-T-RWM-4: cm6-lp-math-detect.js loads BEFORE cm6-lp-inline.js + cm6-lp-block.js', () => {
  const detect = tagOffset('./lib/cm6-lp-math-detect.js');
  const inline = tagOffset('./lib/cm6-lp-inline.js');
  const block  = tagOffset('./lib/cm6-lp-block.js');
  assert.ok(detect >= 0, 'math detect tag present');
  assert.ok(detect < inline, 'math detect must load BEFORE lp-inline');
  assert.ok(detect < block,  'math detect must load BEFORE lp-block');
});

test('Stage F WAVE 6-T-RWM-5: cm6-lp-math-widget.js loads BEFORE cm6-lp-inline.js + cm6-lp-block.js', () => {
  const widget = tagOffset('./lib/cm6-lp-math-widget.js');
  const inline = tagOffset('./lib/cm6-lp-inline.js');
  const block  = tagOffset('./lib/cm6-lp-block.js');
  assert.ok(widget >= 0, 'math widget tag present');
  assert.ok(widget < inline, 'math widget must load BEFORE lp-inline');
  assert.ok(widget < block,  'math widget must load BEFORE lp-block');
});

test('Stage F WAVE 6-T-RWM-6: KaTeX CSS + JS + math modules each appear exactly once', () => {
  const css     = html.match(/<link\s+rel=["']stylesheet["']\s+href=["']\.\/lib\/vendor\/katex\/katex\.min\.css["']/g) || [];
  const js      = html.match(/<script\s+src=["']\.\/lib\/vendor\/katex\/katex\.min\.js["']/g) || [];
  const detect  = html.match(/<script\s+src=["']\.\/lib\/cm6-lp-math-detect\.js["']/g) || [];
  const widget  = html.match(/<script\s+src=["']\.\/lib\/cm6-lp-math-widget\.js["']/g) || [];
  assert.equal(css.length, 1,    'KaTeX CSS link must appear exactly once');
  assert.equal(js.length, 1,     'KaTeX JS script must appear exactly once');
  assert.equal(detect.length, 1, 'math detect script must appear exactly once');
  assert.equal(widget.length, 1, 'math widget script must appear exactly once');
});
