/* Stage 28 — peer-contract + CSS + script-tag invariants for the
   construct-reveal module.
   Run focused:
     node --test test/cm6-write-view/cm6-construct-reveal-invariants.test.js

   Group F tests (28-16..28-18, 28-21):
     28-16  forbidden-token scan on cm6-construct-reveal.js source
     28-17  module exports surface = {buildConstructActiveDecorations,
            createConstructRevealExtension, findActiveConstructs,
            resolveTouchedLines} (sorted)
     28-18  CSS source-level scan on index.html: hide rules for
            cm-md-fenced-code-mark + -info; reveal rules for
            cm-md-construct-active descendants of mark, info, quote-mark
     28-21  index.html <script src="./lib/cm6-construct-reveal.js">
            presence + ordering (between cm6-active-range.js and
            cm6-hybrid-view.js)
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const CONSTRUCT_REVEAL_PATH = path.join(__dirname, '..', '..', 'lib', 'cm6-construct-reveal.js');
const INDEX_HTML_PATH       = path.join(__dirname, '..', '..', 'index.html');

// ── CSS helpers (mirror Stage 27's pattern in block-marker-reveal.test.js) ──

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

function hasSingleTokenSelector(selectors, token) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    return t.length === 1 && t[0] === token;
  });
}

function hasExactSelectorTokens(selectors, expectedTokens) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    if (t.length !== expectedTokens.length) return false;
    for (let i = 0; i < t.length; i++) if (t[i] !== expectedTokens[i]) return false;
    return true;
  });
}

function loadHtmlRules() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  return { html, rules: parseCssRules(extractCss(html)) };
}

// ── 28-16: forbidden-token scan ──────────────────────────────────────────

test('Stage 28-16: cm6-construct-reveal.js source contains zero forbidden tokens', () => {
  const src = fs.readFileSync(CONSTRUCT_REVEAL_PATH, 'utf8');
  // Same Section H + Stage 16-10 set used by Stage 26 and 27.
  // Production comments must NOT contain these literal substrings.
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

// ── 28-17: module exports surface ────────────────────────────────────────

test('Stage 28-17: module exports exactly the four documented names (sorted vs sorted)', () => {
  delete require.cache[require.resolve('../../lib/cm6-construct-reveal.js')];
  const mod = require('../../lib/cm6-construct-reveal.js');
  const actualKeys = Object.keys(mod).sort();
  const expectedKeysSorted = [
    'buildConstructActiveDecorations',
    'createConstructRevealExtension',
    'findActiveConstructs',
    'resolveTouchedLines',
  ];
  assert.deepEqual(actualKeys, expectedKeysSorted);
});

// ── 28-18: CSS source-level scan ─────────────────────────────────────────

test('Stage 28-18: index.html — fenced-code hide rules + construct-active reveal rules present; TaskMarker hide rule still absent', () => {
  const { rules } = loadHtmlRules();

  // (a) Direct-hide rule for .cm-md-fenced-code-mark.
  const hideFenceMark = rules.filter((r) => {
    if (!hasSingleTokenSelector(r.selectors, '.cm-md-fenced-code-mark')) return false;
    return parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none');
  });
  assert.ok(hideFenceMark.length >= 1, 'expected at least one direct hide rule for .cm-md-fenced-code-mark');

  // (b) Direct-hide rule for .cm-md-fenced-code-info.
  const hideFenceInfo = rules.filter((r) => {
    if (!hasSingleTokenSelector(r.selectors, '.cm-md-fenced-code-info')) return false;
    return parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none');
  });
  assert.ok(hideFenceInfo.length >= 1, 'expected at least one direct hide rule for .cm-md-fenced-code-info');

  // (c)/(d)/(e) Reveal rules — at least one rule with each exact selector
  // chain AND body containing display: inline + opacity: 0.5.
  function assertRevealRule(tokens, label) {
    const matches = rules.filter((r) => hasExactSelectorTokens(r.selectors, tokens));
    assert.ok(matches.length >= 1, 'reveal rule for ' + label + ' must exist');
    let foundValid = false;
    for (const r of matches) {
      const decls = parseDeclarations(r.body);
      const display = decls.find((d) => d.property === 'display');
      const opacity = decls.find((d) => d.property === 'opacity');
      if (display && display.value === 'inline' && opacity && opacity.value === '0.5') {
        foundValid = true;
        break;
      }
    }
    assert.ok(foundValid, label + ' rule must declare display: inline AND opacity: 0.5');
  }
  assertRevealRule(['.cm-md-construct-active', '.cm-md-fenced-code-mark'], 'construct-active fence mark');
  assertRevealRule(['.cm-md-construct-active', '.cm-md-fenced-code-info'], 'construct-active fence info');
  assertRevealRule(['.cm-md-construct-active', '.cm-md-quote-mark'],       'construct-active quote mark');

  // (f) Sanity: NO new direct-hide rule targets .cm-md-task-marker.
  // (Stage 27's D1 still holds — TaskMarker stays always-visible.)
  const exemptViolations = [];
  for (const r of rules) {
    const hasDisplayNone = parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none');
    if (!hasDisplayNone) continue;
    for (const sel of r.selectors) {
      const t = tokensOf(sel);
      for (const tok of t) {
        if (tok === '.cm-md-task-marker') {
          exemptViolations.push({ selector: sel });
        }
      }
    }
  }
  assert.equal(exemptViolations.length, 0,
    'no display:none rule may target .cm-md-task-marker (Stage 27 D1 preserved): ' + JSON.stringify(exemptViolations));
});

// ── 28-21: script-tag presence + ordering invariant ──────────────────────

test('Stage 28-21: index.html loads cm6-construct-reveal.js between cm6-active-range.js and cm6-hybrid-view.js', () => {
  const { html } = loadHtmlRules();
  const tagRegex = /<script\s+src=["']\.\/lib\/cm6-construct-reveal\.js["']\s*><\/script>/g;
  const matches = Array.from(html.matchAll(tagRegex));
  assert.equal(matches.length, 1, 'exactly one <script src="./lib/cm6-construct-reveal.js"> tag');
  const constructRevealOffset = matches[0].index;

  const activeRangeIdx = html.indexOf('./lib/cm6-active-range.js');
  const hybridViewIdx  = html.indexOf('./lib/cm6-hybrid-view.js');
  assert.notEqual(activeRangeIdx, -1, 'cm6-active-range.js script tag must exist');
  assert.notEqual(hybridViewIdx,  -1, 'cm6-hybrid-view.js script tag must exist');
  assert.ok(activeRangeIdx < constructRevealOffset,
    'cm6-construct-reveal.js must load AFTER cm6-active-range.js (got activeRangeIdx=' + activeRangeIdx + ', constructRevealOffset=' + constructRevealOffset + ')');
  assert.ok(constructRevealOffset < hybridViewIdx,
    'cm6-construct-reveal.js must load BEFORE cm6-hybrid-view.js (got constructRevealOffset=' + constructRevealOffset + ', hybridViewIdx=' + hybridViewIdx + ')');
});
