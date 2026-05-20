/* Stage 30 — list-item continuation expansion tests.
   Run focused:
     node --test test/cm6-write-view/cm6-list-continuation-reveal.test.js

   Stage 30 extends Stage 28's construct-reveal mechanism to ListItem
   so that the first-line ListMark (`-`, `*`, `+`, `1.`, `1)`) stays
   visible (dimmed) when the caret is on a continuation line of the
   same list item. The reveal is SCOPED to a new class
   `cm-md-list-item-active` (mirroring Stage 29's `cm-md-setext-active`
   pattern) — ListItem lines do NOT carry the generic
   `cm-md-construct-active` class. This prevents cross-construct
   leakage:
     - caret in a Blockquote does not reveal a nested ListMark;
     - caret in a ListItem does not widen Stage 28's quote/fence
       reveal selectors onto nested constructs inside the active item.

   Tests are grouped:
     RED  — primary headline assertion (30-RED-1..3)
     NEG  — sibling-item leakage guards     (30-NEG-1..2)
     TYPE — findActiveConstructs entry type (30-TYPE-1)
     EDGE — nested list / list+blockquote   (30-EDGE-1..3)
     FM   — frontmatter suppression         (30-FM-1)
     PERF — list-heavy corpus               (30-PERF-1)
     CSS  — index.html invariant scan        (30-CSS-1)
     LEAK — cross-construct leakage guards   (30-LEAK-1..4)

   Helpers are mirrored locally from cm6-construct-reveal.test.js
   intentionally (no shared helper module — out of scope for Stage 30).
*/

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const path     = require('node:path');

const CONSTRUCT_REL = '../../lib/cm6-construct-reveal.js';
const LINE_UTILS_REL = '../../lib/cm6-line-utils.js';
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

// ── Lazy loaders ─────────────────────────────────────────────────────────

function loadConstructRevealModule() {
  delete require.cache[require.resolve(CONSTRUCT_REL)];
  // Stage 29: ensure the shared line-utils helper is loaded for the
  // CommonJS path so resolveTouchedLines can delegate.
  require(LINE_UTILS_REL);
  return require(CONSTRUCT_REL);
}

function loadCm6Bundle() {
  if (!global.window) global.window = {};
  if (!global.window.CM6Production) {
    require('../../lib/cm6-bundle.js');
  }
  return global.window.CM6Production;
}

function buildRealStateAndTree(doc) {
  const cm6 = loadCm6Bundle();
  const state = cm6.EditorState.create({ doc, extensions: [cm6.markdown()] });
  const tree = cm6.syntaxTree(state);
  return { cm6, state, tree };
}

// Collect (from, classTokens[]) for every decoration in a RangeSet.
function collectLineDecorations(decorations) {
  const seen = [];
  if (!decorations) return seen;
  if (decorations._ranges) {
    for (const r of decorations._ranges) {
      const cls = r.value && r.value.spec && r.value.spec.class;
      seen.push({ from: r.from, tokens: String(cls || '').split(/\s+/).filter(Boolean) });
    }
    return seen;
  }
  if (typeof decorations.iter === 'function') {
    const it = decorations.iter();
    while (it.value) {
      const cls = it.value.spec && it.value.spec.class;
      seen.push({ from: it.from, tokens: String(cls || '').split(/\s+/).filter(Boolean) });
      it.next();
    }
  }
  return seen;
}

function decoratedFromsWithToken(decorations, token) {
  return collectLineDecorations(decorations)
    .filter((d) => d.tokens.includes(token))
    .map((d) => d.from);
}

// ── CSS helpers (mirror Stage 28's pattern) ──────────────────────────────

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

function loadHtmlRules() {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  return { html, rules: parseCssRules(extractCss(html)) };
}

// ─────────────────────────────────────────────────────────────────────────
// Group RED — primary headline assertions
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-RED-1: unordered list — caret on continuation line decorates first line with cm-md-list-item-active (real parser)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- first\n  continuation\n- second\n');
  const contLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: contLine.from, to: contLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  assert.ok(decos, 'decoration set returned');
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const firstLineFrom = state.doc.line(1).from;
  assert.ok(
    listItemActiveFroms.includes(firstLineFrom),
    'first line carrying ListMark must carry cm-md-list-item-active when caret is on the continuation line'
  );
});

test('Stage 30-RED-2: ordered list (1.) — caret on continuation decorates first line with cm-md-list-item-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('1. first\n   continuation\n2. second\n');
  const contLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: contLine.from, to: contLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  assert.ok(decos);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const firstLineFrom = state.doc.line(1).from;
  assert.ok(
    listItemActiveFroms.includes(firstLineFrom),
    'first line carrying ordered ListMark must carry cm-md-list-item-active'
  );
});

test('Stage 30-RED-3: ordered list (1)) — caret on continuation decorates first line with cm-md-list-item-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('1) first\n   continuation\n2) second\n');
  const contLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: contLine.from, to: contLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  assert.ok(decos);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const firstLineFrom = state.doc.line(1).from;
  assert.ok(
    listItemActiveFroms.includes(firstLineFrom),
    'first line carrying 1) ordered ListMark must carry cm-md-list-item-active'
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Group NEG — sibling-item leakage guards
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-NEG-1: caret on item-A continuation decorates ONLY item-A lines, NOT item-B', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- first\n  continuation\n- second\n');
  const contLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: contLine.from, to: contLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const line1 = state.doc.line(1).from;
  const line2 = state.doc.line(2).from;
  const line3 = state.doc.line(3).from;
  assert.ok(listItemActiveFroms.includes(line1), 'line 1 (item A first line) must carry cm-md-list-item-active');
  assert.ok(listItemActiveFroms.includes(line2), 'line 2 (item A continuation) must carry cm-md-list-item-active');
  assert.ok(!listItemActiveFroms.includes(line3), 'line 3 (item B) must NOT carry cm-md-list-item-active');
});

test('Stage 30-NEG-2: same for ordered list — caret on item-A continuation does not bleed into item B', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('1. first\n   continuation\n2. second\n');
  const contLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: contLine.from, to: contLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const line1 = state.doc.line(1).from;
  const line2 = state.doc.line(2).from;
  const line3 = state.doc.line(3).from;
  assert.ok(listItemActiveFroms.includes(line1));
  assert.ok(listItemActiveFroms.includes(line2));
  assert.ok(!listItemActiveFroms.includes(line3));
});

// ─────────────────────────────────────────────────────────────────────────
// Group TYPE — findActiveConstructs entry type
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-TYPE-1: findActiveConstructs returns ListItem (not BulletList / OrderedList / List)', () => {
  const { findActiveConstructs } = loadConstructRevealModule();
  const { state, tree } = buildRealStateAndTree('- first\n  continuation\n');
  const touched = new Set([state.doc.line(2).number]);
  const constructs = findActiveConstructs(tree, state.doc, touched);
  const listItems = constructs.filter((c) => c.type === 'ListItem');
  assert.ok(listItems.length >= 1, 'expected at least one ListItem entry');
  for (const c of constructs) {
    assert.notEqual(c.type, 'BulletList',  'must not return BulletList (over-broad)');
    assert.notEqual(c.type, 'OrderedList', 'must not return OrderedList (over-broad)');
    assert.notEqual(c.type, 'List',        'must not return List (over-broad)');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Group EDGE — nested list / list-in-blockquote / single-line sanity
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-EDGE-1: nested list — caret on inner sublist continuation reveals BOTH outer and inner ListMark lines', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- outer\n  - inner\n    inner cont\n- second outer\n');
  const innerCont = state.doc.line(3);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: innerCont.from, to: innerCont.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const outerLine = state.doc.line(1).from;
  const innerLine = state.doc.line(2).from;
  assert.ok(listItemActiveFroms.includes(outerLine), 'outer ListMark line must reveal');
  assert.ok(listItemActiveFroms.includes(innerLine), 'inner ListMark line must reveal');
});

test('Stage 30-EDGE-2: list item containing a blockquote — caret in the blockquote reveals outer ListMark too', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- outer\n  > inside quote\n  > more quote\n');
  const quoteLine = state.doc.line(3);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: quoteLine.from, to: quoteLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const outerLine = state.doc.line(1).from;
  assert.ok(listItemActiveFroms.includes(outerLine), 'outer ListMark line must carry cm-md-list-item-active');
});

test('Stage 30-EDGE-3: single-line list item — caret on that line decorates that line with cm-md-list-item-active (sanity)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- only\nplain\n');
  const onlyLine = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: onlyLine.from, to: onlyLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  assert.ok(listItemActiveFroms.includes(onlyLine.from), 'single-line list item still gets cm-md-list-item-active');
});

// ─────────────────────────────────────────────────────────────────────────
// Group FM — frontmatter suppression preservation
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-FM-1: list inside YAML frontmatter is NOT decorated (D8 guard preserved)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('---\n- inside frontmatter\n- second\n---\n\nbody\n');
  // Line 2 = '- inside frontmatter' (inside the strict frontmatter region).
  const fmLine = state.doc.line(2);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: fmLine.from, to: fmLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  assert.equal(listItemActiveFroms.length, 0, 'no cm-md-list-item-active emitted inside frontmatter region');
});

// ─────────────────────────────────────────────────────────────────────────
// Group PERF — list-heavy corpus
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-PERF-1: 5000-line list-heavy corpus full-document selection — buildConstructActiveDecorations < 1500 ms', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  // 5000 list-item-with-continuation entries.
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push('- item ' + i);
    lines.push('  cont ' + i);
  }
  const corpus = lines.join('\n');
  const { state, tree, cm6 } = buildRealStateAndTree(corpus);
  const fullSelState = Object.assign({}, state, {
    selection: { ranges: [{ from: 0, to: corpus.length }] },
  });
  const t0 = Date.now();
  const result = buildConstructActiveDecorations(fullSelState, cm6, tree);
  const dt = Date.now() - t0;
  // Use the local helper that handles both _ranges and iter() so the
  // diagnostic count is portable across the fake-cm6 and real-cm6 paths
  // (Codex diff-review minor: the previous direct _ranges read printed
  // 0 even when the iterable DecorationSet had entries).
  const decoCount = collectLineDecorations(result).length;
  console.log('  [Stage 30-PERF-1] 5000-item list corpus full-doc build wall-clock:', dt, 'ms (', decoCount, 'line decorations)');
  // Sanity: the fixture must produce a non-trivial number of decorations,
  // otherwise the timing assertion is a tautology. The actual count is
  // bounded by @lezer/markdown's lazy parsing window (the full 10k-line
  // corpus is not parsed in one shot — only the leading viewport-sized
  // chunk reaches the syntax tree), so the threshold is calibrated well
  // below the theoretical 10k and well above zero.
  assert.ok(decoCount >= 50,
    'list-heavy 5000-item corpus must yield at least 50 line decorations (measured ' + decoCount + ') so the timing assertion is meaningful');
  assert.ok(dt < 1500, 'list-heavy 5000-item full-document construct-active build under 1500 ms (measured ' + dt + ' ms)');
});

// ─────────────────────────────────────────────────────────────────────────
// Group CSS — index.html invariant scan
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-CSS-1: index.html has a `.cm-md-list-item-active .cm-md-list-mark` rule with display: inline AND opacity: 0.5', () => {
  const { rules } = loadHtmlRules();
  const matches = rules.filter((r) => hasExactSelectorTokens(r.selectors, ['.cm-md-list-item-active', '.cm-md-list-mark']));
  assert.ok(matches.length >= 1, 'expected at least one rule with selector exactly ".cm-md-list-item-active .cm-md-list-mark"');
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
  assert.ok(foundValid, '.cm-md-list-item-active .cm-md-list-mark rule must declare display: inline AND opacity: 0.5');
});

// ─────────────────────────────────────────────────────────────────────────
// Group LEAK — cross-construct leakage guards (Codex round-1 finding)
// ─────────────────────────────────────────────────────────────────────────

test('Stage 30-LEAK-1: caret on `> intro\\n> - child\\n` line 1 (Blockquote intro) does NOT decorate line 2 with cm-md-list-item-active', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('> intro\n> - child\n');
  const introLine = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: introLine.from, to: introLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const listItemActiveFroms = decoratedFromsWithToken(decos, 'cm-md-list-item-active');
  const childLine = state.doc.line(2).from;
  assert.ok(!listItemActiveFroms.includes(childLine),
    'caret on Blockquote intro must NOT cause the nested child list line to carry cm-md-list-item-active');
});

test('Stage 30-LEAK-2: caret on `- outer\\n  > nested\\n` line 1 (outer list) does NOT put bare cm-md-construct-active on line 2 (nested Blockquote line)', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- outer\n  > nested\n');
  const outerLine = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: outerLine.from, to: outerLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const all = collectLineDecorations(decos);
  const nestedLine = state.doc.line(2).from;
  const lineEntry = all.find((d) => d.from === nestedLine);
  // Line 2 may carry cm-md-list-item-active (the outer ListItem is active and includes it),
  // but it must NOT carry the bare cm-md-construct-active because the inner Blockquote is
  // NOT in the touched set (only line 1 is) and ListItem lines never add the generic class.
  if (lineEntry) {
    assert.ok(!lineEntry.tokens.includes('cm-md-construct-active'),
      'line 2 (nested Blockquote line) must NOT carry cm-md-construct-active when only the outer ListItem is active (Codex round-1 leakage guard)');
  }
});

test('Stage 30-LEAK-3: caret on `- outer\\n  ```\\n  fenced\\n  ```\\n` line 1 (outer list) does NOT put bare cm-md-construct-active on the inner fence lines', () => {
  const { buildConstructActiveDecorations } = loadConstructRevealModule();
  const { state, tree, cm6 } = buildRealStateAndTree('- outer\n  ```\n  fenced\n  ```\n');
  const outerLine = state.doc.line(1);
  const stateSel = Object.assign({}, state, {
    selection: { ranges: [{ from: outerLine.from, to: outerLine.from }] },
  });
  const decos = buildConstructActiveDecorations(stateSel, cm6, tree);
  const all = collectLineDecorations(decos);
  for (let n = 2; n <= 4; n++) {
    const lineFrom = state.doc.line(n).from;
    const lineEntry = all.find((d) => d.from === lineFrom);
    if (lineEntry) {
      assert.ok(!lineEntry.tokens.includes('cm-md-construct-active'),
        'line ' + n + ' (inner fence) must NOT carry cm-md-construct-active when only the outer ListItem is active');
    }
  }
});

test('Stage 30-LEAK-4: the new Stage 30 CSS rule targets ONLY .cm-md-list-mark (cm-md-list-item-active is not used to widen quote/fence/heading reveal)', () => {
  const { rules } = loadHtmlRules();
  // Find every rule that mentions cm-md-list-item-active in ANY selector.
  const stage30Rules = rules.filter((r) => r.selectors.some((sel) => tokensOf(sel).includes('.cm-md-list-item-active')));
  assert.ok(stage30Rules.length >= 1, 'expected at least one rule keyed off .cm-md-list-item-active');
  // Every selector that mentions .cm-md-list-item-active must, after that token, target ONLY .cm-md-list-mark
  // (no .cm-md-quote-mark, no .cm-md-fenced-code-mark, no .cm-md-fenced-code-info, no .cm-md-heading-mark).
  const forbiddenLeakTokens = [
    '.cm-md-quote-mark',
    '.cm-md-fenced-code-mark',
    '.cm-md-fenced-code-info',
    '.cm-md-heading-mark',
  ];
  for (const r of stage30Rules) {
    for (const sel of r.selectors) {
      const t = tokensOf(sel);
      if (!t.includes('.cm-md-list-item-active')) continue;
      for (const forbidden of forbiddenLeakTokens) {
        assert.ok(!t.includes(forbidden),
          'selector "' + sel + '" must not combine .cm-md-list-item-active with ' + forbidden + ' (Codex round-1 leakage guard)');
      }
    }
  }
});
