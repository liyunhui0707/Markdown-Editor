/* Stage 27 — Block-marker hide/reveal source-level CSS tests.
   Run focused:
     node --test test/cm6-write-view/block-marker-reveal.test.js

   These tests are pure file-content scans of apps/desktop/index.html.
   They parse the <style> block into rules and assert:
     A — direct-hide rules exist for .cm-md-list-mark and .cm-md-quote-mark
         (single-token selector; no !important).
     B — all four reveal selector paths exist for ListMark + QuoteMark,
         each with `display: inline` AND `opacity: 0.5`.
     C — no display:none rule targets exempt classes (.cm-md-task-marker,
         .cm-md-fenced-code-mark, .cm-md-fenced-code-info) — D1, D2.
     D — existing color rules `.cm-md-list-mark { color: ... }` and
         `.cm-md-quote-mark { color: ... }` are preserved.

   Walker class-string emissions are unchanged in Stage 27 — these tests
   never need the cm6 bundle or syntax tree.

   Codex review advisories honored:
   - parseDeclarations rejects !important via strict-equality match on
     'none' / 'inline' / '0.5'. A rule body like `display: none !important`
     parses to value `'none !important'`, which fails strict comparison
     to `'none'`.
   - Reveal tests assert exact property values, not substring includes.
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

// ── CSS helpers ──────────────────────────────────────────────────────────

// Extract the contents of the first <style>...</style> block.
function extractCss(html) {
  const m = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html);
  return m ? m[1] : '';
}

// Parse CSS into [{selectors: string[], body: string}, ...].
// Strips /* ... */ comments. Does not support nested at-rules (not used
// in this stylesheet).
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

// Tokenize a CSS selector on whitespace.
// e.g. '.cm-activeLine .cm-md-list-mark' → ['.cm-activeLine', '.cm-md-list-mark']
function tokensOf(selector) {
  return selector.split(/\s+/).filter(Boolean);
}

// Parse a CSS rule body into [{property, value}, ...]. Strict-equality
// comparison against `value` catches `!important` (which would be part
// of the value string, e.g. 'none !important').
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

// True if any selector in `selectors` tokenizes to exactly [token].
function hasSingleTokenSelector(selectors, token) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    return t.length === 1 && t[0] === token;
  });
}

// True if any selector in `selectors` tokenizes to exactly the given
// token sequence (whitespace descendant combinator).
function hasExactSelectorTokens(selectors, expectedTokens) {
  return selectors.some((sel) => {
    const t = tokensOf(sel);
    if (t.length !== expectedTokens.length) return false;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== expectedTokens[i]) return false;
    }
    return true;
  });
}

// Load + parse once per test (cheap; ~few KB of CSS).
function loadRules() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const css  = extractCss(html);
  return parseCssRules(css);
}

// ─────────────────────────────────────────────────────────────────────────
// Group A — direct-hide rules present (rev-3 F3 tightening)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 27-1: a direct-hide rule for .cm-md-list-mark exists with display: none (no !important, no descendant context)', () => {
  const rules = loadRules();
  const hides = rules.filter((r) => {
    if (!hasSingleTokenSelector(r.selectors, '.cm-md-list-mark')) return false;
    return parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none');
  });
  assert.ok(hides.length >= 1, 'expected at least one rule with selector exactly ".cm-md-list-mark" AND body containing "display: none" (without !important)');
});

test('Stage 27-2: a direct-hide rule for .cm-md-quote-mark exists with display: none (no !important, no descendant context)', () => {
  const rules = loadRules();
  const hides = rules.filter((r) => {
    if (!hasSingleTokenSelector(r.selectors, '.cm-md-quote-mark')) return false;
    return parseDeclarations(r.body).some((d) => d.property === 'display' && d.value === 'none');
  });
  assert.ok(hides.length >= 1, 'expected at least one rule with selector exactly ".cm-md-quote-mark" AND body containing "display: none" (without !important)');
});

// ─────────────────────────────────────────────────────────────────────────
// Group B — all four reveal paths present (rev-3 F1 + F4 tightening)
// Each test asserts a rule with the exact descendant selector exists
// AND its body contains display === 'inline' AND opacity === '0.5'.
// ─────────────────────────────────────────────────────────────────────────

function assertRevealRule(rules, tokens, label) {
  const matches = rules.filter((r) => hasExactSelectorTokens(r.selectors, tokens));
  assert.ok(matches.length >= 1, `expected a reveal rule with selector ${tokens.join(' ')} (${label})`);
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
  assert.ok(foundValid, `rule ${tokens.join(' ')} must declare display: inline AND opacity: 0.5 (${label})`);
}

test('Stage 27-3a: .cm-activeLine .cm-md-list-mark reveals with display: inline + opacity: 0.5', () => {
  assertRevealRule(loadRules(), ['.cm-activeLine', '.cm-md-list-mark'], 'ListMark active-line');
});

test('Stage 27-3b: .cm-md-active-range .cm-md-list-mark reveals with display: inline + opacity: 0.5', () => {
  assertRevealRule(loadRules(), ['.cm-md-active-range', '.cm-md-list-mark'], 'ListMark active-range');
});

test('Stage 27-4a: .cm-activeLine .cm-md-quote-mark reveals with display: inline + opacity: 0.5', () => {
  assertRevealRule(loadRules(), ['.cm-activeLine', '.cm-md-quote-mark'], 'QuoteMark active-line');
});

test('Stage 27-4b: .cm-md-active-range .cm-md-quote-mark reveals with display: inline + opacity: 0.5', () => {
  assertRevealRule(loadRules(), ['.cm-md-active-range', '.cm-md-quote-mark'], 'QuoteMark active-range');
});

// ─────────────────────────────────────────────────────────────────────────
// Group C — exempt markers never appear in any display:none rule
// (rev-3 F2 tightening: scan EVERY display:none rule and reject any
//  selector item matching an exempt class — catches combined selector lists)
//
// Stage 28 amendment: D2 from Stage 27 (FencedCode exempt) has been LIFTED.
// Stage 28's construct-reveal mechanism hides .cm-md-fenced-code-mark and
// .cm-md-fenced-code-info via display:none and reveals them on the
// construct-active class. Therefore those classes are NO LONGER exempt
// from display:none rules. Only TaskMarker (Stage 27 D1) remains exempt
// because hiding [ ] would break Stage 23's task-toggle click target.
// ─────────────────────────────────────────────────────────────────────────

test('Stage 27-5: no display:none rule targets exempt class (TaskMarker only) — D1 preserved; Stage 28 lifts D2', () => {
  const rules = loadRules();
  const exemptClasses = [
    '.cm-md-task-marker',
  ];
  const violations = [];
  for (const r of rules) {
    const decls = parseDeclarations(r.body);
    const hasDisplayNone = decls.some((d) => d.property === 'display' && d.value === 'none');
    if (!hasDisplayNone) continue;
    for (const selector of r.selectors) {
      const tokens = tokensOf(selector);
      for (const tok of tokens) {
        if (exemptClasses.includes(tok)) {
          violations.push({ selector, exemptToken: tok });
        }
      }
    }
  }
  assert.equal(violations.length, 0, 'TaskMarker must never appear in any display:none rule\'s selector list (Stage 27 D1 preserves the click target): ' + JSON.stringify(violations));
});

// ─────────────────────────────────────────────────────────────────────────
// Group D — existing color rules preserved
// ─────────────────────────────────────────────────────────────────────────

test('Stage 27-6: existing dim-color rules `.cm-md-list-mark { color: var(--text-muted) }` and `.cm-md-quote-mark { color: var(--text-muted) }` are still present', () => {
  const rules = loadRules();

  function findColorRule(token) {
    return rules.find((r) => {
      if (!hasSingleTokenSelector(r.selectors, token)) return false;
      return parseDeclarations(r.body).some(
        (d) => d.property === 'color' && d.value === 'var(--text-muted)',
      );
    });
  }
  assert.ok(findColorRule('.cm-md-list-mark'),  'existing `.cm-md-list-mark { color: var(--text-muted) }` rule must still exist');
  assert.ok(findColorRule('.cm-md-quote-mark'), 'existing `.cm-md-quote-mark { color: var(--text-muted) }` rule must still exist');
});
