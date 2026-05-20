/* Stage 29 Part D — cm6-line-utils.js shared-helper tests + invariants.
   Run focused:
     node --test test/cm6-write-view/cm6-line-utils.test.js

   Tests (9):
     29-6   require('./cm6-line-utils.js') exports + globalThis setup
     29-7   resolveTouchedLines behavior smoke
     29-8   cm6-active-range.js delegates to globalThis.Cm6LineUtils
     29-9   cm6-construct-reveal.js delegates similarly
     29-10  output-parity regression across consumer modules
     29-11  index.html script-tag presence + ordering
     29-12  peer-contract forbidden-token scan on cm6-line-utils.js
     29-13  index.html CSS rule .cm-md-setext-active .cm-md-heading-mark (rev-4 scoped)
     29-14  index.html Stage-14.7 .cm-activeLine .cm-md-heading-mark unchanged

   Tests use lazy require() inside each test body so a missing module
   surfaces as a per-test failure, not a load-time crash.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const LINE_UTILS_REL  = '../../lib/cm6-line-utils.js';
const ACTIVE_RANGE_REL = '../../lib/cm6-active-range.js';
const CONSTRUCT_REL    = '../../lib/cm6-construct-reveal.js';
const INDEX_HTML_PATH  = path.join(__dirname, '..', '..', 'index.html');
const LINE_UTILS_PATH  = path.join(__dirname, '..', '..', 'lib', 'cm6-line-utils.js');

// ── fakeDoc with precomputed line metadata (mirrors Stages 26/28) ──

function makeFakeDoc(text) {
  const str = String(text);
  const lines = [];
  let from = 0;
  for (let i = 0; i <= str.length; i++) {
    if (i === str.length || str.charCodeAt(i) === 10) {
      lines.push({ number: lines.length + 1, from, to: i, text: str.slice(from, i) });
      from = i + 1;
    }
  }
  if (lines.length === 0) lines.push({ number: 1, from: 0, to: 0, text: '' });
  const fromOffsets = lines.map((l) => l.from);
  return {
    length: str.length,
    toString() { return str; },
    sliceString(f, t) { return str.slice(f, t); },
    get lines() { return lines.length; },
    line(n) { return lines[n - 1]; },
    lineAt(pos) {
      if (lines.length === 1) return lines[0];
      let lo = 0, hi = fromOffsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (fromOffsets[mid] <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lines[lo];
    },
  };
}

// ── CSS helpers (mirror block-marker-reveal.test.js per Codex M3 fix) ──

function extractCss(html) {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  return m ? m[1] : '';
}

function parseCssRules(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < stripped.length) {
    const brace = stripped.indexOf('{', i);
    if (brace < 0) break;
    const closeBrace = stripped.indexOf('}', brace);
    if (closeBrace < 0) break;
    const selectorText = stripped.slice(i, brace).trim();
    const body = stripped.slice(brace + 1, closeBrace).trim();
    if (selectorText) {
      const selectors = selectorText.split(',').map((s) => s.trim()).filter(Boolean);
      rules.push({ selectors, body });
    }
    i = closeBrace + 1;
  }
  return rules;
}

function tokensOf(selector) {
  return selector.split(/\s+/).filter(Boolean);
}

function parseDeclarations(body) {
  const decls = [];
  for (const part of body.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const property = trimmed.slice(0, colon).trim();
    const value    = trimmed.slice(colon + 1).trim();
    if (property && value) decls.push({ property, value });
  }
  return decls;
}

function hasExactSelectorTokens(selectors, expectedTokens) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    if (t.length !== expectedTokens.length) return false;
    for (let i = 0; i < t.length; i++) if (t[i] !== expectedTokens[i]) return false;
    return true;
  });
}

function findRuleWithExactSelector(rules, tokens) {
  return rules.find((r) => hasExactSelectorTokens(r.selectors, tokens));
}

function loadHtmlRules() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  return { html, rules: parseCssRules(extractCss(html)) };
}

// ── Group D-1: shared module shape (29-6, 29-7, 29-12) ──

test('Stage 29-6: cm6-line-utils.js exports {resolveTouchedLines} and sets globalThis.Cm6LineUtils', () => {
  delete require.cache[require.resolve(LINE_UTILS_REL)];
  // Clear any prior globalThis stash so we observe a fresh require.
  const prior = globalThis.Cm6LineUtils;
  try {
    delete globalThis.Cm6LineUtils;
    const mod = require(LINE_UTILS_REL);
    const keys = Object.keys(mod).sort();
    assert.deepEqual(keys, ['resolveTouchedLines'],
      'cm6-line-utils.js must export exactly {resolveTouchedLines}');
    assert.equal(typeof mod.resolveTouchedLines, 'function');
    // UMD wrapper must set globalThis.Cm6LineUtils in the CommonJS branch.
    assert.ok(globalThis.Cm6LineUtils, 'globalThis.Cm6LineUtils must be set after require');
    assert.equal(globalThis.Cm6LineUtils.resolveTouchedLines, mod.resolveTouchedLines);
  } finally {
    if (prior !== undefined) globalThis.Cm6LineUtils = prior;
    else delete globalThis.Cm6LineUtils;
  }
});

test('Stage 29-7: globalThis.Cm6LineUtils.resolveTouchedLines behavior smoke', () => {
  delete require.cache[require.resolve(LINE_UTILS_REL)];
  require(LINE_UTILS_REL);
  const out = globalThis.Cm6LineUtils.resolveTouchedLines(
    { ranges: [{ from: 0, to: 0 }] },
    makeFakeDoc('a\nb\nc')
  );
  assert.deepEqual(out, [1]);
});

test('Stage 29-12: cm6-line-utils.js source contains zero forbidden tokens', () => {
  const src = fs.readFileSync(LINE_UTILS_PATH, 'utf8');
  assert.ok(!src.includes('Decoration.replace'), 'no Decoration.replace');
  assert.ok(!src.includes('Decoration.widget'),  'no Decoration.widget');
  assert.ok(!src.includes('WidgetType'),         'no WidgetType');
  assert.ok(!src.includes('<a'),                 'no "<a"');
  assert.ok(!src.includes('href'),               'no "href"');
  assert.ok(!src.includes('<img'),               'no "<img"');
  assert.ok(!src.includes('<div'),               'no "<div"');
  assert.ok(!src.includes('addEventListener'),   'no addEventListener');
  assert.ok(!/onclick\s*[:=]/.test(src),          'no onclick property/handler');
  assert.ok(!src.includes('innerHTML'),          'no innerHTML');
  assert.ok(!src.includes('document.write'),     'no document.write');
  assert.ok(!src.includes('eval('),              'no eval(');
  assert.ok(!src.includes('domEventHandlers'),   'no domEventHandlers');
  assert.ok(!src.includes('keymap.of'),          'no keymap.of');
});

// ── Group D-2: delegation contract (29-8, 29-9) ──

function testDelegation(consumerRel, label) {
  delete require.cache[require.resolve(LINE_UTILS_REL)];
  delete require.cache[require.resolve(consumerRel)];
  require(LINE_UTILS_REL);
  const consumer = require(consumerRel);

  const original = globalThis.Cm6LineUtils.resolveTouchedLines;
  const calls = [];
  const sentinel = ['__STAGE_29_DELEGATION_SENTINEL__'];
  try {
    globalThis.Cm6LineUtils.resolveTouchedLines = function (sel, doc) {
      calls.push({ sel: sel, doc: doc });
      return sentinel;
    };
    const fakeDoc = makeFakeDoc('alpha\nbeta\ngamma');
    const fakeSel = { ranges: [{ from: 0, to: 0 }] };
    const result = consumer.resolveTouchedLines(fakeSel, fakeDoc);
    assert.equal(calls.length, 1, label + ' must delegate exactly once');
    assert.strictEqual(calls[0].sel, fakeSel, label + ' must forward selection arg');
    assert.strictEqual(calls[0].doc, fakeDoc, label + ' must forward doc arg');
    assert.strictEqual(result, sentinel, label + ' must return the helper\'s return value verbatim');
  } finally {
    globalThis.Cm6LineUtils.resolveTouchedLines = original;
  }
}

test('Stage 29-8: cm6-active-range.js resolveTouchedLines delegates to globalThis.Cm6LineUtils', () => {
  testDelegation(ACTIVE_RANGE_REL, 'cm6-active-range.js');
});

test('Stage 29-9: cm6-construct-reveal.js resolveTouchedLines delegates to globalThis.Cm6LineUtils', () => {
  testDelegation(CONSTRUCT_REL, 'cm6-construct-reveal.js');
});

// ── Group D-3: output-parity regression (29-10) ──

test('Stage 29-10: cm6-active-range and cm6-construct-reveal produce identical resolveTouchedLines output across 5 inputs', () => {
  delete require.cache[require.resolve(LINE_UTILS_REL)];
  delete require.cache[require.resolve(ACTIVE_RANGE_REL)];
  delete require.cache[require.resolve(CONSTRUCT_REL)];
  require(LINE_UTILS_REL);
  const arMod = require(ACTIVE_RANGE_REL);
  const crMod = require(CONSTRUCT_REL);

  const doc5 = makeFakeDoc('aaa\nbbb\nccc\nddd\neee');
  const doc10 = makeFakeDoc('l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10');
  const emptyDoc = makeFakeDoc('');
  const inputs = [
    // 1. Single range, single line.
    { sel: { ranges: [{ from: 0, to: 0 }] }, doc: doc5, label: 'caret at 0' },
    // 2. Multi-range disjoint.
    { sel: { ranges: [{ from: 4, to: 7 }, { from: 16, to: 22 }] }, doc: doc10, label: 'multi-range' },
    // 3. Range across multiple lines.
    { sel: { ranges: [{ from: 0, to: 11 }] }, doc: doc5, label: 'across lines' },
    // 4. Range ending at col 0 of next line.
    { sel: { ranges: [{ from: 0, to: 4 }] }, doc: doc5, label: 'col 0 of next line' },
    // 5. Empty doc, caret at 0.
    { sel: { ranges: [{ from: 0, to: 0 }] }, doc: emptyDoc, label: 'empty doc' },
  ];

  for (const { sel, doc, label } of inputs) {
    const fromActiveRange = arMod.resolveTouchedLines(sel, doc);
    const fromConstruct   = crMod.resolveTouchedLines(sel, doc);
    assert.deepEqual(fromConstruct, fromActiveRange,
      'output drift between cm6-active-range and cm6-construct-reveal for input: ' + label);
  }
});

// ── Group F: index.html invariants (29-11, 29-13, 29-14) ──

test('Stage 29-11: index.html loads cm6-line-utils.js before cm6-active-range.js + cm6-construct-reveal.js + cm6-hybrid-view.js', () => {
  const { html } = loadHtmlRules();
  const tagRegex = /<script\s+src=["']\.\/lib\/cm6-line-utils\.js["']\s*><\/script>/g;
  const matches = Array.from(html.matchAll(tagRegex));
  assert.equal(matches.length, 1, 'exactly one cm6-line-utils.js script tag in index.html');
  const lineUtilsOffset = matches[0].index;

  const activeRangeIdx    = html.indexOf('./lib/cm6-active-range.js');
  const constructRevealIdx = html.indexOf('./lib/cm6-construct-reveal.js');
  const hybridViewIdx     = html.indexOf('./lib/cm6-hybrid-view.js');

  assert.notEqual(activeRangeIdx,    -1, 'cm6-active-range.js tag must exist');
  assert.notEqual(constructRevealIdx, -1, 'cm6-construct-reveal.js tag must exist');
  assert.notEqual(hybridViewIdx,     -1, 'cm6-hybrid-view.js tag must exist');

  assert.ok(lineUtilsOffset < activeRangeIdx,
    'cm6-line-utils.js must load BEFORE cm6-active-range.js');
  assert.ok(lineUtilsOffset < constructRevealIdx,
    'cm6-line-utils.js must load BEFORE cm6-construct-reveal.js');
  assert.ok(lineUtilsOffset < hybridViewIdx,
    'cm6-line-utils.js must load BEFORE cm6-hybrid-view.js');
});

test('Stage 29-13 (m1 + rev-4 scoped): index.html has EXACTLY ONE .cm-md-setext-active .cm-md-heading-mark rule with display: inline + color + opacity', () => {
  const { rules } = loadHtmlRules();
  // Rev-4 fix: the reveal CSS is scoped to .cm-md-setext-active (NOT
  // the universal .cm-md-construct-active) so heading-mark reveal does
  // not leak to ATX headings nested inside blockquotes.
  const matches = rules.filter((r) => hasExactSelectorTokens(r.selectors, ['.cm-md-setext-active', '.cm-md-heading-mark']));
  assert.equal(matches.length, 1, 'exactly one rule with selector ".cm-md-setext-active .cm-md-heading-mark" (catches accidental duplicates)');
  const decls = parseDeclarations(matches[0].body);
  const display = decls.find((d) => d.property === 'display');
  const color   = decls.find((d) => d.property === 'color');
  const opacity = decls.find((d) => d.property === 'opacity');
  assert.ok(display, 'rule must declare display');
  assert.equal(display.value, 'inline', 'display: inline required to override cm-md-syntax\'s display: none');
  assert.ok(color, 'rule must declare color');
  assert.equal(color.value, 'var(--text-muted)');
  assert.ok(opacity, 'rule must declare opacity');
  assert.equal(opacity.value, '0.5');
});

test('Stage 29-14 (m1 tightened): Stage 14.7 .cm-activeLine .cm-md-heading-mark rule is still present, unchanged, and unique', () => {
  const { rules } = loadHtmlRules();
  const matches = rules.filter((r) => hasExactSelectorTokens(r.selectors, ['.cm-activeLine', '.cm-md-heading-mark']));
  assert.equal(matches.length, 1, 'exactly one Stage 14.7 rule with selector ".cm-activeLine .cm-md-heading-mark"');
  const decls = parseDeclarations(matches[0].body);
  const display = decls.find((d) => d.property === 'display');
  const color   = decls.find((d) => d.property === 'color');
  const opacity = decls.find((d) => d.property === 'opacity');
  assert.ok(display && display.value === 'inline', 'Stage 14.7 rule must still declare display: inline');
  assert.ok(color && color.value === 'var(--text-muted)', 'Stage 14.7 rule must still declare color: var(--text-muted)');
  assert.ok(opacity && opacity.value === '0.5', 'Stage 14.7 rule must still declare opacity: 0.5');
});

// ── Group D-4 (M2 fix): browser UMD path verification (29-15) ──

test('Stage 29-15 (M2 added): cm6-line-utils.js browser UMD path sets root.Cm6LineUtils when module/exports are absent', () => {
  const vm = require('node:vm');
  const src = fs.readFileSync(LINE_UTILS_PATH, 'utf8');
  // Synthetic browser-like context: no `module`, no `exports`, no
  // `require`. globalThis is the sandbox itself so root.Cm6LineUtils
  // assignments are observable.
  const sandbox = {};
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(src, context);
  assert.ok(sandbox.Cm6LineUtils,
    'browser UMD path must set root.Cm6LineUtils when module is absent');
  assert.equal(typeof sandbox.Cm6LineUtils.resolveTouchedLines, 'function',
    'sandbox.Cm6LineUtils.resolveTouchedLines must be a function in browser path');
  // Smoke-test the helper in the sandbox to prove it's actually wired.
  // Note: arrays returned from the sandbox have a different Array
  // prototype than the test runner's, so use element-level assertions
  // instead of assert.deepStrictEqual (which fails on cross-realm
  // prototype mismatch even when contents match).
  const fakeDoc = makeFakeDoc('one\ntwo\nthree');
  const out = sandbox.Cm6LineUtils.resolveTouchedLines(
    { ranges: [{ from: 0, to: 0 }] },
    fakeDoc,
  );
  assert.equal(out.length, 1, 'helper must return a 1-element array');
  assert.equal(out[0], 1, 'caret at 0 must yield line 1');
});
